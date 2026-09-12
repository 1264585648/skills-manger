use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::Database, error::AppError};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct SkillFrontmatter {
    name: String,
    description: String,
    license: Option<String>,
    compatibility: Option<String>,
    #[serde(default)]
    metadata: BTreeMap<String, String>,
    allowed_tools: Option<AllowedTools>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AllowedTools {
    Text(String),
    List(Vec<String>),
}

impl AllowedTools {
    fn into_storage(self) -> String {
        match self {
            Self::Text(value) => value,
            Self::List(values) => values.join(", "),
        }
    }
}

#[derive(Debug)]
pub(crate) struct InspectedSkill {
    pub(crate) source_path: PathBuf,
    pub(crate) source_id: String,
    pub(crate) skill_id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) content_hash: String,
    pub(crate) script_count: i64,
}

#[derive(Debug)]
struct SkillContents {
    name: String,
    description: String,
    version: Option<String>,
    license: Option<String>,
    compatibility: Option<String>,
    allowed_tools: Option<String>,
    metadata_json: String,
    content_hash: String,
    script_count: i64,
}

#[derive(Debug)]
pub struct SkillDraft {
    pub id: String,
    pub source_id: String,
    pub source_kind: String,
    pub source_locator: String,
    pub relative_path: String,
    pub name: String,
    pub description: String,
    pub version: Option<String>,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub allowed_tools: Option<String>,
    pub metadata_json: String,
    pub content_hash: String,
    pub library_path: String,
    pub script_count: i64,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_kind: String,
    pub source_locator: String,
    pub version: Option<String>,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub allowed_tools: Option<String>,
    pub content_hash: String,
    pub library_path: String,
    pub script_count: i64,
    pub imported_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillResult {
    pub outcome: String,
    pub skill: SkillRecord,
}

pub fn import_skill_directory(
    db: &Database,
    library_root: &Path,
    source: impl AsRef<Path>,
) -> Result<ImportSkillResult, AppError> {
    import_skill_directory_as(db, library_root, source.as_ref(), None)
}

pub(crate) fn import_skill_directory_with_origin(
    db: &Database,
    library_root: &Path,
    source: &Path,
    origin: &Path,
) -> Result<ImportSkillResult, AppError> {
    import_skill_directory_as(db, library_root, source, Some(origin))
}

fn import_skill_directory_as(
    db: &Database,
    library_root: &Path,
    source: &Path,
    origin: Option<&Path>,
) -> Result<ImportSkillResult, AppError> {
    let canonical_source = source.canonicalize()?;
    if !canonical_source.is_dir() {
        return Err(AppError::InvalidSkill(
            "selected path is not a directory".to_string(),
        ));
    }

    let canonical_library = library_root.canonicalize()?;
    if canonical_source.starts_with(&canonical_library) {
        return Err(AppError::InvalidSkill(
            "cannot import a skill from the managed library directory".to_string(),
        ));
    }

    let mut inspected = inspect_skill(&canonical_source)?;
    let source_locator = origin
        .map(Path::canonicalize)
        .transpose()?
        .unwrap_or_else(|| canonical_source.clone());
    if origin.is_some() {
        inspected.source_id = hash_text(&format!("local\0{}", source_locator.to_string_lossy()));
        inspected.skill_id = hash_text(&format!("{}\0.", inspected.source_id));
    }
    let existing = db.skill_by_identity(&inspected.source_id, ".")?;

    if let Some(skill) = &existing {
        if skill.content_hash == inspected.content_hash && Path::new(&skill.library_path).is_dir() {
            return Ok(ImportSkillResult {
                outcome: "unchanged".to_string(),
                skill: skill.clone(),
            });
        }
    }

    let destination = library_root.join(&inspected.skill_id);
    let staging = library_root.join(format!(".staging-{}", inspected.skill_id));
    let backup = library_root.join(format!(".backup-{}", inspected.skill_id));

    remove_if_exists(&staging)?;
    remove_if_exists(&backup)?;
    if let Err(error) = copy_tree(&inspected.source_path, &staging) {
        let _ = remove_if_exists(&staging);
        return Err(error);
    }
    let staged_contents = match inspect_skill_contents(&staging, &inspected.name) {
        Ok(contents) => contents,
        Err(error) => {
            let _ = remove_if_exists(&staging);
            return Err(error);
        }
    };

    let had_existing = destination.exists();
    if had_existing {
        fs::rename(&destination, &backup)?;
    }

    if let Err(error) = fs::rename(&staging, &destination) {
        if had_existing && backup.exists() {
            let _ = fs::rename(&backup, &destination);
        }
        return Err(AppError::Io(error));
    }

    let timestamp = unix_timestamp()?;
    let draft = SkillDraft {
        id: inspected.skill_id.clone(),
        source_id: inspected.source_id,
        source_kind: "local".to_string(),
        source_locator: source_locator.to_string_lossy().into_owned(),
        relative_path: ".".to_string(),
        name: staged_contents.name,
        description: staged_contents.description,
        version: staged_contents.version,
        license: staged_contents.license,
        compatibility: staged_contents.compatibility,
        allowed_tools: staged_contents.allowed_tools,
        metadata_json: staged_contents.metadata_json,
        content_hash: staged_contents.content_hash,
        library_path: destination.to_string_lossy().into_owned(),
        script_count: staged_contents.script_count,
        timestamp,
    };

    match db.upsert_skill(&draft) {
        Ok(skill) => {
            remove_if_exists(&backup)?;
            Ok(ImportSkillResult {
                outcome: if existing.is_some() {
                    "updated".to_string()
                } else {
                    "created".to_string()
                },
                skill,
            })
        }
        Err(error) => {
            let _ = remove_if_exists(&destination);
            if had_existing && backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            Err(error)
        }
    }
}

pub(crate) fn inspect_skill(root: &Path) -> Result<InspectedSkill, AppError> {
    let parent_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            AppError::InvalidSkill("skill directory name is not valid UTF-8".to_string())
        })?;
    let contents = inspect_skill_contents(root, parent_name)?;

    let source_locator = root.to_string_lossy().into_owned();
    let source_id = hash_text(&format!("local\0{source_locator}"));
    let skill_id = hash_text(&format!("{source_id}\0."));

    Ok(InspectedSkill {
        source_path: root.to_path_buf(),
        source_id,
        skill_id,
        name: contents.name,
        description: contents.description,
        content_hash: contents.content_hash,
        script_count: contents.script_count,
    })
}

