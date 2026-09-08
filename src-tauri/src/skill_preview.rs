use std::path::Path;

use serde::Serialize;

use crate::{db::Database, error::AppError, skills};

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

    let inspected = skills::inspect_skill(&canonical_source)?;
    let existing = db.skill_by_identity(&inspected.source_id, ".")?;

    let (action, reason) = match &existing {
        Some(skill)
            if skill.content_hash == inspected.content_hash
                && Path::new(&skill.library_path).is_dir() =>
        {
            ("skip", "Library 中内容未变化")
        }
        Some(_) => ("update", "同一来源已存在，内容发生变化"),
        None => ("add", "新的本地 Skill 来源"),
    };

    Ok(SkillImportPreview {
        path: inspected.source_path.to_string_lossy().into_owned(),
        name: inspected.name,
        description: inspected.description,
        source: "local".to_string(),
        action: action.to_string(),
        reason: reason.to_string(),
        content_hash: inspected.content_hash,
        existing_skill_id: existing.map(|skill| skill.id),
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::db::Database;

    use super::preview_skill_directory;

    #[test]
    fn preview_rejects_invalid_allowed_tools_type() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "skills-manger-preview-invalid-tools-{}-{nonce}",
            std::process::id()
        ));
        let source = root.join("demo-skill");
        let library = root.join("library");
        fs::create_dir_all(&source).expect("source should exist");
        fs::create_dir_all(&library).expect("library should exist");
        fs::write(
            source.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Invalid tools fixture.\nallowed-tools: 42\n---\n",
        )
        .expect("manifest should write");

        let db = Database::initialize(root.join("skills.sqlite3")).expect("db should initialize");
        let error = preview_skill_directory(&db, &library, &source)
            .expect_err("preview should reject invalid allowed-tools");

        assert!(matches!(error, crate::error::AppError::Yaml(_)));

        drop(db);
        let _ = fs::remove_dir_all(root);
    }
}
