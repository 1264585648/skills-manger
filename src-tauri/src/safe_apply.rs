use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    bundle_planner::{self, SyncPlanRecord},
    db::Database,
    error::AppError,
    skills::{self, SkillRecord},
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRecord {
    pub id: String,
    pub skill_id: String,
    pub root_id: String,
    pub destination_path: String,
    pub deployed_hash: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOperationItemRecord {
    pub skill_id: String,
    pub action: String,
    pub destination_path: String,
    pub status: String,
    pub snapshot_path: Option<String>,
    pub deployed_hash: Option<String>,
    pub error: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOperationRecord {
    pub id: String,
    pub plan_id: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub items: Vec<ApplyOperationItemRecord>,
}

struct AppliedItem {
    skill_id: String,
    destination: PathBuf,
    backup: Option<PathBuf>,
    previous: Option<DeploymentRecord>,
}

pub(crate) fn persist_plan(
    db: &Database,
    plan: &SyncPlanRecord,
    timestamp: i64,
) -> Result<(), AppError> {
    let payload = serde_json::to_string(plan)?;
    db.connect()?.execute(
        "INSERT INTO sync_plans (id, bundle_id, root_id, payload_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'previewed', ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           status = CASE WHEN sync_plans.status = 'running' THEN 'running' ELSE 'previewed' END,
           updated_at = excluded.updated_at",
        params![plan.id, plan.bundle_id, plan.root_id, payload, timestamp],
    )?;
    Ok(())
}

pub(crate) fn deployment_for(
    db: &Database,
    skill_id: &str,
    root_id: &str,
) -> Result<Option<DeploymentRecord>, AppError> {
    Ok(db
        .connect()?
        .query_row(
            "SELECT id, skill_id, root_id, destination_path, deployed_hash, created_at, updated_at
             FROM deployments WHERE skill_id = ?1 AND root_id = ?2",
            params![skill_id, root_id],
            row_to_deployment,
        )
        .optional()?)
}

pub fn list_deployments(db: &Database) -> Result<Vec<DeploymentRecord>, AppError> {
    let connection = db.connect()?;
    let mut statement = connection.prepare(
        "SELECT id, skill_id, root_id, destination_path, deployed_hash, created_at, updated_at
         FROM deployments ORDER BY updated_at DESC, id",
    )?;
    let rows = statement.query_map([], row_to_deployment)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn list_apply_operations(db: &Database) -> Result<Vec<ApplyOperationRecord>, AppError> {
    let connection = db.connect()?;
    let mut statement = connection.prepare(
        "SELECT id, plan_id, status, error, started_at, finished_at
         FROM apply_operations ORDER BY started_at DESC, id DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(ApplyOperationRecord {
            id: row.get(0)?,
            plan_id: row.get(1)?,
            status: row.get(2)?,
            error: row.get(3)?,
            started_at: row.get(4)?,
            finished_at: row.get(5)?,
            items: Vec::new(),
        })
    })?;
    let mut operations = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for operation in &mut operations {
        operation.items = list_operation_items(&connection, &operation.id)?;
    }
    Ok(operations)
}

pub fn apply_sync_plan(
    db: &Database,
    operations_root: &Path,
    plan_id: &str,
    timestamp: i64,
) -> Result<ApplyOperationRecord, AppError> {
    let original = load_previewed_plan(db, plan_id)?;
    let refreshed = bundle_planner::generate_sync_plan(db, &original.bundle_id, &original.root_id)?;
    if refreshed.id != original.id {
        set_plan_status(db, &original.id, "stale", timestamp)?;
        return Err(AppError::State(
            "sync plan is stale; generate and review a new plan".to_string(),
        ));
    }
    if refreshed.items.iter().any(|item| item.action == "conflict") {
        return Err(AppError::State(
            "sync plan contains unresolved conflicts".to_string(),
        ));
    }
    if refreshed
        .items
        .iter()
        .all(|item| item.action == "unchanged")
    {
        return Err(AppError::State(
            "sync plan does not contain any changes".to_string(),
        ));
    }

    let library = db.list_skills()?;
    let root = db
        .list_discovery_roots()?
        .into_iter()
        .find(|root| root.id == refreshed.root_id && root.enabled)
        .ok_or_else(|| AppError::State("enabled discovery root was not found".to_string()))?;
    let canonical_root = validate_real_directory(Path::new(&root.configured_path), "target root")?;
    let canonical_operations_root = prepare_operations_root(operations_root)?;
    let operation_id = hash_text(&format!(
        "{}\0{timestamp}\0{}",
        refreshed.id,
        unique_nonce()?
    ));
    let operation_dir = canonical_operations_root.join(&operation_id);
    fs::create_dir(&operation_dir)?;
    let stage_root = operation_dir.join("stage");
    let snapshot_root = operation_dir.join("snapshots");
    fs::create_dir(&stage_root)?;
    fs::create_dir(&snapshot_root)?;
    if let Err(error) = start_operation(db, &operation_id, &refreshed.id, timestamp) {
        let _ = skills::remove_if_exists(&operation_dir);
        return Err(error);
    }

    let mut applied = Vec::new();
    for (position, item) in refreshed
        .items
        .iter()
        .filter(|item| item.action != "unchanged")
        .enumerate()
    {
        let result = library
            .iter()
            .find(|skill| skill.id == item.skill_id)
            .ok_or_else(|| {
                AppError::State(format!("Library Skill was not found: {}", item.skill_id))
            })
            .and_then(|skill| {
                apply_item(
                    db,
                    &operation_id,
                    &canonical_root,
                    &stage_root,
                    &snapshot_root,
                    skill,
                    &refreshed.root_id,
                    &item.action,
                    &item.library_hash,
                    position as i64,
                    timestamp,
                    &mut applied,
                )
            });
        if let Err(error) = result {
            return fail_and_rollback(
                db,
                &operation_id,
                &original.id,
                &refreshed.root_id,
                &applied,
                &error,
                timestamp,
            );
        }
    }

    if let Err(error) = complete_operation(db, &operation_id, &original.id, timestamp) {
        return fail_and_rollback(
            db,
            &operation_id,
            &original.id,
            &refreshed.root_id,
            &applied,
            &error,
            timestamp,
        );
    }
    for item in &applied {
        if let Some(backup) = &item.backup {
            let _ = skills::remove_if_exists(backup);
        }
    }
    let _ = skills::remove_if_exists(&stage_root);
    operation_by_id(db, &operation_id)?
        .ok_or_else(|| AppError::State("apply operation record is missing".to_string()))
}

#[allow(clippy::too_many_arguments)]
fn apply_item(
    db: &Database,
    operation_id: &str,
    root: &Path,
    stage_root: &Path,
    snapshot_root: &Path,
    skill: &SkillRecord,
    root_id: &str,
    action: &str,
    expected_hash: &str,
    position: i64,
    timestamp: i64,
    applied: &mut Vec<AppliedItem>,
) -> Result<(), AppError> {
    let destination = root.join(&skill.name);
    if destination.parent() != Some(root) {
        return Err(AppError::State(
            "derived destination escaped discovery root".to_string(),
        ));
    }
    insert_operation_item(db, operation_id, skill, action, &destination, position)?;

    let attempt = (|| {
        let source = validate_real_directory(Path::new(&skill.library_path), "Library Skill")?;
        let (source_hash, _) = skills::inspect_managed_skill(&source, &skill.name)?;
        if source_hash != expected_hash {
            return Err(AppError::State(format!(
                "Library Skill changed during apply: {}",
                skill.name
            )));
        }
        let previous = deployment_for(db, &skill.id, root_id)?;
        match (action, &previous, destination.exists()) {
            ("add", None, false) | ("add", Some(_), false) => {}
            ("update", Some(deployment), true) => {
                let current = skills::inspect_skill(&destination)?;
                if current.content_hash != deployment.deployed_hash {
                    return Err(AppError::State(format!(
                        "Target Drift detected for {}",
                        skill.name
                    )));
                }
            }
            _ => {
                return Err(AppError::State(format!(
                    "target ownership changed before apply: {}",
                    skill.name
                )));
            }
        }

        let app_stage = stage_root.join(&skill.name);
        skills::copy_tree(&source, &app_stage)?;
        verify_destination(&app_stage, expected_hash)?;
        let snapshot = if destination.exists() {
            let snapshot = snapshot_root.join(&skill.name);
            skills::copy_tree(&destination, &snapshot)?;
            let current_hash = skills::inspect_skill(&destination)?.content_hash;
            verify_destination(&snapshot, &current_hash)?;
            Some(snapshot)
        } else {
            None
        };
        set_operation_item_snapshot(db, operation_id, &skill.id, snapshot.as_deref())?;

        let target_stage = root.join(format!(
            ".skills-manager-stage-{operation_id}-{}",
            skill.name
        ));
        let backup = root.join(format!(
            ".skills-manager-backup-{operation_id}-{}",
            skill.name
        ));
        ensure_path_absent(&target_stage)?;
        ensure_path_absent(&backup)?;
        skills::copy_tree(&app_stage, &target_stage)?;
        let had_destination = destination.exists();
        if had_destination {
            fs::rename(&destination, &backup)?;
        }
        if let Err(error) = fs::rename(&target_stage, &destination) {
            if had_destination && backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(AppError::Io(error));
        }

        let persist_result = verify_destination(&destination, expected_hash).and_then(|_| {
            upsert_deployment(db, skill, root_id, &destination, expected_hash, timestamp)
        });
        if let Err(error) = persist_result {
            restore_current_item(
                db,
                root_id,
                &skill.id,
                &destination,
                &backup,
                &previous,
                timestamp,
            );
            return Err(error);
        }
        if let Err(error) = set_operation_item_applied(db, operation_id, &skill.id, expected_hash) {
            restore_current_item(
                db,
                root_id,
                &skill.id,
                &destination,
                &backup,
                &previous,
                timestamp,
            );
            return Err(error);
        }
        applied.push(AppliedItem {
            skill_id: skill.id.clone(),
            destination,
            backup: had_destination.then_some(backup),
            previous,
        });
        Ok(())
    })();
    if let Err(error) = &attempt {
        let _ = set_operation_item_status(
            db,
            operation_id,
            &skill.id,
            "failed",
            Some(&error.to_string()),
        );
    }
    attempt
}

fn restore_current_item(
    db: &Database,
    root_id: &str,
    skill_id: &str,
    destination: &Path,
    backup: &Path,
    previous: &Option<DeploymentRecord>,
    timestamp: i64,
) {
    let _ = skills::remove_if_exists(destination);
    if backup.exists() {
        let _ = fs::rename(backup, destination);
    }
    match previous {
        Some(record) => {
            let _ = upsert_deployment_record(db, record, timestamp);
        }
        None => {
            let _ = delete_deployment(db, skill_id, root_id);
        }
    }
}

fn fail_and_rollback(
    db: &Database,
    operation_id: &str,
    plan_id: &str,
    root_id: &str,
    applied: &[AppliedItem],
    error: &AppError,
    timestamp: i64,
) -> Result<ApplyOperationRecord, AppError> {
    let rollback_error = rollback_items(db, operation_id, root_id, applied, timestamp).err();
    let status = if rollback_error.is_some() {
        "rollback_failed"
    } else {
        "rolled_back"
    };
    let message = match rollback_error {
        Some(rollback) => format!("{error}; rollback failed: {rollback}"),
        None => error.to_string(),
    };
    finish_failed_operation(db, operation_id, plan_id, status, &message, timestamp)?;
    Err(AppError::State(message))
}

fn rollback_items(
    db: &Database,
    operation_id: &str,
    root_id: &str,
    applied: &[AppliedItem],
    timestamp: i64,
) -> Result<(), AppError> {
    for item in applied.iter().rev() {
        skills::remove_if_exists(&item.destination)?;
        if let Some(backup) = &item.backup {
            fs::rename(backup, &item.destination)?;
        }
        match &item.previous {
            Some(record) => upsert_deployment_record(db, record, timestamp)?,
            None => delete_deployment(db, &item.skill_id, root_id)?,
        }
        set_operation_item_status(db, operation_id, &item.skill_id, "rolled_back", None)?;
    }
    Ok(())
}

fn prepare_operations_root(path: &Path) -> Result<PathBuf, AppError> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    validate_real_directory(path, "operations root")
}

fn validate_real_directory(path: &Path, label: &str) -> Result<PathBuf, AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::State(format!(
            "{label} cannot be inspected: {} ({error})",
            path.display()
        ))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::State(format!("{label} must be a real directory")));
    }
    path.canonicalize().map_err(|error| {
        AppError::State(format!(
            "{label} cannot be canonicalized: {} ({error})",
            path.display()
        ))
    })
}

