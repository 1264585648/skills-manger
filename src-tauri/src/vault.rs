//! Central Vault management: Incorporation, Auto-merging, and Conflict resolution.
//!
//! All managed skills physically reside in `<app_data>/vault/skills/<skill-name>`.
//! Agents only hold junctions/symlinks to the vault copy. When links are revoked,
//! the skill remains safely preserved in the vault.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{
    agent_discovery::{self, VAULT_AGENT_ID, VAULT_ROOT_ID},
    db::{Database, DiscoveryRootRecord},
    error::AppError,
    linker, skills,
};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutoMergeReport {
    pub merged_names: Vec<String>,
    pub links_created: usize,
}

/// Recursively copy directory and all its files/subdirectories.
pub fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dest_child = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &dest_child)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), dest_child)?;
        }
    }
    Ok(())
}

/// Check if two paths refer to the same physical location.
pub(crate) fn same_path_or_file(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn sanitize_for_filename(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Incorporate an external skill into the Central Vault.
///
/// 1. Verifies the skill at `source_path`.
/// 2. Copies to `vault/skills/<skill_name>` (rejecting if a different copy already exists).
/// 3. If `source_path` belongs to a registered agent discovery root, replaces the
///    original directory with a junction pointing to the vault copy, and records the link.
/// 4. Copies governance metadata.
pub fn incorporate_skill(
    db: &Database,
    source_path: &Path,
    timestamp: i64,
) -> Result<PathBuf, AppError> {
    let canonical_source = source_path
        .canonicalize()
        .unwrap_or_else(|_| source_path.to_path_buf());
    let vault_skills_dir = db.vault_skills_dir();
    fs::create_dir_all(&vault_skills_dir)?;
    let canonical_vault_dir = vault_skills_dir
        .canonicalize()
        .unwrap_or_else(|_| vault_skills_dir.clone());

    let inspected = skills::inspect_skill(source_path, None)?;
    let skill_name = inspected.name.clone();
    let target_in_vault = vault_skills_dir.join(&skill_name);

    if canonical_source.starts_with(&canonical_vault_dir) {
        return Ok(canonical_source);
    }

    // If target in vault does not exist, copy to vault.
    // If it already exists, verify content hash to prevent silent overwriting.
    if !target_in_vault.exists() {
        copy_dir_all(source_path, &target_in_vault)?;
    } else {
        let vault_inspected = skills::inspect_skill(&target_in_vault, None)?;
        if vault_inspected.content_hash != inspected.content_hash {
            return Err(AppError::State(format!(
                "中央库已存在同名但内容不同的技能 '{skill_name}'。为保护数据安全，普通纳管不会覆盖已有母本，请通过冲突裁决或为新技能重命名 (Fork)。"
            )));
        }
    }

    let canonical_vault_skill = target_in_vault
        .canonicalize()
        .unwrap_or_else(|_| target_in_vault.clone());

    // Replace original source with junction if it's inside an enabled discovery root
    let roots = db.list_discovery_roots()?;
    let matched_root = roots.iter().find(|root| {
        if !root.enabled || root.id == VAULT_ROOT_ID {
            return false;
        }
        let root_path = Path::new(
            root.canonical_path
                .as_deref()
                .unwrap_or(&root.configured_path),
        );
        let canonical_root = root_path
            .canonicalize()
            .unwrap_or_else(|_| root_path.to_path_buf());
        canonical_source.starts_with(&canonical_root)
    });

    if let Some(root) = matched_root {
        let root_slug = sanitize_for_filename(&root.id);
        let archive_spot = db
            .vault_archive_dir()
            .join(format!("{}-orig-{}-{timestamp}", skill_name, root_slug));
        fs::create_dir_all(&archive_spot)?;
        copy_dir_all(source_path, &archive_spot)?;
        skills::remove_if_exists(source_path)?;

        if let Err(link_err) = linker::create_directory_link(&canonical_vault_skill, source_path) {
            let _ = copy_dir_all(&archive_spot, source_path);
            return Err(link_err);
        }
        linker::upsert_link(
            db,
            &canonical_vault_skill.to_string_lossy(),
            root,
            source_path,
            timestamp,
        )?;
    }

    // Migrate governance metadata
    let _ = db.transfer_governance_metadata(
        &canonical_source.to_string_lossy(),
        &canonical_vault_skill.to_string_lossy(),
        timestamp,
    );

    // Explicitly register the new vault skill instance in database so it can be queried/linked immediately
    let vault_instance_id = agent_discovery::stable_instance_id(
        VAULT_AGENT_ID,
        VAULT_ROOT_ID,
        "user",
        &canonical_vault_skill.to_string_lossy(),
    );
    let vault_draft = agent_discovery::SkillInstanceDraft {
        id: vault_instance_id,
        agent_id: VAULT_AGENT_ID.to_string(),
        root_id: VAULT_ROOT_ID.to_string(),
        scope: "user".to_string(),
        path: canonical_vault_skill.to_string_lossy().into_owned(),
        name: inspected.name,
        description: inspected.description,
        content_hash: inspected.content_hash,
        content_signature: inspected.content_signature,
        script_count: inspected.script_count,
    };
    db.upsert_skill_instance_draft(&vault_draft, timestamp)?;

    Ok(canonical_vault_skill)
}

/// Deactivate a home skill: incorporates it into Central Vault to safely preserve files,
/// but immediately removes the junction from the origin directory and deletes the link record.
pub fn deactivate_home_skill(
    db: &Database,
    source_path: &Path,
    timestamp: i64,
) -> Result<PathBuf, AppError> {
    let canonical_vault_skill = incorporate_skill(db, source_path, timestamp)?;

    // If source_path was replaced with a junction, remove the junction
    if let Ok(metadata) = fs::symlink_metadata(source_path) {
        if metadata.file_type().is_symlink() {
            skills::remove_if_exists(source_path)?;
        }
    }

    // Remove any link records pointing to source_path
    let source_str = source_path.to_string_lossy();
    let norm_source = source_str.replace('/', "\\");
    let links = db.list_links()?;
    for link in links {
        let norm_link = link.link_path.replace('/', "\\");
        if norm_link.eq_ignore_ascii_case(&norm_source) {
            let _ = db.delete_link(&link.id);
        }
    }

    // Delete the old instance record for source_path from skill_instances
    let _ = db.delete_skill_instance_by_path(&source_str);

    Ok(canonical_vault_skill)
}

/// Automatically merge all discovered skills that have identical names and identical content_hashes.
pub fn auto_merge_identical(db: &Database, timestamp: i64) -> Result<AutoMergeReport, AppError> {
    let instances = db.list_skill_instances()?;
    let mut by_name: HashMap<String, Vec<agent_discovery::SkillInstanceRecord>> = HashMap::new();
    for instance in instances {
        by_name
            .entry(instance.name.trim().to_lowercase())
            .or_default()
            .push(instance);
    }

    let mut merged_names = Vec::new();
    let mut links_created = 0;

    let roots_by_id: HashMap<String, DiscoveryRootRecord> = db
        .list_discovery_roots()?
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();

    for (name_key, group) in by_name {
        if group.len() <= 1 {
            continue;
        }
        // Check if all instances have the same content_hash
        let first_hash = &group[0].content_hash;
        let all_same = group.iter().all(|item| &item.content_hash == first_hash);
        if !all_same {
            continue;
        }

        // Find vault instance if one already exists
        let vault_instance = group.iter().find(|i| i.agent_id == VAULT_AGENT_ID);
        let vault_skill_path = if let Some(vi) = vault_instance {
            PathBuf::from(&vi.path)
        } else {
            // Pick the first instance and incorporate into vault
            let src = Path::new(&group[0].path);
            incorporate_skill(db, src, timestamp)?
        };

        // For all other instances, replace real directory with junction to vault
        for instance in &group {
            let inst_path = Path::new(&instance.path);
            if same_path_or_file(inst_path, &vault_skill_path) {
                continue;
            }

            if let Ok(meta) = fs::symlink_metadata(inst_path) {
                if !meta.file_type().is_symlink() {
                    let root_slug = sanitize_for_filename(&instance.root_id);
                    let archive_dir = db.vault_archive_dir().join(format!(
                        "{}-{}-{}-{timestamp}",
                        name_key, instance.agent_id, root_slug
                    ));
                    fs::create_dir_all(&archive_dir)?;
                    copy_dir_all(inst_path, &archive_dir)?;
                    skills::remove_if_exists(inst_path)?;
                    if let Err(link_err) =
                        linker::create_directory_link(&vault_skill_path, inst_path)
                    {
                        let _ = copy_dir_all(&archive_dir, inst_path);
                        return Err(link_err);
                    }
                }
            }

            if let Some(root) = roots_by_id.get(&instance.root_id) {
                if root.agent_id != VAULT_AGENT_ID {
                    linker::upsert_link(
                        db,
                        &vault_skill_path.to_string_lossy(),
                        root,
                        inst_path,
                        timestamp,
                    )?;
                    links_created += 1;
                }
            }

            let _ = db.transfer_governance_metadata(
                &instance.path,
                &vault_skill_path.to_string_lossy(),
                timestamp,
            );
        }

        merged_names.push(group[0].name.clone());
    }

    Ok(AutoMergeReport {
        merged_names,
        links_created,
    })
}

/// Resolve conflicting skill copies with the same name by keeping the chosen winner.
pub fn manual_merge_keep_one(
    db: &Database,
    skill_name: &str,
    winner_path: &Path,
    timestamp: i64,
) -> Result<PathBuf, AppError> {
    if !winner_path.exists() {
        return Err(AppError::State(format!(
            "选中的母本路径不存在: {}",
            winner_path.display()
        )));
    }
    let winner_inspected = skills::inspect_skill(winner_path, None)?;
    if !winner_inspected.name.eq_ignore_ascii_case(skill_name) {
        return Err(AppError::State(format!(
            "选中的母本技能名 '{}' 与要合并的技能名 '{skill_name}' 不匹配",
            winner_inspected.name
        )));
    }

    let vault_skills_dir = db.vault_skills_dir();
    fs::create_dir_all(&vault_skills_dir)?;
    let target_in_vault = vault_skills_dir.join(skill_name);

    let is_same_winner = same_path_or_file(&target_in_vault, winner_path);

    // Archive current vault copy if different
    if target_in_vault.exists() && !is_same_winner {
        let archive_dir = db
            .vault_archive_dir()
            .join(format!("{}-replaced-{timestamp}", skill_name));
        fs::create_dir_all(&archive_dir)?;
        copy_dir_all(&target_in_vault, &archive_dir)?;
        skills::remove_if_exists(&target_in_vault)?;
    }

    if !is_same_winner {
        copy_dir_all(winner_path, &target_in_vault)?;
    }

    let canonical_vault_skill = target_in_vault
        .canonicalize()
        .unwrap_or_else(|_| target_in_vault.clone());

    let instances = db.list_skill_instances()?;
    let roots_by_id: HashMap<String, DiscoveryRootRecord> = db
        .list_discovery_roots()?
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();

    for instance in instances {
        if !instance.name.eq_ignore_ascii_case(skill_name) {
            continue;
        }
        let inst_path = Path::new(&instance.path);
        if same_path_or_file(inst_path, &canonical_vault_skill) {
            continue;
        }

        if let Ok(meta) = fs::symlink_metadata(inst_path) {
            if !meta.file_type().is_symlink() {
                let root_slug = sanitize_for_filename(&instance.root_id);
                let archive_spot = db.vault_archive_dir().join(format!(
                    "{}-{}-{}-{timestamp}",
                    skill_name, instance.agent_id, root_slug
                ));
                fs::create_dir_all(&archive_spot)?;
                copy_dir_all(inst_path, &archive_spot)?;
                skills::remove_if_exists(inst_path)?;
                if let Err(link_err) =
                    linker::create_directory_link(&canonical_vault_skill, inst_path)
                {
                    let _ = copy_dir_all(&archive_spot, inst_path);
                    return Err(link_err);
                }
            }
        }

        if let Some(root) = roots_by_id.get(&instance.root_id) {
            if root.agent_id != VAULT_AGENT_ID {
                linker::upsert_link(
                    db,
                    &canonical_vault_skill.to_string_lossy(),
                    root,
                    inst_path,
                    timestamp,
                )?;
            }
        }

        let _ = db.transfer_governance_metadata(
            &instance.path,
            &canonical_vault_skill.to_string_lossy(),
            timestamp,
        );
    }

    Ok(canonical_vault_skill)
}

/// Fork a skill to a new name and store it in the Central Vault.
pub fn fork_skill(
    db: &Database,
    source_path: &Path,
    new_name: &str,
    timestamp: i64,
) -> Result<PathBuf, AppError> {
    let new_name = new_name.trim().to_lowercase();
    if new_name.is_empty() {
        return Err(AppError::State("新技能名称不能为空".to_string()));
    }
    if new_name.len() > 64 {
        return Err(AppError::State(
            "新技能名称长度不能超过 64 个字符".to_string(),
        ));
    }

    let is_valid_name = new_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !new_name.starts_with('-')
        && !new_name.ends_with('-')
        && !new_name.contains("..");
    if !is_valid_name {
        return Err(AppError::State(format!(
            "新技能名称 '{new_name}' 不合法：仅允许使用小写英文字母、数字、短横线和下划线，且不能包含路径字符"
        )));
    }

    let reserved = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if reserved.contains(&new_name.as_str()) {
        return Err(AppError::State(format!(
            "新技能名称 '{new_name}' 为系统保留名称，不可使用"
        )));
    }

    let vault_skills_dir = db.vault_skills_dir();
    fs::create_dir_all(&vault_skills_dir)?;
    let target_in_vault = vault_skills_dir.join(&new_name);

    if target_in_vault.parent() != Some(&vault_skills_dir) {
        return Err(AppError::State(
            "新技能路径必须位于中央库 skills 目录内".to_string(),
        ));
    }

    if target_in_vault.exists() {
        return Err(AppError::State(format!(
            "中央库已存在名为 {new_name} 的技能"
        )));
    }

    let copy_result = (|| -> Result<(), AppError> {
        copy_dir_all(source_path, &target_in_vault)?;

        // Rewrite SKILL.md frontmatter name
        let manifest_path = target_in_vault.join("SKILL.md");
        if manifest_path.is_file() {
            let content = fs::read_to_string(&manifest_path)?;
            let mut new_lines = Vec::new();
            let mut replaced = false;
            for line in content.lines() {
                if !replaced && line.trim_start().starts_with("name:") {
                    new_lines.push(format!("name: {new_name}"));
                    replaced = true;
                } else {
                    new_lines.push(line.to_string());
                }
            }
            fs::write(&manifest_path, new_lines.join("\n"))?;
        }

        // Verify it is now a valid skill
        skills::inspect_skill(&target_in_vault, None)?;
        Ok(())
    })();

    if let Err(err) = copy_result {
        let _ = skills::remove_if_exists(&target_in_vault);
        return Err(err);
    }

    let canonical = target_in_vault
        .canonicalize()
        .unwrap_or_else(|_| target_in_vault.clone());

    let _ = db.transfer_governance_metadata(
        &source_path.to_string_lossy(),
        &canonical.to_string_lossy(),
        timestamp,
    );

    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::unix_timestamp;

    fn test_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("skills-manger-vault-{label}-{nonce}"))
    }

    fn write_skill(root: &Path, name: &str, body: &str) {
        fs::create_dir_all(root).expect("skill dir should exist");
        fs::write(
            root.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: Fixture.\n---\n\n{body}\n"),
        )
        .expect("manifest should write");
    }

    #[test]
    fn incorporate_and_auto_merge() {
        let directory = test_root("auto-merge");
        let claude_root = directory.join(".claude").join("skills");
        let cursor_root = directory.join(".cursor").join("skills");
        write_skill(&claude_root.join("test-skill"), "test-skill", "same body");
        write_skill(&cursor_root.join("test-skill"), "test-skill", "same body");

        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        agent_discovery::ensure_targets_registered(&database, now)
            .expect("targets should register");

        let claude_rec =
            agent_discovery::register_project_root(&database, "claude-code", &claude_root, now)
                .expect("claude root should register");
        let cursor_rec =
            agent_discovery::register_project_root(&database, "cursor", &cursor_root, now)
                .expect("cursor root should register");

        agent_discovery::scan_all(&database, now).expect("scan should work");

        let report = auto_merge_identical(&database, now).expect("auto merge should succeed");
        assert!(report.merged_names.contains(&"test-skill".to_string()));

        // After auto-merge, vault contains test-skill
        let vault_skill = database.vault_skills_dir().join("test-skill");
        assert!(vault_skill.join("SKILL.md").is_file());

        // And both roots have symlinks
        let claude_skill = claude_root.join("test-skill");
        let cursor_skill = cursor_root.join("test-skill");
        assert!(fs::symlink_metadata(&claude_skill)
            .expect("claude skill should exist")
            .file_type()
            .is_symlink());
        assert!(fs::symlink_metadata(&cursor_skill)
            .expect("cursor skill should exist")
            .file_type()
            .is_symlink());

        // Unlink claude: cursor and vault still remain!
        let links: Vec<_> = database
            .list_links()
            .expect("links should list")
            .into_iter()
            .filter(|l| l.target_root_id == claude_rec.id || l.target_root_id == cursor_rec.id)
            .collect();
        assert_eq!(links.len(), 2);

        let claude_link = links
            .iter()
            .find(|l| l.target_root_id == claude_rec.id)
            .unwrap();
        linker::unlink_skill(&database, &claude_link.id).expect("unlink should succeed");
        assert!(!claude_skill.exists());
        // Vault copy is still intact!
        assert!(vault_skill.join("SKILL.md").is_file());
        // Cursor still has its link!
        assert!(fs::symlink_metadata(&cursor_skill)
            .unwrap()
            .file_type()
            .is_symlink());

        // Unlink cursor (the last link): Vault copy still preserved!
        let cursor_link = links
            .iter()
            .find(|l| l.target_root_id == cursor_rec.id)
            .unwrap();
        linker::unlink_skill(&database, &cursor_link.id).expect("unlink should succeed");
        assert!(!cursor_skill.exists());
        let remaining_fixture_links: Vec<_> = database
            .list_links()
            .unwrap()
            .into_iter()
            .filter(|l| l.target_root_id == claude_rec.id || l.target_root_id == cursor_rec.id)
            .collect();
        assert!(remaining_fixture_links.is_empty());
        // Vault copy NEVER lost!
        assert!(vault_skill.join("SKILL.md").is_file());

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn manual_merge_same_directory_alias_does_not_destroy_winner() {
        let directory = test_root("alias-merge");
        fs::create_dir_all(&directory).expect("dir should exist");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        let vault_skill = database.vault_skills_dir().join("alias-test");
        write_skill(&vault_skill, "alias-test", "winner content");

        // Construct alias path with ".."
        let winner_alias = database
            .vault_skills_dir()
            .join("..")
            .join("skills")
            .join("alias-test");
        assert!(winner_alias.exists());

        let result = manual_merge_keep_one(&database, "alias-test", &winner_alias, now);
        assert!(
            result.is_ok(),
            "Merge with alias of same directory should succeed"
        );

        // Master files must still exist and not be wiped!
        assert!(vault_skill.join("SKILL.md").is_file());
        let content = fs::read_to_string(vault_skill.join("SKILL.md")).unwrap();
        assert!(content.contains("winner content"));

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn fork_skill_rejects_path_traversal_and_invalid_names() {
        let directory = test_root("fork-reject");
        fs::create_dir_all(&directory).expect("dir should exist");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        let source = directory.join("source-skill");
        write_skill(&source, "source-skill", "source content");

        // Path traversal attempt
        let err1 = fork_skill(&database, &source, "../escaped-skill", now);
        assert!(err1.is_err());
        assert!(!database
            .vault_skills_dir()
            .join("../escaped-skill")
            .exists());

        // Empty name
        let err2 = fork_skill(&database, &source, "   ", now);
        assert!(err2.is_err());

        // Windows reserved name
        let err3 = fork_skill(&database, &source, "con", now);
        assert!(err3.is_err());

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn incorporate_skill_rejects_overwriting_different_vault_master() {
        let directory = test_root("incorp-no-overwrite");
        fs::create_dir_all(&directory).expect("dir should exist");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        // Existing vault master
        let vault_skill = database.vault_skills_dir().join("clash-skill");
        write_skill(&vault_skill, "clash-skill", "master version");

        // External conflicting skill
        let ext_skill = directory.join("ext-skill").join("clash-skill");
        write_skill(&ext_skill, "clash-skill", "divergent external version");

        let result = incorporate_skill(&database, &ext_skill, now);
        assert!(
            result.is_err(),
            "Should refuse to overwrite different vault master"
        );
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("中央库已存在同名但内容不同的技能"));

        // Vault copy must remain untouched
        let content = fs::read_to_string(vault_skill.join("SKILL.md")).unwrap();
        assert!(content.contains("master version"));

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn deactivate_home_skill_preserves_in_vault_and_cleans_origin() {
        let directory = test_root("deactivate-home");
        fs::create_dir_all(&directory).expect("dir should exist");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        agent_discovery::ensure_targets_registered(&database, now).expect("targets");
        agent_discovery::ensure_vault_root(&database, now).expect("vault root");

        let agent_root = directory.join(".claude").join("skills");
        fs::create_dir_all(&agent_root).expect("root");
        let _root_record = agent_discovery::register_project_root(&database, "claude-code", &agent_root, now)
            .expect("register root");

        let skill_dir = agent_root.join("test-deactivate");
        write_skill(&skill_dir, "test-deactivate", "original skill content");

        agent_discovery::scan_all(&database, now).expect("scan");

        let canonical_vault = deactivate_home_skill(&database, &skill_dir, now + 1)
            .expect("deactivate should succeed");

        // Master files must exist in vault
        assert!(canonical_vault.join("SKILL.md").is_file());
        let content = fs::read_to_string(canonical_vault.join("SKILL.md")).unwrap();
        assert!(content.contains("original skill content"));

        // Origin directory must be completely removed
        assert!(!skill_dir.exists(), "Origin dir must not exist after deactivate");

        // No active links pointing to origin dir
        let links = database.list_links().expect("list links");
        assert!(links.is_empty(), "Links must be deleted");

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }
}


