use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    bundle_planner::{self, SyncPlanRecord},
    db::Database,
    error::AppError,
    skills::{self, SkillRecord},
};

static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn selection_destination(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(relative);
    if relative.is_empty()
        || !path
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
    {
        return Err(AppError::State("目标路径必须位于所选技能目录内".into()));
    }
    let joined = root.join(path);
    let parent = prospective_root(
        joined
            .parent()
            .ok_or_else(|| AppError::State("目标路径无效".into()))?,
    )?;
    if !parent.starts_with(dunce::simplified(root)) {
        return Err(AppError::State("目标链接超出所选技能目录".into()));
    }
    Ok(joined)
}

pub(crate) fn prospective_root(path: &Path) -> Result<PathBuf, AppError> {
    if crate::agent_center::is_network(path) {
        return Err(AppError::State("不支持写入网络目录".into()));
    }
    let mut cursor = path;
    let mut missing = Vec::new();
    while fs::symlink_metadata(cursor).is_err() {
        missing.push(
            cursor
                .file_name()
                .ok_or_else(|| AppError::State("目标路径无效".into()))?,
        );
        cursor = cursor
            .parent()
            .ok_or_else(|| AppError::State("目标路径无效".into()))?;
    }
    let mut resolved = crate::agent_center::resolve_local(cursor)?;
    for part in missing.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved)
}

pub(crate) fn target_fingerprint(path: &Path) -> Result<Option<String>, AppError> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
        Ok(_) => {}
    }
    let mut hash = Sha256::new();
    let mut pending = vec![(path.to_path_buf(), String::new())];
    let mut bytes = 0u64;
    let mut count = 0;
    while let Some((current, relative)) = pending.pop() {
        count += 1;
        if count > 10000 {
            return Err(AppError::State("目标文件数量超过备份上限".into()));
        }
        let metadata = fs::symlink_metadata(&current)?;
        hash.update(relative.as_bytes());
        hash.update([0]);
        if metadata.file_type().is_symlink() {
            hash.update(b"link");
            hash.update(fs::read_link(&current)?.as_os_str().as_encoded_bytes());
        } else if metadata.is_dir() {
            hash.update(b"dir");
            let mut entries = fs::read_dir(&current)?.collect::<Result<Vec<_>, _>>()?;
            entries.sort_by_key(|e| e.file_name());
            for entry in entries.into_iter().rev() {
                pending.push((
                    entry.path(),
                    format!("{relative}/{}", entry.file_name().to_string_lossy()),
                ));
            }
        } else if metadata.is_file() {
            bytes += metadata.len();
            if bytes > 100 * 1024 * 1024 {
                return Err(AppError::State("目标超过 100 MB，无法安全备份".into()));
            }
            hash.update(b"file");
            hash.update(fs::read(&current)?);
        } else {
            return Err(AppError::State("目标包含不支持的特殊文件".into()));
        }
        hash.update([0]);
    }
    Ok(Some(format!("{:x}", hash.finalize())))
}

