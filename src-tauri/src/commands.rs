use serde::Serialize;
use tauri::State;

use crate::{
    agent_discovery::{
        self, AgentDiscoverySnapshot, AgentTargetRecord, DiscoveryRootRecord, SkillInstanceRecord,
    },
    bundle_planner::{self, BundleDraft, BundleRecord, SyncPlanRecord},
    error::CommandError,
    skill_preview::{self, SkillImportPreview},
    safe_apply::{self, ApplyOperationRecord, DeploymentRecord},
    skills::{self, ImportSkillResult, SkillRecord},
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
    app_version: String,
    database_ok: bool,
    database_path: String,
    log_path: String,
    counter: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterSnapshot {
    value: i64,
}

#[tauri::command]
pub fn get_health(state: State<'_, AppState>) -> Result<HealthSnapshot, CommandError> {
    state.db.health_check().map_err(CommandError::from)?;
    let counter = state.db.counter().map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "health_check",
        "desktop bridge and SQLite are ready",
    );

    Ok(HealthSnapshot {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        database_ok: true,
        database_path: state.db.path().to_string_lossy().into_owned(),
        log_path: state.log.path().to_string_lossy().into_owned(),
        counter,
    })
}

#[tauri::command]
pub fn increment_counter(state: State<'_, AppState>) -> Result<CounterSnapshot, CommandError> {
    let value = state.db.increment_counter().map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "sqlite_write_test",
        &format!("persistent counter updated to {value}"),
    );

    Ok(CounterSnapshot { value })
}

#[tauri::command]
pub fn list_library_skills(state: State<'_, AppState>) -> Result<Vec<SkillRecord>, CommandError> {
    state.db.list_skills().map_err(CommandError::from)
}

#[tauri::command]
pub fn preview_skill_directory(
    state: State<'_, AppState>,
    path: String,
) -> Result<SkillImportPreview, CommandError> {
    skill_preview::preview_skill_directory(&state.db, &state.library_root, path)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn import_skill_directory(
    state: State<'_, AppState>,
    path: String,
) -> Result<ImportSkillResult, CommandError> {
    let result = skills::import_skill_directory(&state.db, &state.library_root, path)
        .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "skill_imported",
        &format!(
            "{}: {} ({})",
            result.outcome, result.skill.name, result.skill.source_locator
        ),
    );

    Ok(result)
}

#[tauri::command]
pub fn list_agent_targets(
    state: State<'_, AppState>,
) -> Result<Vec<AgentTargetRecord>, CommandError> {
    state.db.list_agent_targets().map_err(CommandError::from)
}

#[tauri::command]
pub fn scan_claude_code(
    state: State<'_, AppState>,
) -> Result<AgentDiscoverySnapshot, CommandError> {
    let snapshot = agent_discovery::scan_claude_code(&state.db, &state.library_root)
        .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "claude_code_scanned",
        &format!(
            "{} roots scanned; {} instances recorded; {} warnings",
            snapshot.roots.len(),
            snapshot.instances.len(),
            snapshot.warnings.len()
        ),
    );
    Ok(snapshot)
}

#[tauri::command]
pub fn list_discovery_roots(
    state: State<'_, AppState>,
) -> Result<Vec<DiscoveryRootRecord>, CommandError> {
    state.db.list_discovery_roots().map_err(CommandError::from)
}

#[tauri::command]
pub fn add_discovery_root(
    state: State<'_, AppState>,
    path: String,
    scope: String,
) -> Result<DiscoveryRootRecord, CommandError> {
    if scope != "project" {
        return Err(CommandError::from(crate::error::AppError::State(
            "only project discovery roots can be added".to_string(),
        )));
    }
    let record = agent_discovery::register_project_root(
        &state.db,
        &state.library_root,
        path,
        agent_discovery::unix_timestamp().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "discovery_root_added",
        &format!("project root registered: {}", record.configured_path),
    );
    Ok(record)
}

#[tauri::command]
pub fn remove_discovery_root(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    let root = state
        .db
        .list_discovery_roots()
        .map_err(CommandError::from)?
        .into_iter()
        .find(|root| root.id == id)
        .ok_or_else(|| {
            CommandError::from(crate::error::AppError::State(
                "discovery root was not found".to_string(),
            ))
        })?;
    if root.is_default {
        return Err(CommandError::from(crate::error::AppError::State(
            "the default user discovery root cannot be removed".to_string(),
        )));
    }
    state
        .db
        .remove_discovery_root(&root.id)
        .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "discovery_root_removed",
        &format!(
            "discovery root registration removed: {}",
            root.configured_path
        ),
    );
    Ok(())
}

#[tauri::command]
pub fn list_skill_instances(
    state: State<'_, AppState>,
) -> Result<Vec<SkillInstanceRecord>, CommandError> {
    state.db.list_skill_instances().map_err(CommandError::from)
}

#[tauri::command]
pub fn list_bundles(state: State<'_, AppState>) -> Result<Vec<BundleRecord>, CommandError> {
    state.db.list_bundles().map_err(CommandError::from)
}

#[tauri::command]
pub fn upsert_bundle(
    state: State<'_, AppState>,
    draft: BundleDraft,
) -> Result<BundleRecord, CommandError> {
    let bundle = state
        .db
        .upsert_bundle(
            &draft,
            agent_discovery::unix_timestamp().map_err(CommandError::from)?,
        )
        .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "bundle_saved",
        &format!(
            "bundle saved: {} ({} items)",
            bundle.name,
            bundle.items.len()
        ),
    );
    Ok(bundle)
}

#[tauri::command]
pub fn delete_bundle(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.db.delete_bundle(&id).map_err(CommandError::from)?;
    let _ = state
        .log
        .write("info", "bundle_deleted", &format!("bundle deleted: {id}"));
    Ok(())
}

#[tauri::command]
pub fn generate_sync_plan(
    state: State<'_, AppState>,
    bundle_id: String,
    root_id: String,
) -> Result<SyncPlanRecord, CommandError> {
    let plan = bundle_planner::generate_sync_plan(&state.db, &bundle_id, &root_id)
        .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "sync_plan_generated",
        &format!(
            "read-only plan {} generated with {} items",
            plan.id,
            plan.items.len()
        ),
    );
    Ok(plan)
}

#[tauri::command]
pub fn apply_sync_plan(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<ApplyOperationRecord, CommandError> {
    let app_data = state.library_root.parent().ok_or_else(|| {
        CommandError::from(crate::error::AppError::State(
            "application data directory is unavailable".to_string(),
        ))
    })?;
    let operation = safe_apply::apply_sync_plan(
        &state.db,
        &app_data.join("operations"),
        &plan_id,
        agent_discovery::unix_timestamp().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "sync_plan_applied",
        &format!("operation {} finished as {}", operation.id, operation.status),
    );
    Ok(operation)
}

#[tauri::command]
pub fn list_deployments(
    state: State<'_, AppState>,
) -> Result<Vec<DeploymentRecord>, CommandError> {
    safe_apply::list_deployments(&state.db).map_err(CommandError::from)
}

#[tauri::command]
pub fn list_apply_operations(
    state: State<'_, AppState>,
) -> Result<Vec<ApplyOperationRecord>, CommandError> {
    safe_apply::list_apply_operations(&state.db).map_err(CommandError::from)
}