pub(crate) fn import_tracked_skill_directory(
    db: &Database,
    library_root: &Path,
    source: &Path,
    source_id: &str,
    source_locator: &str,
) -> Result<ImportSkillResult, AppError> {
    let canonical_source = source.canonicalize()?;
    if !canonical_source.is_dir() {
        return Err(AppError::InvalidSkill(
            "tracked Skill path is not a directory".to_string(),
        ));
    }
    let canonical_library = library_root.canonicalize()?;
    if canonical_source.starts_with(&canonical_library) {
        return Err(AppError::InvalidSkill(
            "tracked source cannot be inside the managed Library".to_string(),
        ));
    }
    let inspected = inspect_portable_skill(&canonical_source)?;
    let existing = db.skill_by_identity(source_id, ".")?;
    if let Some(skill) = &existing {
        if skill.content_hash == inspected.content_hash && Path::new(&skill.library_path).is_dir() {
            return Ok(ImportSkillResult {
                outcome: "unchanged".to_string(),
                skill: skill.clone(),
            });
        }
    }

    let skill_id = hash_text(&format!("{source_id}\0."));
    let destination = library_root.join(&skill_id);
    let staging = library_root.join(format!(".staging-{skill_id}"));
    let backup = library_root.join(format!(".backup-{skill_id}"));
    remove_if_exists(&staging)?;
    remove_if_exists(&backup)?;
    if let Err(error) = copy_tree(&canonical_source, &staging) {
        let _ = remove_if_exists(&staging);
        return Err(error);
    }
    let staged_contents = match inspect_skill_contents(&staging, &inspected.name) {
        Ok(contents) => contents,
        Err(error) => {
            let _ = remove_if_exists(&staging);
            return Err(error);
        }
    };
    let had_existing = destination.exists();
    if had_existing {
        fs::rename(&destination, &backup)?;
    }
    if let Err(error) = fs::rename(&staging, &destination) {
        if had_existing && backup.exists() {
            let _ = fs::rename(&backup, &destination);
        }
        return Err(AppError::Io(error));
    }

    let timestamp = unix_timestamp()?;
    let draft = SkillDraft {
        id: skill_id,
        source_id: source_id.to_string(),
        source_kind: "git".to_string(),
        source_locator: source_locator.to_string(),
        relative_path: ".".to_string(),
        name: staged_contents.name,
        description: staged_contents.description,
        version: staged_contents.version,
        license: staged_contents.license,
        compatibility: staged_contents.compatibility,
        allowed_tools: staged_contents.allowed_tools,
        metadata_json: staged_contents.metadata_json,
        content_hash: staged_contents.content_hash,
        library_path: destination.to_string_lossy().into_owned(),
        script_count: staged_contents.script_count,
        timestamp,
    };
    match db.upsert_skill(&draft) {
        Ok(skill) => {
            remove_if_exists(&backup)?;
            Ok(ImportSkillResult {
                outcome: if existing.is_some() {
                    "updated".to_string()
                } else {
                    "created".to_string()
                },
                skill,
            })
        }
        Err(error) => {
            let _ = remove_if_exists(&destination);
            if had_existing && backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            Err(error)
        }
    }
}

