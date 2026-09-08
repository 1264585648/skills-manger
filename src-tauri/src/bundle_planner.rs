use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::Database, error::AppError};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleItemRecord {
    pub skill_id: String,
    pub mode: String,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanRecord {
    pub id: String,
    pub bundle_id: String,
    pub root_id: String,
    pub items: Vec<SyncPlanItemRecord>,
    pub warnings: Vec<String>,
    pub requires_confirmation: bool,
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
    let instances = db
        .list_skill_instances()?
        .into_iter()
        .filter(|instance| instance.root_id == root.id && instance.state == "unmanaged")
        .collect::<Vec<_>>();

    let mut items = Vec::new();
    let mut warnings = Vec::new();
    for bundle_item in &bundle.items {
        let skill = library
            .iter()
            .find(|skill| skill.id == bundle_item.skill_id)
            .ok_or_else(|| AppError::State(format!("bundle references missing Library Skill {}", bundle_item.skill_id)))?;
        let matches = instances
            .iter()
            .filter(|instance| instance.name == skill.name)
            .collect::<Vec<_>>();
        let (action, current_hash, reason) = match matches.as_slice() {
            [] => ("add", None, "Skill is absent from the selected Agent root".to_string()),
            [instance] if instance.content_hash == skill.content_hash => (
                "unchanged",
                Some(instance.content_hash.clone()),
                "Agent instance matches the Canonical Library hash".to_string(),
            ),
            [instance] => (
                "conflict",
                Some(instance.content_hash.clone()),
                "Unmanaged Agent content differs; ownership must be resolved before any write".to_string(),
            ),
            _ => {
                warnings.push(format!("multiple Agent instances match Skill '{}'", skill.name));
                (
                    "conflict",
                    None,
                    "Multiple Agent instances match this Library Skill".to_string(),
                )
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
        });
    }

    let signature = items
        .iter()
        .map(|item| format!("{}:{}:{}", item.skill_id, item.action, item.library_hash))
        .collect::<Vec<_>>()
        .join("|");
    Ok(SyncPlanRecord {
        id: hash_text(&format!("{}\0{}\0{}", bundle.id, root.id, signature)),
        bundle_id: bundle.id,
        root_id: root.id,
        requires_confirmation: items.iter().any(|item| item.action != "unchanged"),
        items,
        warnings,
    })
}

pub(crate) fn validate_bundle_draft(draft: &BundleDraft) -> Result<(), AppError> {
    let name = draft.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::State("bundle name must contain 1-100 characters".to_string()));
    }
    if draft.description.chars().count() > 500 {
        return Err(AppError::State("bundle description cannot exceed 500 characters".to_string()));
    }
    if draft.items.is_empty() {
        return Err(AppError::State("bundle must contain at least one Library Skill".to_string()));
    }
    let mut skill_ids = draft.items.iter().map(|item| item.skill_id.as_str()).collect::<Vec<_>>();
    skill_ids.sort_unstable();
    if skill_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(AppError::State("bundle cannot contain duplicate Skills".to_string()));
    }
    if draft.items.iter().any(|item| item.mode != "required" && item.mode != "optional") {
        return Err(AppError::State("bundle item mode must be required or optional".to_string()));
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
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    use crate::{
        agent_discovery::{AgentTargetRecord, DiscoveryRootRecord, SkillInstanceDraft},
        db::Database,
        skills::SkillDraft,
    };

    use super::{generate_sync_plan, BundleDraft, BundleItemDraft};

    #[test]
    fn planner_classifies_absent_equal_and_different_without_writing_files() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let test_dir = std::env::temp_dir().join(format!("skills-manger-m4-plan-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&test_dir).expect("test directory should exist");
        let database = Database::initialize(test_dir.join("planner.sqlite3")).expect("database");
        for (id, name, hash) in [
            ("skill-add", "add-skill", "hash-add"),
            ("skill-same", "same-skill", "hash-same"),
            ("skill-conflict", "conflict-skill", "hash-library"),
        ] {
            database.upsert_skill(&SkillDraft {
                id: id.to_string(), source_id: format!("source-{id}"), source_kind: "local".to_string(),
                source_locator: format!("C:/source/{name}"), relative_path: ".".to_string(),
                name: name.to_string(), description: "Fixture".to_string(), version: None,
                license: None, compatibility: None, allowed_tools: None, metadata_json: "{}".to_string(),
                content_hash: hash.to_string(), library_path: format!("C:/library/{name}"), script_count: 0, timestamp: 1,
            }).expect("skill should persist");
        }
        let target = AgentTargetRecord {
            id: "claude-code".to_string(), name: "Claude Code".to_string(), provider: "Anthropic".to_string(),
            capabilities: vec!["read-skills".to_string()], detected: true, executable_path: None,
            version: None, last_warning: None, last_scanned_at: Some(1),
        };
        database.upsert_agent_target(&target, 1).expect("target");
        let root = DiscoveryRootRecord {
            id: "root-1".to_string(), agent_id: target.id.clone(), scope: "project".to_string(),
            configured_path: "C:/project/.claude/skills".to_string(), canonical_path: None,
            enabled: true, is_default: false, last_warning: None,
        };
        database.upsert_discovery_root(&root, 1).expect("root");
        database.reconcile_root_instances(&root.id, &[
            SkillInstanceDraft {
                id: "instance-same".to_string(), agent_id: target.id.clone(), root_id: root.id.clone(), scope: root.scope.clone(),
                path: "C:/project/.claude/skills/same-skill".to_string(), name: "same-skill".to_string(),
                description: "Same".to_string(), content_hash: "hash-same".to_string(), script_count: 0,
            },
            SkillInstanceDraft {
                id: "instance-conflict".to_string(), agent_id: target.id, root_id: root.id.clone(), scope: root.scope.clone(),
                path: "C:/project/.claude/skills/conflict-skill".to_string(), name: "conflict-skill".to_string(),
                description: "Conflict".to_string(), content_hash: "hash-agent".to_string(), script_count: 0,
            },
        ], 2).expect("instances");
        let bundle = database.upsert_bundle(&BundleDraft {
            id: None, name: "Planner fixture".to_string(), description: String::new(),
            items: ["skill-add", "skill-same", "skill-conflict"].into_iter().map(|skill_id| BundleItemDraft {
                skill_id: skill_id.to_string(), mode: "required".to_string(),
            }).collect(),
        }, 3).expect("bundle");

        let first = generate_sync_plan(&database, &bundle.id, &root.id).expect("plan");
        let second = generate_sync_plan(&database, &bundle.id, &root.id).expect("plan repeat");
        assert_eq!(first.id, second.id);
        assert_eq!(first.items.iter().map(|item| item.action.as_str()).collect::<Vec<_>>(), vec!["add", "unchanged", "conflict"]);
        assert!(first.requires_confirmation);

        drop(database);
        let _ = fs::remove_dir_all(test_dir);
    }
}