fn ensure_path_absent(path: &Path) -> Result<(), AppError> {
    if path.exists() || fs::symlink_metadata(path).is_ok() {
        return Err(AppError::State(format!(
            "temporary apply path already exists: {}",
            path.display()
        )));
    }
    Ok(())
}

fn verify_destination(path: &Path, expected_hash: &str) -> Result<(), AppError> {
    let inspected = skills::inspect_skill(path)?;
    if inspected.content_hash != expected_hash {
        return Err(AppError::State(format!(
            "deployed hash verification failed: {}",
            path.display()
        )));
    }
    Ok(())
}

fn load_previewed_plan(db: &Database, id: &str) -> Result<SyncPlanRecord, AppError> {
    let payload = db
        .connect()?
        .query_row(
            "SELECT payload_json FROM sync_plans WHERE id = ?1 AND status = 'previewed'",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| AppError::State("previewed sync plan was not found".to_string()))?;
    Ok(serde_json::from_str(&payload)?)
}

fn start_operation(
    db: &Database,
    operation_id: &str,
    plan_id: &str,
    timestamp: i64,
) -> Result<(), AppError> {
    let mut connection = db.connect()?;
    let transaction = connection.transaction()?;
    let claimed = transaction.execute(
        "UPDATE sync_plans SET status = 'running', updated_at = ?2
         WHERE id = ?1 AND status = 'previewed'",
        params![plan_id, timestamp],
    )?;
    if claimed != 1 {
        return Err(AppError::State(
            "sync plan is no longer available for apply".to_string(),
        ));
    }
    transaction.execute(
        "INSERT INTO apply_operations (id, plan_id, status, started_at)
         VALUES (?1, ?2, 'running', ?3)",
        params![operation_id, plan_id, timestamp],
    )?;
    transaction.commit()?;
    Ok(())
}

