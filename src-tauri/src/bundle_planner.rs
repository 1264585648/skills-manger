use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::Database, error::AppError, safe_apply, skills};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleItemRecord {
    pub skill_id: String,
    pub mode: String,
    pub position: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub items: Vec<BundleItemRecord>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleDraft {
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    pub items: Vec<BundleItemDraft>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleItemDraft {
    pub skill_id: String,
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanItemRecord {
    pub id: String,
    pub skill_id: String,
    pub skill_name: String,
    pub mode: String,
    pub action: String,
    pub current_hash: Option<String>,
    pub library_hash: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_relative: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanRecord {
    pub id: String,
    pub bundle_id: String,
    pub root_id: String,
    pub items: Vec<SyncPlanItemRecord>,
    pub warnings: Vec<String>,
    pub requires_confirmation: bool,
    #[serde(default)]
    pub selection: Option<Vec<String>>,
    #[serde(default)]
    pub overwrite: bool,
    #[serde(default)]
    pub root_path: String,
    #[serde(default)]
    pub affected_agents: Vec<String>,
}

pub fn generate_sync_plan(
    db: &Database,
    bundle_id: &str,
    root_id: &str,
) -> Result<SyncPlanRecord, AppError> {
    let bundle = db
        .list_bundles()?
        .into_iter()
        .find(|bundle| bundle.id == bundle_id)
        .ok_or_else(|| AppError::State("bundle was not found".to_string()))?;
    let root = db
        .list_discovery_roots()?
        .into_iter()
        .find(|root| root.id == root_id && root.enabled)
        .ok_or_else(|| AppError::State("enabled discovery root was not found".to_string()))?;
    let library = db.list_skills()?;
    let configured_root = Path::new(&root.configured_path);
    let root_path = configured_root
        .canonicalize()
        .unwrap_or_else(|_| configured_root.to_path_buf());

    let mut items = Vec::new();
    let mut warnings = Vec::new();
    for bundle_item in &bundle.items {
        let skill = library
            .iter()
            .find(|skill| skill.id == bundle_item.skill_id)
            .ok_or_else(|| {
                AppError::State(format!(
                    "bundle references missing Library Skill {}",
                    bundle_item.skill_id
                ))
            })?;
        let destination = root_path.join(&skill.name);
        let deployment = safe_apply::deployment_for(db, &skill.id, &root.id, &destination)?;
        let (action, current_hash, reason) = if let Some(deployment) = deployment {
            if Path::new(&deployment.destination_path) != destination {
                warnings.push(format!(
                    "owned destination changed for Skill '{}'",
                    skill.name
                ));
                (
                    "conflict",
                    None,
                    "Deployment destination does not match the registered root".to_string(),
                )
            } else if !destination.exists() {
                (
                    "add",
                    None,
                    "Owned Agent instance is missing and can be restored".to_string(),
                )
            } else {
                match skills::inspect_skill(&destination) {
                    Ok(current) if current.content_hash != deployment.deployed_hash => (
                        "conflict",
                        Some(current.content_hash),
                        "Target Drift differs from the last deployed hash".to_string(),
                    ),
                    Ok(current) if current.content_hash == skill.content_hash => (
                        "unchanged",
                        Some(current.content_hash),
                        "Owned Agent instance matches the Canonical Library hash".to_string(),
                    ),
                    Ok(current) => (
                        "update",
                        Some(current.content_hash),
                        "Owned Agent instance is clean and the Library hash changed".to_string(),
                    ),
                    Err(error) => (
                        "conflict",
                        None,
                        format!("Owned Agent instance cannot be verified: {error}"),
                    ),
                }
            }
        } else if !destination.exists() {
            (
                "add",
                None,
                "Skill is absent from the selected Agent root".to_string(),
            )
        } else {
            match skills::inspect_skill(&destination) {
                Ok(current) if current.content_hash == skill.content_hash => (
                    "unchanged",
                    Some(current.content_hash),
                    "Unmanaged Agent instance already matches the Library hash".to_string(),
                ),
                Ok(current) => (
                    "conflict",
                    Some(current.content_hash),
                    "Unmanaged Agent content differs; ownership must be resolved before any write"
                        .to_string(),
                ),
                Err(error) => (
                    "conflict",
                    None,
                    format!("Unmanaged destination cannot be verified: {error}"),
                ),
            }
        };
        items.push(SyncPlanItemRecord {
            id: hash_text(&format!("{}\0{}\0{}", bundle.id, root.id, skill.id)),
            skill_id: skill.id.clone(),
            skill_name: skill.name.clone(),
            mode: bundle_item.mode.clone(),
            action: action.to_string(),
            current_hash,
            library_hash: skill.content_hash.clone(),
            reason,
            destination_relative: None,
        });
    }

    let signature = items
        .iter()
        .map(|item| {
            format!(
                "{}:{}:{}:{}",
                item.skill_id,
                item.action,
                item.current_hash.as_deref().unwrap_or("-"),
                item.library_hash
            )
        })
        .collect::<Vec<_>>()
        .join("|");
    let plan = SyncPlanRecord {
        id: hash_text(&format!("{}\0{}\0{}", bundle.id, root.id, signature)),
        bundle_id: bundle.id,
        root_id: root.id,
        requires_confirmation: items.iter().any(|item| item.action != "unchanged"),
        items,
        warnings,
        selection: None,
        overwrite: false,
        root_path: root_path.to_string_lossy().into_owned(),
        affected_agents: Vec::new(),
    };
    safe_apply::persist_plan(db, &plan, unix_timestamp()?)?;
    Ok(plan)
}

pub fn generate_selection_plan(
    db: &Database,
    skill_ids: &[String],
    root_id: &str,
) -> Result<SyncPlanRecord, AppError> {
    generate_selection_plan_at(db, skill_ids, root_id, &std::collections::BTreeMap::new())
}

pub fn generate_selection_plan_at(
    db: &Database,
    skill_ids: &[String],
    root_id: &str,
    destinations: &std::collections::BTreeMap<String, String>,
) -> Result<SyncPlanRecord, AppError> {
    let mut ids = skill_ids.to_vec();
    ids.sort();
    ids.dedup();
    let selections = ids
        .into_iter()
        .map(|id| {
            let relative = destinations.get(&id).cloned();
            (id, relative)
        })
        .collect::<Vec<_>>();
    generate_selection_targets(db, root_id, &selections)
}

pub fn generate_selection_targets(
    db: &Database,
    root_id: &str,
    targets: &[(String, Option<String>)],
) -> Result<SyncPlanRecord, AppError> {
    if targets.is_empty() {
        return Err(AppError::State("请先选择技能".into()));
    }
    let roots = db.list_discovery_roots()?;
    let root = roots
        .iter()
        .find(|r| r.id == root_id && r.enabled)
        .ok_or_else(|| AppError::State("目标目录不可用或已关闭".into()))?;
    if let Some(info) =
        crate::agent_center::get::<crate::agent_center::RootInfo>(db, "root", root_id)?
    {
        if !info.writable {
            return Err(AppError::State(
                "系统或插件目录仅供查看，请选择用户或项目目录".into(),
            ));
        }
    }
    let root_path = crate::safe_apply::prospective_root(Path::new(&root.configured_path))?;
    crate::agent_center::assert_writable_root(db, &root_path)?;
    let library = db.list_skills()?;
    let mut items = Vec::new();
    let mut names = std::collections::HashSet::new();
    let mut targets = targets.to_vec();
    targets.sort();
    targets.dedup();
    let selection = targets.iter().map(|t| t.0.clone()).collect::<Vec<_>>();
    for (id, relative) in &targets {
        let skill = library
            .iter()
            .find(|s| s.id == *id)
            .ok_or_else(|| AppError::State("技能库记录不存在，请刷新".into()))?;
        if !names.insert(relative.as_deref().unwrap_or(&skill.name).to_lowercase()) {
            return Err(AppError::State(format!(
                "所选技能存在重复名称：{}",
                skill.name
            )));
        }
        let verified = skills::inspect_managed_skill(Path::new(&skill.library_path), &skill.name)?;
        if verified.0 != skill.content_hash {
            return Err(AppError::State(format!(
                "技能库内容已变化，请重新导入：{}",
                skill.name
            )));
        }
        let relative = relative.clone();
        let destination = crate::safe_apply::selection_destination(
            &root_path,
            relative.as_deref().unwrap_or(&skill.name),
        )?;
        let current_hash = crate::safe_apply::target_fingerprint(&destination)?;
        let unchanged = std::fs::symlink_metadata(&destination)
            .is_ok_and(|m| !m.file_type().is_symlink())
            && skills::inspect_portable_skill(&destination)
                .is_ok_and(|s| s.content_hash == skill.content_hash);
        items.push(SyncPlanItemRecord {
            id: hash_text(&format!(
                "{root_id}\0{id}\0{}",
                relative.as_deref().unwrap_or(&skill.name)
            )),
            skill_id: id.clone(),
            skill_name: skill.name.clone(),
            mode: "required".into(),
            action: if unchanged {
                "unchanged"
            } else if current_hash.is_none() {
                "add"
            } else {
                "update"
            }
            .into(),
            current_hash,
            library_hash: skill.content_hash.clone(),
            reason: if unchanged {
                "目标与技能库一致"
            } else if destination.exists() || std::fs::symlink_metadata(&destination).is_ok() {
                "备份现有内容，以技能库覆盖目标"
            } else {
                "安装到目标目录"
            }
            .into(),
            destination_relative: relative,
        });
    }
    let root_text = root_path.to_string_lossy().into_owned();
    let affected_agents: Vec<String> = roots
        .iter()
        .filter(|r| {
            crate::safe_apply::prospective_root(Path::new(&r.configured_path))
                .is_ok_and(|p| p == root_path)
        })
        .map(|r| r.agent_id.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let id = hash_text(&serde_json::to_string(&(
        root_id,
        &root_text,
        root_path.exists(),
        &items,
        &affected_agents,
    ))?);
    let plan = SyncPlanRecord {
        id,
        bundle_id: String::new(),
        root_id: root_id.into(),
        requires_confirmation: items.iter().any(|i| i.action != "unchanged"),
        items,
        warnings: vec![],
        selection: Some(selection),
        overwrite: true,
        root_path: root_text,
        affected_agents,
    };
    safe_apply::persist_plan(db, &plan, unix_timestamp()?)?;
    Ok(plan)
}

fn unix_timestamp() -> Result<i64, AppError> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::State(format!("system clock error: {error}")))?
        .as_secs() as i64)
}

pub(crate) fn validate_bundle_draft(draft: &BundleDraft) -> Result<(), AppError> {
    let name = draft.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::State(
            "bundle name must contain 1-100 characters".to_string(),
        ));
    }
    if draft.description.chars().count() > 500 {
        return Err(AppError::State(
            "bundle description cannot exceed 500 characters".to_string(),
        ));
    }
    if draft.items.is_empty() {
        return Err(AppError::State(
            "bundle must contain at least one Library Skill".to_string(),
        ));
    }
    let mut skill_ids = draft
        .items
        .iter()
        .map(|item| item.skill_id.as_str())
        .collect::<Vec<_>>();
    skill_ids.sort_unstable();
    if skill_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(AppError::State(
            "bundle cannot contain duplicate Skills".to_string(),
        ));
    }
    if draft
        .items
        .iter()
        .any(|item| item.mode != "required" && item.mode != "optional")
    {
        return Err(AppError::State(
            "bundle item mode must be required or optional".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn new_bundle_id(name: &str, timestamp: i64) -> String {
    hash_text(&format!("bundle\0{}\0{timestamp}", name.trim()))
}

fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let mut output = String::with_capacity(64);
    for byte in hasher.finalize() {
        use std::fmt::Write;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{
        agent_discovery::{AgentTargetRecord, DiscoveryRootRecord},
        db::Database,
        skills::{self, SkillDraft},
    };

    use super::{generate_sync_plan, BundleDraft, BundleItemDraft};

    #[test]
    fn planner_classifies_absent_equal_and_different_without_writing_files() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!(
            "skills-manger-m4-plan-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&test_dir).expect("test directory should exist");
        let database = Database::initialize(test_dir.join("planner.sqlite3")).expect("database");
        let library_root = test_dir.join("library");
        let target_root = test_dir.join("target");
        fs::create_dir_all(&library_root).expect("library should exist");
        fs::create_dir_all(&target_root).expect("target should exist");
        for (id, name) in [
            ("skill-add", "add-skill"),
            ("skill-same", "same-skill"),
            ("skill-conflict", "conflict-skill"),
        ] {
            let library_path = library_root.join(name);
            fs::create_dir_all(&library_path).expect("skill should exist");
            fs::write(
                library_path.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: Planner fixture.\n---\n\nlibrary\n"),
            )
            .expect("manifest should write");
            let hash = skills::inspect_skill(&library_path)
                .expect("library skill should inspect")
                .content_hash;
            database
                .upsert_skill(&SkillDraft {
                    id: id.to_string(),
                    source_id: format!("source-{id}"),
                    source_kind: "local".to_string(),
                    source_locator: format!("C:/source/{name}"),
                    relative_path: ".".to_string(),
                    name: name.to_string(),
                    description: "Fixture".to_string(),
                    version: None,
                    license: None,
                    compatibility: None,
                    allowed_tools: None,
                    metadata_json: "{}".to_string(),
                    content_hash: hash,
                    library_path: library_path.to_string_lossy().into_owned(),
                    script_count: 0,
                    timestamp: 1,
                })
                .expect("skill should persist");
        }
        skills::copy_tree(
            &library_root.join("same-skill"),
            &target_root.join("same-skill"),
        )
        .expect("matching target should copy");
        let conflict_path = target_root.join("conflict-skill");
        fs::create_dir_all(&conflict_path).expect("conflict target should exist");
        fs::write(
            conflict_path.join("SKILL.md"),
            "---\nname: conflict-skill\ndescription: Planner fixture.\n---\n\ntarget drift\n",
        )
        .expect("conflict manifest should write");
        let target = AgentTargetRecord {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            provider: "Anthropic".to_string(),
            capabilities: vec!["read-skills".to_string()],
            detected: true,
            executable_path: None,
            version: None,
            last_warning: None,
            last_scanned_at: Some(1),
        };
        database.upsert_agent_target(&target, 1).expect("target");
        let root = DiscoveryRootRecord {
            id: "root-1".to_string(),
            agent_id: target.id.clone(),
            scope: "project".to_string(),
            configured_path: target_root.to_string_lossy().into_owned(),
            canonical_path: Some(target_root.to_string_lossy().into_owned()),
            enabled: true,
            is_default: false,
            last_warning: None,
        };
        database.upsert_discovery_root(&root, 1).expect("root");
        let bundle = database
            .upsert_bundle(
                &BundleDraft {
                    id: None,
                    name: "Planner fixture".to_string(),
                    description: String::new(),
                    items: ["skill-add", "skill-same", "skill-conflict"]
                        .into_iter()
                        .map(|skill_id| BundleItemDraft {
                            skill_id: skill_id.to_string(),
                            mode: "required".to_string(),
                        })
                        .collect(),
                },
                3,
            )
            .expect("bundle");

        let first = generate_sync_plan(&database, &bundle.id, &root.id).expect("plan");
        let second = generate_sync_plan(&database, &bundle.id, &root.id).expect("plan repeat");
        assert_eq!(first.id, second.id);
        assert_eq!(
            first
                .items
                .iter()
                .map(|item| item.action.as_str())
                .collect::<Vec<_>>(),
            vec!["add", "unchanged", "conflict"]
        );
        assert!(first.requires_confirmation);

        drop(database);
        let _ = fs::remove_dir_all(test_dir);
    }
}
