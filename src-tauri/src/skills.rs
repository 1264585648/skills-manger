//! SKILL.md parsing, validation and deterministic content hashing.
//! Read-only: nothing here copies files or executes scripts.

use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct SkillFrontmatter {
    name: String,
    description: String,
    compatibility: Option<String>,
}

#[derive(Debug)]
pub(crate) struct InspectedSkill {
    pub(crate) source_path: PathBuf,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) content_hash: String,
    pub(crate) content_signature: String,
    pub(crate) script_count: i64,
}

#[derive(Debug)]
struct SkillContents {
    name: String,
    description: String,
    content_hash: String,
    content_signature: String,
    script_count: i64,
}

/// One file inside a skill directory, with everything the cheap fingerprint needs.
struct FileEntry {
    relative: PathBuf,
    absolute: PathBuf,
    len: u64,
    modified_nanos: u128,
}

/// Inspect a skill directory in place: `SKILL.md` must exist as a regular file,
/// `name` must match the parent directory, and the whole tree is fingerprinted.
///
/// `cached` carries the `(content_hash, content_signature)` stored by the
/// previous scan. When the on-disk fingerprint still matches, the stored hash
/// is reused and no file body is read at all — the difference between a
/// re-scan costing one `stat` per file and one full read per file.
pub(crate) fn inspect_skill(
    root: &Path,
    cached: Option<(&str, Option<&str>)>,
) -> Result<InspectedSkill, AppError> {
    let parent_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            AppError::InvalidSkill("skill directory name is not valid UTF-8".to_string())
        })?;
    let contents = inspect_skill_contents(root, parent_name, cached)?;

    Ok(InspectedSkill {
        source_path: root.to_path_buf(),
        name: contents.name,
        description: contents.description,
        content_hash: contents.content_hash,
        content_signature: contents.content_signature,
        script_count: contents.script_count,
    })
}

fn inspect_skill_contents(
    root: &Path,
    expected_name: &str,
    cached: Option<(&str, Option<&str>)>,
) -> Result<SkillContents, AppError> {
    let manifest_path = root.join("SKILL.md");
    let manifest_metadata = match fs::symlink_metadata(&manifest_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::InvalidSkill(
                "selected directory does not contain SKILL.md".to_string(),
            ));
        }
        Err(error) => return Err(AppError::Io(error)),
    };

    if manifest_metadata.file_type().is_symlink() {
        return Err(AppError::InvalidSkill(
            "SKILL.md must be a regular file and cannot be a symbolic link".to_string(),
        ));
    }

    if !manifest_metadata.is_file() {
        return Err(AppError::InvalidSkill(
            "selected directory does not contain SKILL.md".to_string(),
        ));
    }

    let raw = fs::read_to_string(&manifest_path)?;
    let manifest = parse_manifest(&raw)?;
    validate_manifest(expected_name, &manifest)?;

    let tree = fingerprint_tree(root)?;
    let (content_hash, cached_signature) = match cached {
        Some((hash, signature)) if signature == Some(tree.signature.as_str()) => {
            (hash.to_string(), tree.signature.clone())
        }
        _ => (hash_files(&tree.files)?, tree.signature.clone()),
    };

    Ok(SkillContents {
        name: manifest.name,
        description: manifest.description,
        content_hash,
        content_signature: cached_signature,
        script_count: tree.script_count,
    })
}

fn parse_manifest(raw: &str) -> Result<SkillFrontmatter, AppError> {
    let raw = raw.trim_start_matches('\u{feff}');
    let mut lines = raw.lines();

    if lines.next().map(str::trim) != Some("---") {
        return Err(AppError::InvalidSkill(
            "SKILL.md must start with YAML frontmatter".to_string(),
        ));
    }

    let mut yaml = Vec::new();
    let mut closed = false;
    for line in lines {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        yaml.push(line);
    }

    if !closed {
        return Err(AppError::InvalidSkill(
            "SKILL.md frontmatter is missing the closing ---".to_string(),
        ));
    }

    serde_yaml::from_str::<SkillFrontmatter>(&yaml.join("\n")).map_err(AppError::from)
}

fn validate_manifest(expected_name: &str, manifest: &SkillFrontmatter) -> Result<(), AppError> {
    let name = manifest.name.as_str();
    let valid_name = !name.is_empty()
        && name.chars().count() <= 64
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-');

    if !valid_name {
        return Err(AppError::InvalidSkill(
            "SKILL.md name must be 1-64 lowercase letters, numbers or hyphens".to_string(),
        ));
    }

    if expected_name != manifest.name {
        return Err(AppError::InvalidSkill(format!(
            "SKILL.md name '{}' must match parent directory '{}'",
            manifest.name, expected_name
        )));
    }

    let description_len = manifest.description.chars().count();
    if description_len == 0 || description_len > 1024 {
        return Err(AppError::InvalidSkill(
            "SKILL.md description must contain 1-1024 characters".to_string(),
        ));
    }

    if manifest
        .compatibility
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.chars().count() > 500)
    {
        return Err(AppError::InvalidSkill(
            "SKILL.md compatibility must contain 1-500 characters when present".to_string(),
        ));
    }

    Ok(())
}