fn complete_operation(
    db: &Database,
    operation_id: &str,
    plan_id: &str,
    timestamp: i64,
) -> Result<(), AppError> {
    let mut connection = db.connect()?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE apply_operations SET status = 'succeeded', error = NULL, finished_at = ?2
         WHERE id = ?1 AND status = 'running'",
        params![operation_id, timestamp],
    )?;
    transaction.execute(
        "UPDATE sync_plans SET status = 'applied', updated_at = ?2 WHERE id = ?1",
        params![plan_id, timestamp],
    )?;
    transaction.commit()?;
    Ok(())
}

fn finish_failed_operation(
    db: &Database,
    operation_id: &str,
    plan_id: &str,
    status: &str,
    error: &str,
    timestamp: i64,
) -> Result<(), AppError> {
    let mut connection = db.connect()?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE apply_operations SET status = ?2, error = ?3, finished_at = ?4 WHERE id = ?1",
        params![operation_id, status, error, timestamp],
    )?;
    transaction.execute(
        "UPDATE sync_plans SET status = 'failed', updated_at = ?2 WHERE id = ?1",
        params![plan_id, timestamp],
    )?;
    transaction.commit()?;
    Ok(())
}

fn insert_operation_item(
    db: &Database,
    operation_id: &str,
    skill: &SkillRecord,
    action: &str,
    destination: &Path,
    position: i64,
) -> Result<(), AppError> {
    db.connect()?.execute(
        "INSERT INTO apply_operation_items (
           operation_id, skill_id, action, destination_path, status, position
         ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
        params![
            operation_id,
            skill.id,
            action,
            destination.to_string_lossy(),
            position
        ],
    )?;
    Ok(())
}