pub fn restore_operation(
    db: &Database,
    operation_id: &str,
    timestamp: i64,
) -> Result<ApplyOperationRecord, AppError> {
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| AppError::State("同步锁不可用".into()))?;
    let operation = operation_by_id(db, operation_id)?
        .filter(|o| o.status == "succeeded")
        .ok_or_else(|| AppError::State("该操作不能恢复或已经恢复".into()))?;
    let payload: String = db.connect()?.query_row(
        "SELECT payload_json FROM sync_plans WHERE id=?1",
        [&operation.plan_id],
        |r| r.get(0),
    )?;
    let plan: SyncPlanRecord = serde_json::from_str(&payload)?;
    let root = db
        .list_discovery_roots()?
        .into_iter()
        .find(|r| r.id == plan.root_id)
        .ok_or_else(|| AppError::State("原目标目录记录已不存在".into()))?;
    let actual_root = prospective_root(Path::new(&root.configured_path))?;
    if !plan.root_path.is_empty()
        && crate::agent_center::path_key(&actual_root)
            != crate::agent_center::path_key(Path::new(&plan.root_path))
    {
        return Err(AppError::State("原目标目录已变化，不能恢复".into()));
    }
    let mut prepared = Vec::new();
    for item in &operation.items {
        let destination = PathBuf::from(&item.destination_path);
        if !dunce::simplified(&destination).starts_with(dunce::simplified(&actual_root)) {
            return Err(AppError::State("恢复路径不属于原目标目录".into()));
        }
        if fs::symlink_metadata(&destination)?.file_type().is_symlink()
            || skills::inspect_portable_skill(&destination)?.content_hash
                != item.deployed_hash.as_deref().unwrap_or("")
        {
            return Err(AppError::State(
                "安装后目标已被修改，请先保留当前内容".into(),
            ));
        }
        if let Some(snapshot) = &item.snapshot_path {
            if fs::symlink_metadata(snapshot).is_err() {
                return Err(AppError::State("备份不存在，无法恢复".into()));
            }
            if plan.selection.is_some() {
                let expected = plan
                    .items
                    .iter()
                    .find(|p| {
                        p.skill_id == item.skill_id
                            && selection_destination(
                                &actual_root,
                                p.destination_relative.as_deref().unwrap_or(&p.skill_name),
                            )
                            .is_ok_and(|path| {
                                crate::agent_center::path_key(&path)
                                    == crate::agent_center::path_key(&destination)
                            })
                    })
                    .and_then(|p| p.current_hash.as_deref());
                if target_fingerprint(Path::new(snapshot))?.as_deref() != expected {
                    return Err(AppError::State("备份内容已变化，无法恢复".into()));
                }
            }
        }
        let saved:Option<String>=db.connect()?.query_row("SELECT payload_json FROM apply_previous_records WHERE operation_id=?1 AND position=?2",params![operation_id,item.position],|r|r.get(0)).optional()?;
        if saved.is_none() {
            return Err(AppError::State(
                "早期操作缺少恢复元数据，请从原备份目录恢复".into(),
            ));
        }
        let previous: Option<DeploymentRecord> = saved
            .map(|s| serde_json::from_str(&s))
            .transpose()?
            .flatten();
        let temporary = actual_root.join(format!(
            ".skills-manager-restore-{operation_id}-{}",
            item.position
        ));
        ensure_path_absent(&temporary)?;
        prepared.push((item, destination, temporary, previous));
    }
    let mut changed: Vec<usize> = Vec::new();
    let result = (|| {
        for (index, (item, destination, temporary, _)) in prepared.iter().enumerate() {
            fs::rename(destination, temporary)?;
            if let Some(snapshot) = &item.snapshot_path {
                if let Err(error) = fs::rename(snapshot, destination) {
                    fs::rename(temporary, destination)?;
                    return Err(AppError::Io(error));
                }
            }
            changed.push(index);
        }
        let mut connection = db.connect()?;
        let transaction = connection.transaction()?;
        for (item, destination, _, previous) in &prepared {
            transaction.execute(
                "DELETE FROM deployments WHERE root_id=?1 AND destination_path=?2",
                params![plan.root_id, destination.to_string_lossy()],
            )?;
            if let Some(p) = previous {
                transaction.execute("INSERT INTO deployments(id,skill_id,root_id,destination_path,deployed_hash,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![p.id,p.skill_id,p.root_id,p.destination_path,p.deployed_hash,p.created_at,timestamp])?;
            }
            transaction.execute("UPDATE apply_operation_items SET status='rolled_back' WHERE operation_id=?1 AND position=?2",params![operation_id,item.position])?;
        }
        transaction.execute(
            "UPDATE apply_operations SET status='rolled_back',finished_at=?2 WHERE id=?1",
            params![operation_id, timestamp],
        )?;
        transaction.commit()?;
        Ok::<_, AppError>(())
    })();
    if let Err(error) = result {
        for index in changed.into_iter().rev() {
            let (item, destination, temporary, _) = &prepared[index];
            if let Some(snapshot) = &item.snapshot_path {
                fs::rename(destination, snapshot)?;
            }
            fs::rename(temporary, destination)?;
        }
        return Err(error);
    }
    for (_, _, temporary, _) in prepared {
        let _ = skills::remove_if_exists(&temporary);
    }
    operation_by_id(db, operation_id)?.ok_or_else(|| AppError::State("恢复记录不存在".into()))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
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
    pub can_restore: bool,
    pub backup_state: String,
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
    position: i64,
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
    destination: &Path,
) -> Result<Option<DeploymentRecord>, AppError> {
    Ok(db
        .connect()?
        .query_row(
            "SELECT id, skill_id, root_id, destination_path, deployed_hash, created_at, updated_at
             FROM deployments WHERE skill_id = ?1 AND root_id = ?2 AND destination_path=?3",
            params![skill_id, root_id, destination.to_string_lossy()],
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
            can_restore: false,
            backup_state: String::new(),
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
        let saved: i64 = connection.query_row(
            "SELECT COUNT(*) FROM apply_previous_records WHERE operation_id=?1",
            [&operation.id],
            |r| r.get(0),
        )?;
        let backup_missing = operation
            .items
            .iter()
            .filter_map(|i| i.snapshot_path.as_ref())
            .any(|p| fs::symlink_metadata(p).is_err());
        operation.backup_state = if backup_missing {
            "missing"
        } else if operation.items.iter().any(|i| i.snapshot_path.is_some()) {
            "available"
        } else {
            "not-needed"
        }
        .into();
        operation.can_restore = operation.status == "succeeded"
            && !backup_missing
            && !operation.items.is_empty()
            && saved == operation.items.len() as i64;
    }
    Ok(operations)
}

pub fn apply_sync_plan(
    db: &Database,
    operations_root: &Path,
    plan_id: &str,
    timestamp: i64,
) -> Result<ApplyOperationRecord, AppError> {
    let _write_guard = WRITE_LOCK
        .lock()
        .map_err(|_| AppError::State("同步锁不可用".into()))?;
    let original = load_previewed_plan(db, plan_id)?;
    let refreshed = if original.selection.is_some() {
        let targets = original
            .items
            .iter()
            .map(|i| (i.skill_id.clone(), i.destination_relative.clone()))
            .collect::<Vec<_>>();
        bundle_planner::generate_selection_targets(db, &original.root_id, &targets)?
    } else {
        bundle_planner::generate_sync_plan(db, &original.bundle_id, &original.root_id)?
    };
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
    if let Some(info) =
        crate::agent_center::get::<crate::agent_center::RootInfo>(db, "root", &root.id)
            .ok()
            .flatten()
    {
        if !info.writable {
            return Err(AppError::State("目标目录仅供查看".into()));
        }
    }
    let expected_root = prospective_root(Path::new(&root.configured_path))?;
    crate::agent_center::assert_writable_root(db, &expected_root)?;
    if refreshed.selection.is_some() && expected_root.to_string_lossy() != refreshed.root_path {
        return Err(AppError::State("目标目录已变化，请重新预览".into()));
    }
    if !expected_root.exists() {
        fs::create_dir_all(&expected_root)?;
    }
    let canonical_root = expected_root.canonicalize()?;
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
                    refreshed.overwrite,
                    item.current_hash.as_deref(),
                    item.destination_relative.as_deref(),
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
    overwrite: bool,
    expected_current: Option<&str>,
    destination_relative: Option<&str>,
) -> Result<(), AppError> {
    let destination = selection_destination(root, destination_relative.unwrap_or(&skill.name))?;
    if !dunce::simplified(&destination).starts_with(dunce::simplified(root)) {
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
        let previous = list_deployments(db)?
            .into_iter()
            .find(|d| d.root_id == root_id && Path::new(&d.destination_path) == destination);
        db.connect()?.execute("INSERT OR REPLACE INTO apply_previous_records(operation_id,skill_id,position,payload_json) VALUES (?1,?2,?3,?4)",params![operation_id,skill.id,position,serde_json::to_string(&previous)?])?;
        if overwrite {
            if target_fingerprint(&destination)?.as_deref() != expected_current {
                return Err(AppError::State(format!(
                    "目标已变化，请重新预览：{}",
                    skill.name
                )));
            }
        } else {
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
        }

        let app_stage = stage_root.join(&skill.name);
        skills::copy_tree(&source, &app_stage)?;
        verify_destination(&app_stage, expected_hash)?;
        let snapshot = if destination.exists() && !overwrite {
            let snapshot = snapshot_root.join(&skill.name);
            skills::copy_tree(&destination, &snapshot)?;
            let current_hash = skills::inspect_skill(&destination)?.content_hash;
            verify_destination(&snapshot, &current_hash)?;
            Some(snapshot)
        } else {
            None
        };
        set_operation_item_snapshot(db, operation_id, position, snapshot.as_deref())?;

        let target_stage = root.join(format!(
            ".skills-manager-stage-{operation_id}-{position}-{}",
            skill.name
        ));
        let backup = root.join(format!(
            ".skills-manager-backup-{operation_id}-{position}-{}",
            skill.name
        ));
        ensure_path_absent(&target_stage)?;
        ensure_path_absent(&backup)?;
        skills::copy_tree(&app_stage, &target_stage)?;
        if overwrite && target_fingerprint(&destination)?.as_deref() != expected_current {
            let _ = skills::remove_if_exists(&target_stage);
            return Err(AppError::State("目标在写入前发生变化，请重新预览".into()));
        }
        let had_destination = fs::symlink_metadata(&destination).is_ok();
        set_operation_item_snapshot(
            db,
            operation_id,
            position,
            had_destination.then_some(backup.as_path()),
        )?;
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
            if overwrite {
                db.connect()?.execute(
                    "DELETE FROM deployments WHERE root_id=?1 AND destination_path=?2",
                    params![root_id, destination.to_string_lossy()],
                )?;
            }
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
        if let Err(error) = set_operation_item_applied(db, operation_id, position, expected_hash) {
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
            position,
        });
        Ok(())
    })();
    if let Err(error) = &attempt {
        let _ = set_operation_item_status(
            db,
            operation_id,
            position,
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
    if fs::symlink_metadata(backup).is_ok() {
        let _ = fs::rename(backup, destination);
    }
    match previous {
        Some(record) => {
            let _ = delete_deployment(db, skill_id, root_id, destination);
            let _ = upsert_deployment_record(db, record, timestamp);
        }
        None => {
            let _ = delete_deployment(db, skill_id, root_id, destination);
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
            Some(record) => {
                delete_deployment(db, &item.skill_id, root_id, &item.destination)?;
                upsert_deployment_record(db, record, timestamp)?;
            }
            None => delete_deployment(db, &item.skill_id, root_id, &item.destination)?,
        }
        set_operation_item_status(db, operation_id, item.position, "rolled_back", None)?;
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
    let inspected = skills::inspect_portable_skill(path)?;
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
    position: i64,
    snapshot: Option<&Path>,
) -> Result<(), AppError> {
    let snapshot = snapshot.map(|path| path.to_string_lossy().into_owned());
    db.connect()?.execute(
        "UPDATE apply_operation_items SET snapshot_path = ?3
         WHERE operation_id = ?1 AND position = ?2",
        params![operation_id, position, snapshot],
    )?;
    Ok(())
}

fn set_operation_item_applied(
    db: &Database,
    operation_id: &str,
    position: i64,
    deployed_hash: &str,
) -> Result<(), AppError> {
    db.connect()?.execute(
        "UPDATE apply_operation_items
         SET status = 'applied', deployed_hash = ?3, error = NULL
         WHERE operation_id = ?1 AND position = ?2",
        params![operation_id, position, deployed_hash],
    )?;
    Ok(())
}

fn set_operation_item_status(
    db: &Database,
    operation_id: &str,
    position: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    db.connect()?.execute(
        "UPDATE apply_operation_items SET status = ?3, error = ?4
         WHERE operation_id = ?1 AND position = ?2",
        params![operation_id, position, status, error],
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
            id: hash_text(&format!(
                "{}\0{root_id}\0{}",
                skill.id,
                crate::agent_center::path_key(destination)
            )),
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
         ON CONFLICT(root_id,destination_path) DO UPDATE SET
           skill_id = excluded.skill_id,
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

fn delete_deployment(
    db: &Database,
    skill_id: &str,
    root_id: &str,
    destination: &Path,
) -> Result<(), AppError> {
    db.connect()?.execute(
        "DELETE FROM deployments WHERE skill_id = ?1 AND root_id = ?2 AND destination_path=?3",
        params![skill_id, root_id, destination.to_string_lossy()],
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

    #[test]
    fn selection_overwrites_unmanaged_content_and_restores_exact_backup() {
        let root = test_root("selection-restore");
        let library = root.join("library");
        fs::create_dir_all(&library).unwrap();
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        let database = Database::initialize(root.join("db.sqlite")).unwrap();
        crate::agent_center::initialize(&database).unwrap();
        let source = root.join("source/demo");
        write_skill(&source, "demo", "library version", None);
        let skill = import_skill_directory(&database, &library, &source)
            .unwrap()
            .skill;
        let registered = register_root(&database, &target);
        write_skill(&target.join("demo"), "demo", "unmanaged original", None);
        fs::write(target.join("keep.txt"), "unselected").unwrap();
        let before = super::target_fingerprint(&target.join("demo")).unwrap();
        let plan =
            crate::bundle_planner::generate_selection_plan(&database, &[skill.id], &registered.id)
                .unwrap();
        assert_eq!(plan.items[0].action, "update");
        let operation = apply_sync_plan(&database, &root.join("operations"), &plan.id, 10).unwrap();
        assert_eq!(
            inspect_skill(&target.join("demo")).unwrap().content_hash,
            skill.content_hash
        );
        assert!(Path::new(operation.items[0].snapshot_path.as_ref().unwrap()).exists());
        super::restore_operation(&database, &operation.id, 20).unwrap();
        assert_eq!(
            super::target_fingerprint(&target.join("demo")).unwrap(),
            before
        );
        assert_eq!(
            fs::read_to_string(target.join("keep.txt")).unwrap(),
            "unselected"
        );
        assert!(list_deployments(&database).unwrap().is_empty());
        assert!(super::restore_operation(&database, &operation.id, 21).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selection_rejects_stale_target_and_readonly_root() {
        let root = test_root("selection-stale");
        let library = root.join("library");
        fs::create_dir_all(&library).unwrap();
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        let db = Database::initialize(root.join("db.sqlite")).unwrap();
        crate::agent_center::initialize(&db).unwrap();
        let source = root.join("source/demo");
        write_skill(&source, "demo", "source", None);
        let skill = import_skill_directory(&db, &library, &source)
            .unwrap()
            .skill;
        let registered =
            crate::agent_center::register_root(&db, "codex", &target, "user", "native", None)
                .unwrap();
        let plan = crate::bundle_planner::generate_selection_plan(
            &db,
            std::slice::from_ref(&skill.id),
            &registered.id,
        )
        .unwrap();
        write_skill(
            &target.join("demo"),
            "demo",
            "new content after preview",
            None,
        );
        let before = super::target_fingerprint(&target.join("demo")).unwrap();
        assert!(apply_sync_plan(&db, &root.join("operations"), &plan.id, 10).is_err());
        assert_eq!(
            super::target_fingerprint(&target.join("demo")).unwrap(),
            before
        );
        crate::agent_center::register_root(&db, "codex", &target, "user", "system", None).unwrap();
        assert!(
            crate::bundle_planner::generate_selection_plan(&db, &[skill.id], &registered.id)
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn junction_overwrite_and_restore_never_mutate_shared_source() {
        let root = test_root("junction-restore");
        let library = root.join("library");
        let target = root.join("target");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&target).unwrap();
        let db = Database::initialize(root.join("db.sqlite")).unwrap();
        crate::agent_center::initialize(&db).unwrap();
        let source = root.join("source/demo");
        write_skill(&source, "demo", "new", None);
        let outside = root.join("shared/demo");
        write_skill(&outside, "demo", "shared", None);
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("cmd.exe")
            .raw_arg(format!(
                "/d /c mklink /J \"{}\" \"{}\"",
                target.join("demo").display(),
                outside.display()
            ))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let shared_before = super::target_fingerprint(&outside).unwrap();
        let link_before = fs::read_link(target.join("demo")).unwrap();
        let skill = import_skill_directory(&db, &library, &source)
            .unwrap()
            .skill;
        let registered =
            crate::agent_center::register_root(&db, "codex", &target, "user", "native", None)
                .unwrap();
        let plan = crate::bundle_planner::generate_selection_plan(&db, &[skill.id], &registered.id)
            .unwrap();
        let operation = apply_sync_plan(&db, &root.join("operations"), &plan.id, 10).unwrap();
        assert!(!fs::symlink_metadata(target.join("demo"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(super::target_fingerprint(&outside).unwrap(), shared_before);
        super::restore_operation(&db, &operation.id, 20).unwrap();
        assert_eq!(fs::read_link(target.join("demo")).unwrap(), link_before);
        assert_eq!(super::target_fingerprint(&outside).unwrap(), shared_before);
        crate::skills::remove_if_exists(&target.join("demo")).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