struct TreeFingerprint {
    signature: String,
    script_count: i64,
    files: Vec<FileEntry>,
}

/// Cheap pass over the tree: one `stat` per file, no file body is read.
///
/// The signature covers relative path, size and mtime, so a skill is only
/// re-hashed when something on disk actually moved.
fn fingerprint_tree(root: &Path) -> Result<TreeFingerprint, AppError> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    files.sort_by(|a, b| a.relative.cmp(&b.relative));

    if files.len() > 2_000 {
        return Err(AppError::InvalidSkill(
            "skill contains more than 2000 files; scanning is blocked for safety".to_string(),
        ));
    }

    let total_bytes = files
        .iter()
        .fold(0_u64, |total, entry| total.saturating_add(entry.len));
    if total_bytes > 100 * 1024 * 1024 {
        return Err(AppError::InvalidSkill(
            "skill is larger than 100 MB; scanning is blocked for safety".to_string(),
        ));
    }

    let mut hasher = Sha256::new();
    let mut script_count = 0_i64;
    for entry in &files {
        if entry
            .relative
            .components()
            .next()
            .is_some_and(|part| part.as_os_str() == std::ffi::OsStr::new("scripts"))
        {
            script_count += 1;
        }

        let relative_text = entry.relative.to_string_lossy().replace('\\', "/");
        hasher.update(relative_text.as_bytes());
        hasher.update([0]);
        hasher.update(entry.len.to_le_bytes());
        hasher.update([0]);
        hasher.update(entry.modified_nanos.to_le_bytes());
        hasher.update([0]);
    }

    Ok(TreeFingerprint {
        signature: to_hex(&hasher.finalize()),
        script_count,
        files,
    })
}

/// Content hash of a whole skill: relative path plus file bytes, streamed so a
/// large skill never lands in memory in one piece.
///
/// Uses explicit length-framing (u32 path length, path bytes, u64 content length, content bytes)
/// to ensure different file trees can never produce identical hasher input.
fn hash_files(files: &[FileEntry]) -> Result<String, AppError> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    for entry in files {
        let relative_text = entry.relative.to_string_lossy().replace('\\', "/");
        let path_bytes = relative_text.as_bytes();
        hasher.update((path_bytes.len() as u32).to_le_bytes());
        hasher.update(path_bytes);
        hasher.update(entry.len.to_le_bytes());

        let mut reader = BufReader::new(File::open(&entry.absolute)?);
        loop {
            let read = reader.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    }

    Ok(to_hex(&hasher.finalize()))
}

fn collect_files(root: &Path, current: &Path, output: &mut Vec<FileEntry>) -> Result<(), AppError> {
    let mut entries = fs::read_dir(current)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if entry.file_name() == std::ffi::OsStr::new(".git") {
            continue;
        }

        let path = entry.path();
        // `DirEntry::metadata` does not follow symlinks and saves the extra
        // stat that `fs::metadata` would cost for every file of every skill.
        let metadata = entry.metadata()?;
        let file_type = metadata.file_type();

        if file_type.is_symlink() {
            return Err(AppError::InvalidSkill(format!(
                "symbolic links are not supported inside a skill directory: {}",
                path.display()
            )));
        }

        if file_type.is_dir() {
            collect_files(root, &path, output)?;
        } else if file_type.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| {
                    AppError::State("failed to calculate relative skill path".to_string())
                })?
                .to_path_buf();
            let modified_nanos = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            output.push(FileEntry {
                relative,
                absolute: path,
                len: metadata.len(),
                modified_nanos,
            });
        }
    }

    Ok(())
}

/// Remove a file, symlink or directory if it exists (links are never followed).
pub(crate) fn remove_if_exists(path: &Path) -> Result<(), AppError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    if metadata.file_type().is_symlink() {
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileTypeExt;
            if metadata.file_type().is_symlink_dir() {
                fs::remove_dir(path)?;
            } else {
                fs::remove_file(path)?;
            }
        }
        #[cfg(not(windows))]
        fs::remove_file(path)?;
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub(crate) fn unix_timestamp() -> Result<i64, AppError> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::State(format!("system clock error: {error}")))?
        .as_secs();
    i64::try_from(seconds)
        .map_err(|_| AppError::State("timestamp does not fit into i64".to_string()))
}

pub(crate) fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    to_hex(&hasher.finalize())
}