fn set_operation_item_snapshot(
    db: &Database,
    operation_id: &str,
    skill_id: &str,
    snapshot: Option<&Path>,
) -> Result<(), AppError> {
    let snapshot = snapshot.map(|path| path.to_string_lossy().into_owned());
    db.connect()?.execute(
        "UPDATE apply_operation_items SET snapshot_path = ?3
         WHERE operation_id = ?1 AND skill_id = ?2",
        params![operation_id, skill_id, snapshot],
    )?;
    Ok(())
}

fn set_operation_item_applied(
    db: &Database,
    operation_id: &str,
    skill_id: &str,
    deployed_hash: &str,
) -> Result<(), AppError> {
    db.connect()?.execute(
        "UPDATE apply_operation_items
         SET status = 'applied', deployed_hash = ?3, error = NULL
         WHERE operation_id = ?1 AND skill_id = ?2",
        params![operation_id, skill_id, deployed_hash],
    )?;
    Ok(())
}

fn set_operation_item_status(
    db: &Database,
    operation_id: &str,
    skill_id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    db.connect()?.execute(
        "UPDATE apply_operation_items SET status = ?3, error = ?4
         WHERE operation_id = ?1 AND skill_id = ?2",
        params![operation_id, skill_id, status, error],
    )?;
    Ok(())
}

