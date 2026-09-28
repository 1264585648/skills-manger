//! Write-back: link a discovered skill into another agent's skills root.
//!
//! The link points at the skill's real directory — nothing is copied, and the
//! source stays the single source of truth. Existing real directories at the
//! destination are never overwritten; only links created by this app are
//! removed again.

use std::{fs, path::Path};

use serde::Serialize;

use crate::{
    db::{Database, LinkRecord},
    error::AppError,
    skills,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkOutcome {
    pub link: LinkRecord,
    pub created: bool,
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

pub(crate) fn create_directory_link(source: &Path, link: &Path) -> Result<(), AppError> {
    fs::create_dir_all(
        link.parent()
            .ok_or_else(|| AppError::State("链接目标缺少父目录".to_string()))?,
    )?;

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, link)?;
        Ok(())
    }

    #[cfg(windows)]
    {
        // Directory symlinks need SeCreateSymbolicLinkPrivilege; junctions do
        // not and work on every directory path, so prefer them on Windows.
        match std::os::windows::fs::symlink_dir(source, link) {
            Ok(()) => Ok(()),
            Err(_) => create_junction(source, link),
        }
    }
}

#[cfg(windows)]
fn create_junction(source: &Path, link: &Path) -> Result<(), AppError> {
    use std::{path::PathBuf, process::Command};

    // Junction targets must not use the \\?\ verbatim prefix.
    let target = source
        .to_string_lossy()
        .strip_prefix(r"\\?\")
        .map(PathBuf::from)
        .unwrap_or_else(|| source.to_path_buf());

    let output = Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            &link.to_string_lossy(),
            &target.to_string_lossy(),
        ])
        .output()?;
    if output.status.success() && link.exists() {
        Ok(())
    } else {
        Err(AppError::State(format!(
            "无法为 {} 创建目录联接（junction）；请以管理员身份运行或开启 Windows 开发者模式",
            link.display()
        )))
    }
}

/// Create (or re-record) a link from `skill_path` into `target_root_id`.
pub fn link_skill(
    db: &Database,
    skill_path: &str,
    target_root_id: &str,
    timestamp: i64,
) -> Result<LinkOutcome, AppError> {
    let instance = db
        .skill_instance_by_path(skill_path)?
        .ok_or_else(|| AppError::State("只能写入已在发现列表中存在的 Skill".to_string()))?;
    let root = db
        .discovery_root(target_root_id)?
        .ok_or_else(|| AppError::State("目标 Agent 目录不存在".to_string()))?;
    if !root.enabled {
        return Err(AppError::State("目标 Agent 目录已停用".to_string()));
    }

    let root_path = Path::new(
        root.canonical_path
            .as_deref()
            .unwrap_or(root.configured_path.as_str()),
    );
    let link_name = Path::new(&instance.path)
        .file_name()
        .ok_or_else(|| AppError::State("Skill 目录名无效".to_string()))?;
    let link_path = root_path.join(link_name);
    let source = Path::new(&instance.path);

    if let Ok(metadata) = fs::symlink_metadata(&link_path) {
        if metadata.file_type().is_symlink() {
            if same_file(&link_path, source) {
                let link = upsert_link(db, &instance.path, &root, &link_path, timestamp)?;
                return Ok(LinkOutcome {
                    link,
                    created: false,
                });
            }
            return Err(AppError::State(
                "目标位置已被其他软连接占用，请先移除该连接".to_string(),
            ));
        }
        return Err(AppError::State(
            "目标位置已存在真实文件/目录，不会覆盖".to_string(),
        ));
    }

    create_directory_link(source, &link_path)?;
    let link = upsert_link(db, &instance.path, &root, &link_path, timestamp)?;
    Ok(LinkOutcome {
        link,
        created: true,
    })
}

pub(crate) fn upsert_link(
    db: &Database,
    skill_path: &str,
    root: &crate::db::DiscoveryRootRecord,
    link_path: &Path,
    timestamp: i64,
) -> Result<LinkRecord, AppError> {
    let id = skills::hash_text(&format!("link\0{}\0{}", root.id, skill_path));
    let link = LinkRecord {
        id: id.clone(),
        skill_path: skill_path.to_string(),
        skill_name: String::new(),
        target_root_id: root.id.clone(),
        target_agent_id: root.agent_id.clone(),
        target_root_path: root.configured_path.clone(),
        link_path: link_path.to_string_lossy().into_owned(),
        created_at: timestamp,
    };
    db.insert_link(&link)?;
    db.link_by_id(&id)?
        .ok_or_else(|| AppError::State("连接记录写入失败".to_string()))
}