pub(crate) fn inspect_managed_skill(
    root: &Path,
    expected_name: &str,
) -> Result<(String, i64), AppError> {
    let contents = inspect_skill_contents(root, expected_name)?;
    Ok((contents.content_hash, contents.script_count))
}

pub(crate) fn inspect_portable_skill(root: &Path) -> Result<InspectedSkill, AppError> {
    let manifest_path = root.join("SKILL.md");
    let metadata = fs::symlink_metadata(&manifest_path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::InvalidSkill(
            "SKILL.md must be a regular file and cannot be a symbolic link".to_string(),
        ));
    }
    let raw = fs::read_to_string(&manifest_path)?;
    let manifest = parse_manifest(&raw)?;
    let logical_name = manifest.name;
    let contents = inspect_skill_contents(root, &logical_name)?;
    let source_locator = root.to_string_lossy().into_owned();
    let source_id = hash_text(&format!("local\0{source_locator}"));
    let skill_id = hash_text(&format!("{source_id}\0."));
    Ok(InspectedSkill {
        source_path: root.to_path_buf(),
        source_id,
        skill_id,
        name: contents.name,
        description: contents.description,
        content_hash: contents.content_hash,
        script_count: contents.script_count,
    })
}

fn inspect_skill_contents(root: &Path, expected_name: &str) -> Result<SkillContents, AppError> {
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

    let (content_hash, script_count) = hash_tree(root)?;
    let version = manifest.metadata.get("version").cloned();
    let metadata_json = serde_json::to_string(&manifest.metadata)?;

    Ok(SkillContents {
        name: manifest.name,
        description: manifest.description,
        version,
        license: manifest.license,
        compatibility: manifest.compatibility,
        allowed_tools: manifest.allowed_tools.map(AllowedTools::into_storage),
        metadata_json,
        content_hash,
        script_count,
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

fn hash_tree(root: &Path) -> Result<(String, i64), AppError> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));

    if files.len() > 2_000 {
        return Err(AppError::InvalidSkill(
            "skill contains more than 2000 files; import is blocked for safety".to_string(),
        ));
    }

    let total_bytes = files.iter().try_fold(0_u64, |total, (_, path)| {
        Ok::<u64, AppError>(total.saturating_add(fs::metadata(path)?.len()))
    })?;
    if total_bytes > 100 * 1024 * 1024 {
        return Err(AppError::InvalidSkill(
            "skill is larger than 100 MB; import is blocked for safety".to_string(),
        ));
    }

    let mut hasher = Sha256::new();
    let mut script_count = 0_i64;

    for (relative, absolute) in files {
        if relative
            .components()
            .next()
            .is_some_and(|part| part.as_os_str() == std::ffi::OsStr::new("scripts"))
        {
            script_count += 1;
        }

        let relative_text = relative.to_string_lossy().replace('\\', "/");
        hasher.update(relative_text.as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(absolute)?);
        hasher.update([0]);
    }

    Ok((to_hex(&hasher.finalize()), script_count))
}