fn upsert_deployment(
    db: &Database,
    skill: &SkillRecord,
    root_id: &str,
    destination: &Path,
    hash: &str,
    timestamp: i64,
) -> Result<(), AppError> {
    upsert_deployment_record(
        db,
        &DeploymentRecord {
            id: hash_text(&format!("{}\0{root_id}", skill.id)),
            skill_id: skill.id.clone(),
            root_id: root_id.to_string(),
            destination_path: destination.to_string_lossy().into_owned(),
            deployed_hash: hash.to_string(),
            created_at: timestamp,
            updated_at: timestamp,
        },
        timestamp,
    )
}

fn upsert_deployment_record(
    db: &Database,
    record: &DeploymentRecord,
    timestamp: i64,
) -> Result<(), AppError> {
    db.connect()?.execute(
        "INSERT INTO deployments (
           id, skill_id, root_id, destination_path, deployed_hash, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           destination_path = excluded.destination_path,
           deployed_hash = excluded.deployed_hash,
           updated_at = excluded.updated_at",
        params![
            record.id,
            record.skill_id,
            record.root_id,
            record.destination_path,
            record.deployed_hash,
            record.created_at,
            timestamp
        ],
    )?;
    Ok(())
}

fn delete_deployment(db: &Database, skill_id: &str, root_id: &str) -> Result<(), AppError> {
    db.connect()?.execute(
        "DELETE FROM deployments WHERE skill_id = ?1 AND root_id = ?2",
        params![skill_id, root_id],
    )?;
    Ok(())
}

fn set_plan_status(db: &Database, id: &str, status: &str, timestamp: i64) -> Result<(), AppError> {
    db.connect()?.execute(
        "UPDATE sync_plans SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, status, timestamp],
    )?;
    Ok(())
}

fn operation_by_id(
    db: &Database,
    operation_id: &str,
) -> Result<Option<ApplyOperationRecord>, AppError> {
    Ok(list_apply_operations(db)?
        .into_iter()
        .find(|operation| operation.id == operation_id))
}

