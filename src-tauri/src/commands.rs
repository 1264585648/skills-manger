use serde::Serialize;
use tauri::State;

use crate::{
    agent_discovery::{
        self, AgentDiscoverySnapshot, AgentTargetRecord, DiscoveryRootRecord, SkillInstanceRecord,
    },
    bundle_planner::{self, BundleDraft, BundleRecord, SyncPlanRecord},
    error::CommandError,
    git_sources::{self, GitSourceDraft, SkillUpdateRecord},
    safe_apply::{self, ApplyOperationRecord, DeploymentRecord},
    skill_preview::{self, SkillImportPreview},
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
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<crate::db::TagRecord>, CommandError> {
    state.db.list_tags().map_err(CommandError::from)
}

#[tauri::command]
pub fn upsert_tag(
    state: State<'_, AppState>,
    draft: crate::db::TagDraft,
) -> Result<crate::db::TagRecord, CommandError> {
    state
        .db
        .upsert_tag(
            &draft,
            crate::agent_discovery::unix_timestamp().map_err(CommandError::from)?,
        )
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.db.delete_tag(&id).map_err(CommandError::from)
}

#[tauri::command]
pub fn set_skill_tags(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> Result<(), CommandError> {
    state
        .db
        .set_skill_tags(&skill_ids, &tag_ids)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn set_skill_tag_assignments(
    state: State<'_, AppState>,
    assignments: Vec<crate::db::TagAssignment>,
) -> Result<(), CommandError> {
    state
        .db
        .set_skill_tag_assignments(&assignments)
        .map_err(CommandError::from)
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
pub async fn scan_claude_code(
    state: State<'_, AppState>,
) -> Result<AgentDiscoverySnapshot, CommandError> {
    let snapshot = compatibility_scan(&state, "claude-code").await?;
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
pub async fn scan_codex(
    state: State<'_, AppState>,
) -> Result<AgentDiscoverySnapshot, CommandError> {
    let snapshot = compatibility_scan(&state, "codex").await?;
    let _ = state.log.write(
        "info",
        "codex_scanned",
        &format!(
            "{} roots registered; {} instances recorded; {} warnings",
            snapshot.roots.len(),
            snapshot.instances.len(),
            snapshot.warnings.len()
        ),
    );
    Ok(snapshot)
}

async fn compatibility_scan(
    state: &AppState,
    agent_id: &str,
) -> Result<AgentDiscoverySnapshot, CommandError> {
    crate::agent_center::start_scan(
        &state.db,
        &state.library_root,
        state.scan.clone(),
        Some(agent_id.into()),
        None,
    )?;
    let controller = state.scan.clone();
    let db_path = state.db.path().to_path_buf();
    let agent_id = agent_id.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            let status = controller
                .status
                .lock()
                .map_err(|_| crate::error::AppError::State("扫描状态不可用".into()))?
                .clone();
            if !status.running {
                if let Some(error) = status.error {
                    return Err(crate::error::AppError::State(error));
                }
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let db = crate::db::Database::initialize(db_path)?;
        let target = db
            .list_agent_targets()?
            .into_iter()
            .find(|a| a.id == agent_id)
            .ok_or_else(|| crate::error::AppError::State("Agent 不存在".into()))?;
        Ok::<_, crate::error::AppError>(AgentDiscoverySnapshot {
            target,
            roots: db.list_discovery_roots()?,
            instances: db.list_skill_instances()?,
            warnings: vec![],
        })
    })
    .await
    .map_err(|_| CommandError::from(crate::error::AppError::State("扫描任务中断".into())))?
    .map_err(Into::into)
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
    agent_id: Option<String>,
) -> Result<DiscoveryRootRecord, CommandError> {
    if scope != "project" {
        return Err(CommandError::from(crate::error::AppError::State(
            "only project discovery roots can be added".to_string(),
        )));
    }
    let agent_id = agent_id.as_deref().unwrap_or("claude-code");
    let record = agent_discovery::register_project_root_for_agent(
        &state.db,
        &state.library_root,
        agent_id,
        path,
        agent_discovery::unix_timestamp().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "discovery_root_added",
        &format!(
            "{} project root registered: {}",
            record.agent_id, record.configured_path
        ),
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
        &format!(
            "operation {} finished as {}",
            operation.id, operation.status
        ),
    );
    Ok(operation)
}

#[tauri::command]
pub fn list_deployments(state: State<'_, AppState>) -> Result<Vec<DeploymentRecord>, CommandError> {
    safe_apply::list_deployments(&state.db).map_err(CommandError::from)
}

#[tauri::command]
pub fn list_apply_operations(
    state: State<'_, AppState>,
) -> Result<Vec<ApplyOperationRecord>, CommandError> {
    safe_apply::list_apply_operations(&state.db).map_err(CommandError::from)
}

#[tauri::command]
pub fn register_git_source(
    state: State<'_, AppState>,
    draft: GitSourceDraft,
) -> Result<SkillUpdateRecord, CommandError> {
    let app_data = state.library_root.parent().ok_or_else(|| {
        CommandError::from(crate::error::AppError::State(
            "application data directory is unavailable".to_string(),
        ))
    })?;
    let record = git_sources::register_git_source(
        &state.db,
        &state.library_root,
        &app_data.join("git-checkouts"),
        &draft,
        agent_discovery::unix_timestamp().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "git_source_registered",
        &format!("Git source registered for {}", record.skill_name),
    );
    Ok(record)
}

#[tauri::command]
pub fn list_skill_updates(
    state: State<'_, AppState>,
) -> Result<Vec<SkillUpdateRecord>, CommandError> {
    git_sources::list_update_statuses(&state.db).map_err(CommandError::from)
}

#[tauri::command]
pub fn check_git_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<SkillUpdateRecord, CommandError> {
    git_sources::check_git_source(
        &state.db,
        &source_id,
        agent_discovery::unix_timestamp().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)
}

#[tauri::command]
pub fn promote_git_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<ImportSkillResult, CommandError> {
    let result = git_sources::promote_git_source(
        &state.db,
        &state.library_root,
        &source_id,
        agent_discovery::unix_timestamp().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)?;
    let _ = state.log.write(
        "info",
        "git_source_promoted",
        &format!("upstream promoted for {}", result.skill.name),
    );
    Ok(result)
}
