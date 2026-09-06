use std::{fs, path::{Path, PathBuf}};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::Database, error::AppError};

#[derive(Debug, Deserialize)]
struct PreviewFrontmatter {
    name: String,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportPreview {
    pub path: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub action: String,
    pub reason: String,
    pub content_hash: String,
    pub existing_skill_id: Option<String>,
}

pub fn preview_skill_directory(
    db: &Database,
    library_root: &Path,
    source: impl AsRef<Path>,
) -> Result<SkillImportPreview, AppError> {
    let canonical_source = source.as_ref().canonicalize()?;
    if !canonical_source.is_dir() {
        return Err(AppError::InvalidSkill("selected path is not a directory".to_string()));
    }

    let canonical_library = library_root.canonicalize()?;
    if canonical_source.starts_with(&canonical_library) {
        return Err(AppError::InvalidSkill(
            "cannot import a skill from the managed library directory".to_string(),
        ));
    }

    let manifest = read_manifest(&canonical_source)?;
    validate_manifest(&canonical_source, &manifest)?;
    let content_hash = hash_tree(&canonical_source)?;
    let source_locator = canonical_source.to_string_lossy().into_owned();
    let source_id = hash_text(&format!("local\0{source_locator}"));
    let existing = db.skill_by_identity(&source_id, ".")?;

    let (action, reason) = match &existing {
        Some(skill)
            if skill.content_hash == content_hash && Path::new(&skill.library_path).is_dir() =>
        {
            ("skip", "Library 中内容未变化")
        }
        Some(_) => ("update", "同一来源已存在，内容发生变化"),
        None => ("add", "新的本地 Skill 来源"),
    };

    Ok(SkillImportPreview {
        path: source_locator,
        name: manifest.name,
        description: manifest.description,
        source: "local".to_string(),
        action: action.to_string(),
        reason: reason.to_string(),
        content_hash,
        existing_skill_id: existing.map(|skill| skill.id),
    })
}

fn read_manifest(root: &Path) -> Result<PreviewFrontmatter, AppError> {
    let manifest_path = root.join("SKILL.md");
    if !manifest_path.is_file() {
        return Err(AppError::InvalidSkill(
            "selected directory does not contain SKILL.md".to_string(),
        ));
    }

    let raw = fs::read_to_string(manifest_path)?;
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

    serde_yaml::from_str::<PreviewFrontmatter>(&yaml.join("\n")).map_err(AppError::from)
}

fn validate_manifest(root: &Path, manifest: &PreviewFrontmatter) -> Result<(), AppError> {
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

    let parent_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidSkill("skill directory name is not valid UTF-8".to_string()))?;
    if parent_name != manifest.name {
        return Err(AppError::InvalidSkill(format!(
            "SKILL.md name '{}' must match parent directory '{}'",
            manifest.name, parent_name
        )));
    }

    let description_len = manifest.description.chars().count();
    if description_len == 0 || description_len > 1024 {
        return Err(AppError::InvalidSkill(
            "SKILL.md description must contain 1-1024 characters".to_string(),
        ));
    }
    Ok(())
}

fn hash_tree(root: &Path) -> Result<String, AppError> {
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
    for (relative, absolute) in files {
        let relative_text = relative.to_string_lossy().replace('\\', "/");
        hasher.update(relative_text.as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(absolute)?);
        hasher.update([0]);
    }
    Ok(to_hex(&hasher.finalize()))
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
                "symbolic links are not supported during import preview: {}",
                path.display()
            )));
        }
        if file_type.is_dir() {
            collect_files(root, &path, output)?;
        } else if file_type.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| AppError::State("failed to calculate relative skill path".to_string()))?
                .to_path_buf();
            output.push((relative, path));
        }
    }
    Ok(())
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