fn list_operation_items(
    connection: &rusqlite::Connection,
    operation_id: &str,
) -> Result<Vec<ApplyOperationItemRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT skill_id, action, destination_path, status, snapshot_path,
                deployed_hash, error, position
         FROM apply_operation_items WHERE operation_id = ?1 ORDER BY position",
    )?;
    let rows = statement.query_map(params![operation_id], |row| {
        Ok(ApplyOperationItemRecord {
            skill_id: row.get(0)?,
            action: row.get(1)?,
            destination_path: row.get(2)?,
            status: row.get(3)?,
            snapshot_path: row.get(4)?,
            deployed_hash: row.get(5)?,
            error: row.get(6)?,
            position: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn row_to_deployment(row: &rusqlite::Row<'_>) -> rusqlite::Result<DeploymentRecord> {
    Ok(DeploymentRecord {
        id: row.get(0)?,
        skill_id: row.get(1)?,
        root_id: row.get(2)?,
        destination_path: row.get(3)?,
        deployed_hash: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn unique_nonce() -> Result<u128, AppError> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::State(format!("system clock error: {error}")))?
        .as_nanos())
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
    use std::{fs, path::Path, time::SystemTime};

    use crate::{
        agent_discovery::{AgentTargetRecord, DiscoveryRootRecord},
        bundle_planner::{generate_sync_plan, BundleDraft, BundleItemDraft},
        db::Database,
        skills::{import_skill_directory, inspect_skill, SkillRecord},
    };

    use super::{apply_sync_plan, list_apply_operations, list_deployments};

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "skills-manger-m5-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn write_skill(path: &Path, name: &str, body: &str, marker: Option<&Path>) {
        fs::create_dir_all(path.join("scripts")).expect("skill directories should exist");
        fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: M5 fixture.\n---\n\n{body}\n"),
        )
        .expect("manifest should write");
        let script = marker
            .map(|path| format!("echo executed > {}\n", path.display()))
            .unwrap_or_else(|| "echo fixture\n".to_string());
        fs::write(path.join("scripts").join("run.sh"), script).expect("script should write");
    }

    fn register_root(database: &Database, path: &Path) -> DiscoveryRootRecord {
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
        database
            .upsert_agent_target(&target, 1)
            .expect("target should persist");
        let root = DiscoveryRootRecord {
            id: "root-1".to_string(),
            agent_id: target.id,
            scope: "project".to_string(),
            configured_path: path.to_string_lossy().into_owned(),
            canonical_path: Some(path.to_string_lossy().into_owned()),
            enabled: true,
            is_default: false,
            last_warning: None,
        };
        database
            .upsert_discovery_root(&root, 1)
            .expect("root should persist");
        root
    }

    fn create_bundle(database: &Database, skills: &[SkillRecord]) -> String {
        database
            .upsert_bundle(
                &BundleDraft {
                    id: None,
                    name: "M5 fixture".to_string(),
                    description: String::new(),
                    items: skills
                        .iter()
                        .map(|skill| BundleItemDraft {
                            skill_id: skill.id.clone(),
                            mode: "required".to_string(),
                        })
                        .collect(),
                },
                2,
            )
            .expect("bundle should persist")
            .id
    }

    #[test]
    fn apply_adds_and_updates_owned_skill_without_executing_scripts() {
        let root = test_root("apply-update");
        let source = root.join("source").join("demo-skill");
        let library = root.join("library");
        let target = root.join("target");
        let operations = root.join("operations");
        let marker = root.join("script-executed.txt");
        fs::create_dir_all(&library).expect("library should exist");
        fs::create_dir_all(&target).expect("target should exist");
        write_skill(&source, "demo-skill", "version one", Some(&marker));
        let database = Database::initialize(root.join("skills.sqlite3")).expect("database");
        let first = import_skill_directory(&database, &library, &source)
            .expect("skill should import")
            .skill;
        let discovery_root = register_root(&database, &target);
        let bundle_id = create_bundle(&database, std::slice::from_ref(&first));

        let add_plan = generate_sync_plan(&database, &bundle_id, &discovery_root.id)
            .expect("add plan should generate");
        assert_eq!(add_plan.items[0].action, "add");
        let add_operation =
            apply_sync_plan(&database, &operations, &add_plan.id, 10).expect("add should apply");
        assert_eq!(add_operation.status, "succeeded");
        assert_eq!(add_operation.items[0].status, "applied");
        assert_eq!(
            inspect_skill(&target.join("demo-skill"))
                .expect("target should inspect")
                .content_hash,
            first.content_hash
        );
        assert!(!marker.exists(), "scripts must never be executed");

        let first_deployment =
            list_deployments(&database).expect("deployments should list")[0].clone();
        write_skill(&source, "demo-skill", "version two", Some(&marker));
        let updated = import_skill_directory(&database, &library, &source)
            .expect("skill should update")
            .skill;
        let update_plan = generate_sync_plan(&database, &bundle_id, &discovery_root.id)
            .expect("update plan should generate");
        assert_eq!(update_plan.items[0].action, "update");
        apply_sync_plan(&database, &operations, &update_plan.id, 20).expect("update should apply");
        let second_deployment =
            list_deployments(&database).expect("deployments should list")[0].clone();
        assert_eq!(first_deployment.id, second_deployment.id);
        assert_eq!(first_deployment.created_at, second_deployment.created_at);
        assert_eq!(second_deployment.updated_at, 20);
        assert_eq!(second_deployment.deployed_hash, updated.content_hash);
        assert!(
            !marker.exists(),
            "scripts must never be executed during update"
        );

        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_plan_is_rejected_before_target_write() {
        let root = test_root("stale");
        let source = root.join("source").join("demo-skill");
        let library = root.join("library");
        let target = root.join("target");
        fs::create_dir_all(&library).expect("library should exist");
        fs::create_dir_all(&target).expect("target should exist");
        write_skill(&source, "demo-skill", "version one", None);
        let database = Database::initialize(root.join("skills.sqlite3")).expect("database");
        let first = import_skill_directory(&database, &library, &source)
            .expect("skill should import")
            .skill;
        let discovery_root = register_root(&database, &target);
        let bundle_id = create_bundle(&database, &[first]);
        let plan = generate_sync_plan(&database, &bundle_id, &discovery_root.id)
            .expect("plan should generate");

        write_skill(&source, "demo-skill", "changed after preview", None);
        import_skill_directory(&database, &library, &source).expect("skill should update");
        let error = apply_sync_plan(&database, &root.join("operations"), &plan.id, 10)
            .expect_err("stale plan must fail");
        assert!(error.to_string().contains("stale"));
        assert!(!target.join("demo-skill").exists());
        assert!(list_deployments(&database)
            .expect("deployments should list")
            .is_empty());

        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn later_item_failure_rolls_back_prior_target_and_ownership() {
        let root = test_root("rollback");
        let library = root.join("library");
        let target = root.join("target");
        fs::create_dir_all(&library).expect("library should exist");
        fs::create_dir_all(&target).expect("target should exist");
        let database = Database::initialize(root.join("skills.sqlite3")).expect("database");
        let mut imported = Vec::new();
        for name in ["first-skill", "second-skill"] {
            let source = root.join("source").join(name);
            write_skill(&source, name, "fixture", None);
            imported.push(
                import_skill_directory(&database, &library, &source)
                    .expect("skill should import")
                    .skill,
            );
        }
        let discovery_root = register_root(&database, &target);
        let bundle_id = create_bundle(&database, &imported);
        let plan = generate_sync_plan(&database, &bundle_id, &discovery_root.id)
            .expect("plan should generate");
        fs::remove_dir_all(&imported[1].library_path)
            .expect("second Library copy should disappear");

        let error = apply_sync_plan(&database, &root.join("operations"), &plan.id, 10)
            .expect_err("apply should fail and roll back");
        assert!(error.to_string().contains("Library Skill"));
        assert!(!target.join("first-skill").exists());
        assert!(!target.join("second-skill").exists());
        assert!(list_deployments(&database)
            .expect("deployments should list")
            .is_empty());
        let operations = list_apply_operations(&database).expect("operations should list");
        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].status, "rolled_back");
        assert_eq!(operations[0].items[0].status, "rolled_back");
        assert_eq!(operations[0].items[1].status, "failed");

        drop(database);
        let _ = fs::remove_dir_all(root);
    }
}