/// Remove a link created by this app: both the filesystem link and the record.
pub fn unlink_skill(db: &Database, link_id: &str) -> Result<LinkRecord, AppError> {
    let link = db
        .link_by_id(link_id)?
        .ok_or_else(|| AppError::State("连接记录不存在".to_string()))?;

    let path = Path::new(&link.link_path);
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            skills::remove_if_exists(path)?;
        }
        Ok(_) => {
            return Err(AppError::State(
                "目标位置已不是软连接，为避免误删未做处理".to_string(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    db.delete_link(link_id)?;
    Ok(link)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::{agent_discovery, db::Database, skills::unix_timestamp};

    use super::*;

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("skills-manger-linker-{label}-{nonce}"))
    }

    fn write_skill(root: &std::path::Path, name: &str) {
        fs::create_dir_all(root).expect("skill directory should exist");
        fs::write(
            root.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: Linker fixture.\n---\n\n# Test\n"),
        )
        .expect("manifest should write");
    }

    #[test]
    fn link_and_unlink_round_trip() {
        let directory = test_root("round-trip");
        let source_root = directory.join("source").join(".claude").join("skills");
        let target_root = directory.join("target").join(".agents").join("skills");
        write_skill(&source_root.join("demo-skill"), "demo-skill");
        fs::create_dir_all(&target_root).expect("target root should exist");

        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        agent_discovery::ensure_targets_registered(&database, now)
            .expect("targets should register");

        let _source =
            agent_discovery::register_project_root(&database, "claude-code", &source_root, now)
                .expect("source root should register");
        let target = agent_discovery::register_project_root(&database, "codex", &target_root, now)
            .expect("target root should register");
        agent_discovery::scan_all(&database, now).expect("scan should work");

        let skill_path = source_root
            .join("demo-skill")
            .canonicalize()
            .expect("skill should canonicalize")
            .to_string_lossy()
            .into_owned();

        let outcome =
            link_skill(&database, &skill_path, &target.id, now).expect("link should be created");
        assert!(outcome.created);
        let link_path = Path::new(&outcome.link.link_path);
        assert!(fs::symlink_metadata(link_path)
            .expect("link should exist")
            .file_type()
            .is_symlink());
        assert!(link_path.join("SKILL.md").is_file());

        // idempotent: linking again keeps a single record
        let again =
            link_skill(&database, &skill_path, &target.id, now + 1).expect("relink should succeed");
        assert!(!again.created);
        assert_eq!(database.list_links().expect("links should list").len(), 1);

        // rescan does not warn about our own link. Warnings about the real
        // user roots on this machine are out of scope for this fixture.
        let fixture = directory.to_string_lossy().into_owned();
        let warnings: Vec<String> = agent_discovery::scan_all(&database, now + 2)
            .expect("rescan should work")
            .warnings
            .into_iter()
            .filter(|warning| warning.contains(&fixture))
            .collect();
        assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");

        unlink_skill(&database, &outcome.link.id).expect("unlink should work");
        assert!(!link_path.exists());
        assert!(database.list_links().expect("links should list").is_empty());

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn real_directory_at_target_is_never_overwritten() {
        let directory = test_root("occupied");
        let source_root = directory.join("source").join(".claude").join("skills");
        let target_root = directory.join("target").join(".agents").join("skills");
        write_skill(&source_root.join("demo-skill"), "demo-skill");
        write_skill(&target_root.join("demo-skill"), "demo-skill");

        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        agent_discovery::ensure_targets_registered(&database, now)
            .expect("targets should register");

        agent_discovery::register_project_root(&database, "claude-code", &source_root, now)
            .expect("source root should register");
        let target = agent_discovery::register_project_root(&database, "codex", &target_root, now)
            .expect("target root should register");
        agent_discovery::scan_all(&database, now).expect("scan should work");

        let skill_path = source_root
            .join("demo-skill")
            .canonicalize()
            .expect("skill should canonicalize")
            .to_string_lossy()
            .into_owned();

        let error = link_skill(&database, &skill_path, &target.id, now)
            .expect_err("occupied target should fail");
        assert!(error.to_string().contains("不会覆盖"));
        // the pre-existing real directory is untouched
        assert!(target_root.join("demo-skill").join("SKILL.md").is_file());

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }
}