fn collect_files(
    root: &Path,
    current: &Path,
    output: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), AppError> {
    let mut entries = fs::read_dir(current)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if entry.file_name() == std::ffi::OsStr::new(".git") {
            continue;
        }

        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_symlink() {
            return Err(AppError::InvalidSkill(format!(
                "symbolic links are not supported during M2 import: {}",
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
            output.push((relative, path));
        }
    }

    Ok(())
}

pub(crate) fn copy_tree(source: &Path, destination: &Path) -> Result<(), AppError> {
    fs::create_dir_all(destination)?;

    let mut entries = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if entry.file_name() == std::ffi::OsStr::new(".git") {
            continue;
        }

        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_symlink() {
            return Err(AppError::InvalidSkill(format!(
                "symbolic links are not supported during M2 import: {}",
                source_path.display()
            )));
        }

        if file_type.is_dir() {
            copy_tree(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

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

fn unix_timestamp() -> Result<i64, AppError> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::State(format!("system clock error: {error}")))?
        .as_secs() as i64)
}

fn hash_text(value: &str) -> String {
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
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use crate::db::Database;

    use super::{hash_text, hash_tree, import_skill_directory, inspect_skill};

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "skills-manger-m2-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn write_skill(path: &Path, name: &str, body: &str) {
        fs::create_dir_all(path.join("scripts")).expect("skill dirs should be created");
        fs::write(
            path.join("SKILL.md"),
            format!(
                "---\nname: {name}\ndescription: Test skill for M2 import.\nmetadata:\n  version: \"1.0\"\n---\n\n{body}\n"
            ),
        )
        .expect("SKILL.md should be written");
        fs::write(path.join("scripts").join("run.py"), "print('ok')\n")
            .expect("script should be written");
    }

    #[test]
    fn import_is_idempotent_and_detects_updates() {
        let root = test_root("idempotent");
        let source = root.join("source").join("demo-skill");
        let library = root.join("library");
        fs::create_dir_all(&library).expect("library should exist");
        write_skill(&source, "demo-skill", "first body");

        let db = Database::initialize(root.join("skills.sqlite3")).expect("db should initialize");
        let created = import_skill_directory(&db, &library, &source).expect("import should work");
        assert_eq!(created.outcome, "created");
        assert_eq!(created.skill.script_count, 1);

        let unchanged =
            import_skill_directory(&db, &library, &source).expect("reimport should work");
        assert_eq!(unchanged.outcome, "unchanged");
        assert_eq!(db.list_skills().expect("skills should list").len(), 1);

        let first_hash = unchanged.skill.content_hash;
        write_skill(&source, "demo-skill", "changed body");
        let updated = import_skill_directory(&db, &library, &source).expect("update should work");
        assert_eq!(updated.outcome, "updated");
        assert_eq!(updated.skill.id, created.skill.id);
        assert_ne!(updated.skill.content_hash, first_hash);

        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn same_name_from_different_sources_can_coexist() {
        let root = test_root("same-name");
        let source_a = root.join("a").join("demo-skill");
        let source_b = root.join("b").join("demo-skill");
        let library = root.join("library");
        fs::create_dir_all(&library).expect("library should exist");
        write_skill(&source_a, "demo-skill", "source a");
        write_skill(&source_b, "demo-skill", "source b");

        let db = Database::initialize(root.join("skills.sqlite3")).expect("db should initialize");
        let first = import_skill_directory(&db, &library, &source_a).expect("first import");
        let second = import_skill_directory(&db, &library, &source_b).expect("second import");

        assert_ne!(first.skill.id, second.skill.id);
        assert_eq!(db.list_skills().expect("skills should list").len(), 2);

        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_manifest_name_is_rejected() {
        let root = test_root("invalid");
        let source = root.join("wrong-folder");
        let library = root.join("library");
        fs::create_dir_all(&library).expect("library should exist");
        fs::create_dir_all(&source).expect("source should exist");
        fs::write(
            source.join("SKILL.md"),
            "---\nname: another-name\ndescription: Valid description.\n---\n",
        )
        .expect("manifest should write");

        let db = Database::initialize(root.join("skills.sqlite3")).expect("db should initialize");
        let error = import_skill_directory(&db, &library, &source).expect_err("import should fail");
        assert!(error.to_string().contains("must match parent directory"));

        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn allowed_tools_sequence_is_imported() {
        let root = test_root("allowed-tools-sequence");
        let source = root.join("source").join("demo-skill");
        let library = root.join("library");
        fs::create_dir_all(&source).expect("source should exist");
        fs::create_dir_all(&library).expect("library should exist");
        fs::write(
            source.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Sequence tools fixture.\nallowed-tools:\n  - read\n  - write\n---\n",
        )
        .expect("manifest should write");

        let db = Database::initialize(root.join("skills.sqlite3")).expect("db should initialize");
        let imported =
            import_skill_directory(&db, &library, &source).expect("sequence should import");

        assert_eq!(imported.outcome, "created");
        assert_eq!(imported.skill.allowed_tools.as_deref(), Some("read, write"));

        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn allowed_tools_scalar_is_imported() {
        let root = test_root("allowed-tools-scalar");
        let source = root.join("source").join("demo-skill");
        let library = root.join("library");
        fs::create_dir_all(&source).expect("source should exist");
        fs::create_dir_all(&library).expect("library should exist");
        fs::write(
            source.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Scalar tools fixture.\nallowed-tools: read\n---\n",
        )
        .expect("manifest should write");

        let db = Database::initialize(root.join("skills.sqlite3")).expect("db should initialize");
        let imported =
            import_skill_directory(&db, &library, &source).expect("scalar should import");

        assert_eq!(imported.outcome, "created");
        assert_eq!(imported.skill.allowed_tools.as_deref(), Some("read"));

        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persisted_hash_is_derived_from_staged_copy() {
        let root = test_root("staged-hash");
        let source = root.join("source").join("demo-skill");
        let library = root.join("library");
        fs::create_dir_all(&source).expect("source should exist");
        fs::create_dir_all(&library).expect("library should exist");
        fs::write(
            source.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Staged hash fixture.\n---\n",
        )
        .expect("manifest should write");

        let payload = vec![0_u8; 4 * 1024 * 1024];
        for index in 0..20 {
            fs::write(source.join(format!("bulk-{index:02}.bin")), &payload)
                .expect("bulk fixture should write");
        }
        let source_target = source.join("z-target.txt");
        fs::write(&source_target, "before\n").expect("target should write");

        let canonical_source = source.canonicalize().expect("source should canonicalize");
        let source_locator = canonical_source.to_string_lossy().into_owned();
        let source_id = hash_text(&format!("local\0{source_locator}"));
        let skill_id = hash_text(&format!("{source_id}\0."));
        let staged_manifest = library
            .join(format!(".staging-{skill_id}"))
            .join("SKILL.md");

        let mutator = thread::spawn(move || {
            for _ in 0..10_000 {
                if staged_manifest.is_file() {
                    fs::write(source_target, "after\n").expect("source mutation should succeed");
                    return;
                }
                thread::sleep(Duration::from_millis(1));
            }
            panic!("staging copy was not observed");
        });

        let db = Database::initialize(root.join("skills.sqlite3")).expect("db should initialize");
        let imported = import_skill_directory(&db, &library, &source).expect("import should work");
        mutator.join().expect("mutator should finish");

        let managed_path = PathBuf::from(&imported.skill.library_path);
        let (managed_hash, _) = hash_tree(&managed_path).expect("managed copy should hash");
        assert_eq!(imported.skill.content_hash, managed_hash);

        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn linked_manifest_is_rejected_before_parsing() {
        let root = test_root("linked-manifest");
        let source = root.join("source").join("demo-skill");
        let external_manifest = root.join("external-SKILL.md");
        fs::create_dir_all(&source).expect("source should exist");
        fs::write(
            &external_manifest,
            "---\nname: demo-skill\ndescription: External manifest fixture.\n---\n",
        )
        .expect("external manifest should write");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&external_manifest, source.join("SKILL.md"))
            .expect("manifest symlink should be created");
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&external_manifest, source.join("SKILL.md")).is_err()
        {
            let _ = fs::remove_dir_all(root);
            return;
        }

        let error = inspect_skill(&source).expect_err("linked manifest should be rejected");
        assert!(error
            .to_string()
            .contains("SKILL.md must be a regular file and cannot be a symbolic link"));

        let _ = fs::remove_dir_all(root);
    }
}