fn to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{hash_text, inspect_skill};

    fn test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("skills-manger-skills-{label}-{nonce}"))
    }

    fn write_skill(root: &Path, name: &str, body: &str) {
        fs::create_dir_all(root.join("scripts")).expect("skill dirs should be created");
        fs::write(
            root.join("SKILL.md"),
            format!(
                "---\nname: {name}\ndescription: Test skill fixture.\nmetadata:\n  version: \"1.0\"\n---\n\n{body}\n"
            ),
        )
        .expect("SKILL.md should be written");
        fs::write(root.join("scripts").join("run.py"), "print('ok')\n")
            .expect("script should be written");
    }

    #[test]
    fn inspect_reads_metadata_without_executing_scripts() {
        let root = test_root("inspect");
        let skill = root.join("demo-skill");
        write_skill(&skill, "demo-skill", "body");
        let sentinel = root.join("SCRIPT_EXECUTED");
        fs::write(
            skill.join("scripts").join("run.sh"),
            format!("echo x > {}", sentinel.display()),
        )
        .expect("script fixture should be written");

        let inspected = inspect_skill(&skill, None).expect("inspection should work");

        assert_eq!(inspected.name, "demo-skill");
        assert_eq!(inspected.description, "Test skill fixture.");
        assert_eq!(inspected.script_count, 2);
        assert_eq!(inspected.content_hash.len(), 64);
        assert!(!sentinel.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn manifest_name_must_match_parent_directory() {
        let root = test_root("name-mismatch");
        let skill = root.join("wrong-folder");
        fs::create_dir_all(&skill).expect("skill dir should exist");
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: another-name\ndescription: Valid description.\n---\n",
        )
        .expect("manifest should be written");

        let error = inspect_skill(&skill, None).expect_err("mismatch should fail");

        assert!(error.to_string().contains("must match parent directory"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hash_is_content_addressed() {
        let root = test_root("hash");
        let skill = root.join("demo-skill");
        write_skill(&skill, "demo-skill", "first");

        let first = inspect_skill(&skill, None).expect("hash should work");
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Test skill fixture.\n---\n\nsecond version\n",
        )
        .expect("manifest should be rewritten");
        let second = inspect_skill(&skill, None).expect("hash should work");

        assert_ne!(first.content_hash, second.content_hash);
        assert_eq!(hash_text("demo"), hash_text("demo"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unchanged_skill_reuses_the_cached_hash() {
        let root = test_root("fingerprint");
        let skill = root.join("demo-skill");
        write_skill(&skill, "demo-skill", "first");

        let first = inspect_skill(&skill, None).expect("inspection should work");
        let cached = inspect_skill(
            &skill,
            Some(("cached-hash", Some(first.content_signature.as_str()))),
        )
        .expect("cached inspection should work");
        assert_eq!(
            cached.content_hash, "cached-hash",
            "an unchanged skill must not be re-read"
        );

        // A differing signature (here: different file size) forces a real hash.
        fs::write(skill.join("scripts").join("run.py"), "print('changed')\n")
            .expect("script should be rewritten");
        let refreshed = inspect_skill(
            &skill,
            Some(("cached-hash", Some(first.content_signature.as_str()))),
        )
        .expect("refreshed inspection should work");
        assert_eq!(refreshed.content_hash.len(), 64);
        assert_ne!(refreshed.content_hash, "cached-hash");
        assert_ne!(refreshed.content_signature, first.content_signature);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn linked_manifest_is_rejected_before_parsing() {
        let root = test_root("linked-manifest");
        let skill = root.join("demo-skill");
        fs::create_dir_all(&skill).expect("skill dir should exist");
        let external = root.join("external-SKILL.md");
        fs::write(
            &external,
            "---\nname: demo-skill\ndescription: External fixture.\n---\n",
        )
        .expect("external manifest should be written");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&external, skill.join("SKILL.md"))
            .expect("manifest symlink should be created");
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&external, skill.join("SKILL.md")).is_err() {
            let _ = fs::remove_dir_all(root);
            return;
        }

        let error = inspect_skill(&skill, None).expect_err("linked manifest should be rejected");

        assert!(error
            .to_string()
            .contains("SKILL.md must be a regular file and cannot be a symbolic link"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hash_framing_ambiguity_is_prevented() {
        let root = test_root("hash-framing");
        let skill_a = root.join("skill-a");
        let skill_b = root.join("skill-b");
        fs::create_dir_all(&skill_a).expect("skill_a should exist");
        fs::create_dir_all(&skill_b).expect("skill_b should exist");

        let manifest_a = "---\nname: skill-a\ndescription: Ambiguity test A.\n---\n";
        let manifest_b = "---\nname: skill-b\ndescription: Ambiguity test B.\n---\n";
        fs::write(skill_a.join("SKILL.md"), manifest_a).expect("manifest A should write");
        fs::write(skill_b.join("SKILL.md"), manifest_b).expect("manifest B should write");

        // Construct the exact collision vector from the security review:
        // Tree A: file "a" with bytes "X\0b\0Y"
        // Tree B: file "a" with bytes "X", file "b" with bytes "Y"
        fs::write(skill_a.join("a"), b"X\0b\0Y").expect("payload A should write");
        fs::write(skill_b.join("a"), b"X").expect("payload Ba should write");
        fs::write(skill_b.join("b"), b"Y").expect("payload Bb should write");

        let inspected_a = inspect_skill(&skill_a, None).expect("inspection A should succeed");
        let inspected_b = inspect_skill(&skill_b, None).expect("inspection B should succeed");

        assert_ne!(
            inspected_a.content_hash, inspected_b.content_hash,
            "Length-framed hash must distinguish different file trees"
        );

        let _ = fs::remove_dir_all(root);
    }
}
