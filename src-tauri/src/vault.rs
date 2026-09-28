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

/// Incorporate an external skill into the Central Vault.
///
/// 1. Verifies the skill at `source_path`.
/// 2. Copies to `vault/skills/<skill_name>`.
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
    let skill_name = inspected.name;
    let target_in_vault = vault_skills_dir.join(&skill_name);

    if canonical_source.starts_with(&canonical_vault_dir) {
        return Ok(canonical_source);
    }

    // If target in vault does not exist or differs, copy to vault
    if !target_in_vault.exists() {
        copy_dir_all(source_path, &target_in_vault)?;
    } else {
        // Vault copy exists: check if content hash matches
        let vault_inspected = skills::inspect_skill(&target_in_vault, None)?;
        if vault_inspected.content_hash != inspected.content_hash {
            // Archive current vault copy before replacing
            let archive_dir = db
                .vault_archive_dir()
                .join(format!("{}-{timestamp}", skill_name));
            let _ = fs::create_dir_all(&archive_dir);
            let _ = copy_dir_all(&target_in_vault, &archive_dir);
            let _ = skills::remove_if_exists(&target_in_vault);
            copy_dir_all(source_path, &target_in_vault)?;
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
        // Move original to archive for complete safety
        let archive_spot = db
            .vault_archive_dir()
            .join(format!("{}-orig-{timestamp}", skill_name));
        let _ = fs::create_dir_all(&archive_spot);
        let _ = copy_dir_all(source_path, &archive_spot);
        skills::remove_if_exists(source_path)?;

        // Create junction at original path pointing to vault
        linker::create_directory_link(&canonical_vault_skill, source_path)?;
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
            if inst_path == vault_skill_path {
                continue;
            }

            if let Ok(meta) = fs::symlink_metadata(inst_path) {
                if !meta.file_type().is_symlink() {
                    let archive_dir = db
                        .vault_archive_dir()
                        .join(format!("{}-{}-{timestamp}", name_key, instance.agent_id));
                    let _ = fs::create_dir_all(&archive_dir);
                    let _ = copy_dir_all(inst_path, &archive_dir);
                    let _ = skills::remove_if_exists(inst_path);
                    let _ = linker::create_directory_link(&vault_skill_path, inst_path);
                }
            }

            if let Some(root) = roots_by_id.get(&instance.root_id) {
                if root.agent_id != VAULT_AGENT_ID {
                    let _ = linker::upsert_link(
                        db,
                        &vault_skill_path.to_string_lossy(),
                        root,
                        inst_path,
                        timestamp,
                    );
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
    let vault_skills_dir = db.vault_skills_dir();
    fs::create_dir_all(&vault_skills_dir)?;
    let target_in_vault = vault_skills_dir.join(skill_name);

    // Archive current vault copy if different
    if target_in_vault.exists() && target_in_vault != winner_path {
        let archive_dir = db
            .vault_archive_dir()
            .join(format!("{}-replaced-{timestamp}", skill_name));
        let _ = fs::create_dir_all(&archive_dir);
        let _ = copy_dir_all(&target_in_vault, &archive_dir);
        let _ = skills::remove_if_exists(&target_in_vault);
    }

    if target_in_vault != winner_path {
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
        if inst_path == canonical_vault_skill {
            continue;
        }

        if let Ok(meta) = fs::symlink_metadata(inst_path) {
            if !meta.file_type().is_symlink() {
                let archive_spot = db
                    .vault_archive_dir()
                    .join(format!("{}-{}-{timestamp}", skill_name, instance.agent_id));
                let _ = fs::create_dir_all(&archive_spot);
                let _ = copy_dir_all(inst_path, &archive_spot);
                let _ = skills::remove_if_exists(inst_path);
                let _ = linker::create_directory_link(&canonical_vault_skill, inst_path);
            }
        }

        if let Some(root) = roots_by_id.get(&instance.root_id) {
            if root.agent_id != VAULT_AGENT_ID {
                let _ = linker::upsert_link(
                    db,
                    &canonical_vault_skill.to_string_lossy(),
                    root,
                    inst_path,
                    timestamp,
                );
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

    let vault_skills_dir = db.vault_skills_dir();
    fs::create_dir_all(&vault_skills_dir)?;
    let target_in_vault = vault_skills_dir.join(&new_name);

    if target_in_vault.exists() {
        return Err(AppError::State(format!(
            "中央库已存在名为 {new_name} 的技能"
        )));
    }

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
        let fixture_marker = directory.to_string_lossy().into_owned();
        let links: Vec<_> = database
            .list_links()
            .expect("links should list")
            .into_iter()
            .filter(|l| l.link_path.contains(&fixture_marker))
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
            .filter(|l| l.link_path.contains(&fixture_marker))
            .collect();
        assert!(remaining_fixture_links.is_empty());
        // Vault copy NEVER lost!
        assert!(vault_skill.join("SKILL.md").is_file());

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }
}
