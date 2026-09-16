use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::{db::Database, error::AppError};

const MAX_DOCUMENT_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDocumentRecord {
    pub skill_id: String,
    pub path: String,
    pub content: String,
    pub size_bytes: u64,
    pub line_count: usize,
}

pub fn read_skill_document(
    db: &Database,
    library_root: &Path,
    skill_id: &str,
) -> Result<SkillDocumentRecord, AppError> {
    let (directory, boundary) = if let Some(instance_id) = skill_id.strip_prefix("instance:") {
        let record = db
            .connect()?
            .query_row(
                "SELECT si.path, dr.configured_path
                 FROM skill_instances si
                 INNER JOIN discovery_roots dr ON dr.id = si.root_id
                 WHERE si.id = ?1",
                params![instance_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::State("discovered Skill was not found".to_string()))?;
        (PathBuf::from(record.0), PathBuf::from(record.1))
    } else {
        let library_path = db
            .connect()?
            .query_row(
                "SELECT library_path FROM skills WHERE id = ?1",
                params![skill_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| AppError::State("Library Skill was not found".to_string()))?;
        (PathBuf::from(library_path), library_root.to_path_buf())
    };

    read_document_within(&directory, &boundary, skill_id)
}

fn read_document_within(
    directory: &Path,
    boundary: &Path,
    skill_id: &str,
) -> Result<SkillDocumentRecord, AppError> {
    let boundary_metadata = fs::symlink_metadata(boundary)?;
    if boundary_metadata.file_type().is_symlink() || !boundary_metadata.is_dir() {
        return Err(AppError::State(
            "Skill boundary is not a real directory".to_string(),
        ));
    }
    let canonical_boundary = boundary.canonicalize()?;

    let directory_metadata = fs::symlink_metadata(directory)?;
    if directory_metadata.file_type().is_symlink() || !directory_metadata.is_dir() {
        return Err(AppError::InvalidSkill(
            "Skill path is not a real directory".to_string(),
        ));
    }
    let canonical_directory = directory.canonicalize()?;
    if !canonical_directory.starts_with(&canonical_boundary) {
        return Err(AppError::State(
            "Skill path is outside its registered boundary".to_string(),
        ));
    }

    let document_path = canonical_directory.join("SKILL.md");
    let document_metadata = fs::symlink_metadata(&document_path)?;
    if document_metadata.file_type().is_symlink() || !document_metadata.is_file() {
        return Err(AppError::InvalidSkill(
            "SKILL.md is not a real file".to_string(),
        ));
    }
    if document_metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::InvalidSkill(format!(
            "SKILL.md exceeds the {} byte preview limit",
            MAX_DOCUMENT_BYTES
        )));
    }

    let canonical_document = document_path.canonicalize()?;
    if !canonical_document.starts_with(&canonical_directory) {
        return Err(AppError::State(
            "SKILL.md resolved outside the Skill directory".to_string(),
        ));
    }

    let content = fs::read_to_string(&canonical_document)?;
    Ok(SkillDocumentRecord {
        skill_id: skill_id.to_string(),
        path: canonical_document.to_string_lossy().into_owned(),
        size_bytes: document_metadata.len(),
        line_count: content.lines().count(),
        content,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::read_document_within;

    fn fixture_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "skills-manger-document-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn reads_skill_document_inside_registered_boundary() {
        let root = fixture_root("read");
        let skill = root.join("demo-skill");
        fs::create_dir_all(&skill).expect("fixture directory should exist");
        let content = "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n";
        fs::write(skill.join("SKILL.md"), content).expect("fixture should write");

        let record = read_document_within(&skill, &root, "skill-1")
            .expect("document should read");
        assert_eq!(record.skill_id, "skill-1");
        assert_eq!(record.content, content);
        assert_eq!(record.line_count, 7);
        assert!(record.path.ends_with("SKILL.md"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_skill_document_outside_registered_boundary() {
        let root = fixture_root("boundary");
        let boundary = root.join("registered");
        let outside = root.join("outside");
        fs::create_dir_all(&boundary).expect("boundary should exist");
        fs::create_dir_all(&outside).expect("outside should exist");
        fs::write(
            outside.join("SKILL.md"),
            "---\nname: outside\ndescription: Outside\n---\n",
        )
        .expect("fixture should write");

        let error = read_document_within(&outside, &boundary, "skill-2")
            .expect_err("outside path should be rejected");
        assert!(error
            .to_string()
            .contains("outside its registered boundary"));

        let _ = fs::remove_dir_all(root);
    }
}
