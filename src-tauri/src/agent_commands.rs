use crate::agent_management::{self, AgentPreferences, ImportPreview, ManagementView};
use crate::{
    agent_center::{self, CenterSnapshot, ProjectArea, ScanStatus},
    agent_discovery::DiscoveryRootRecord,
    error::{AppError, CommandError},
    AppState,
};
use std::{path::Path, sync::atomic::Ordering};
use tauri::State;

#[tauri::command]
pub fn get_agent_preferences(state: State<'_, AppState>) -> Result<AgentPreferences, CommandError> {
    agent_management::preferences(&state.db).map_err(Into::into)
}
#[tauri::command]
pub fn save_agent_preferences(
    state: State<'_, AppState>,
    preferences: AgentPreferences,
) -> Result<(), CommandError> {
    agent_management::save_preferences(&state.db, &preferences).map_err(Into::into)
}
#[tauri::command]
pub async fn get_agent_management(
    state: State<'_, AppState>,
    agent_id: String,
    scope_id: String,
) -> Result<ManagementView, CommandError> {
    let path = state.db.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let db = crate::db::Database::initialize(path)?;
        agent_management::management_view(&db, &agent_id, &scope_id)
    })
    .await
    .map_err(|_| AppError::State("技能检查任务中断".into()))?
    .map_err(Into::into)
}
#[tauri::command]
pub async fn preview_agent_updates(
    state: State<'_, AppState>,
    agent_id: String,
    scope_id: String,
    ids: Vec<String>,
) -> Result<Vec<crate::bundle_planner::SyncPlanRecord>, CommandError> {
    let path = state.db.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let db = crate::db::Database::initialize(path)?;
        agent_management::preview_updates(&db, &agent_id, &scope_id, &ids)
    })
    .await
    .map_err(|_| AppError::State("更新预览中断".into()))?
    .map_err(Into::into)
}
#[tauri::command]
pub fn bind_agent_skill(
    state: State<'_, AppState>,
    instance_id: String,
    library_id: String,
) -> Result<(), CommandError> {
    agent_management::bind_skill(&state.db, &instance_id, &library_id).map_err(Into::into)
}
#[tauri::command]
pub async fn prepare_agent_import(
    state: State<'_, AppState>,
    path: Option<String>,
    instance_id: Option<String>,
) -> Result<ImportPreview, CommandError> {
    let db_path = state.db.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let db = crate::db::Database::initialize(db_path)?;
        agent_management::prepare_import(&db, path.as_deref(), instance_id.as_deref())
    })
    .await
    .map_err(|_| AppError::State("导入预览中断".into()))?
    .map_err(Into::into)
}
#[tauri::command]
pub async fn import_agent_skill(
    state: State<'_, AppState>,
    id: String,
    name: String,
    description: String,
) -> Result<crate::skills::ImportSkillResult, CommandError> {
    let path = state.db.path().to_path_buf();
    let library = state.library_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = crate::db::Database::initialize(path)?;
        agent_management::import_prepared(&db, &library, &id, &name, &description)
    })
    .await
    .map_err(|_| AppError::State("导入任务中断".into()))?
    .map_err(Into::into)
}
#[tauri::command]
pub fn relocate_agent_root(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<DiscoveryRootRecord, CommandError> {
    agent_management::relocate_root(&state.db, &id, Path::new(&path)).map_err(Into::into)
}
#[tauri::command]
pub fn register_preferred_agent_root(
    state: State<'_, AppState>,
    agent_id: String,
    project: Option<String>,
) -> Result<DiscoveryRootRecord, CommandError> {
    agent_management::register_preferred_root(&state.db, &agent_id, project.as_deref())
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_agent_center(state: State<'_, AppState>) -> Result<CenterSnapshot, CommandError> {
    agent_center::snapshot(&state.db, &state.scan).map_err(Into::into)
}
#[tauri::command]
pub fn start_agent_scan(
    state: State<'_, AppState>,
    agent_id: Option<String>,
    root_id: Option<String>,
) -> Result<ScanStatus, CommandError> {
    agent_center::start_scan(
        &state.db,
        &state.library_root,
        state.scan.clone(),
        agent_id,
        root_id,
    )
    .map_err(Into::into)
}
#[tauri::command]
pub fn cancel_agent_scan(state: State<'_, AppState>) {
    state.scan.cancel.store(true, Ordering::Relaxed);
}
#[tauri::command]
pub fn save_project_area(
    state: State<'_, AppState>,
    path: String,
    max_depth: u32,
    enabled: bool,
) -> Result<ProjectArea, CommandError> {
    agent_center::save_project(&state.db, Path::new(&path), max_depth, enabled).map_err(Into::into)
}
#[tauri::command]
pub fn remove_project_area(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    agent_center::remove_project(&state.db, &id).map_err(Into::into)
}
#[tauri::command]
pub fn set_agent_root_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), CommandError> {
    agent_center::set_root_enabled(&state.db, &id, enabled).map_err(Into::into)
}
#[tauri::command]
pub fn register_agent_root(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    scope: String,
) -> Result<DiscoveryRootRecord, CommandError> {
    let canonical = agent_center::resolve_local(Path::new(&path))?;
    agent_center::assert_writable_root(&state.db, &canonical)?;
    if canonical.starts_with(&state.library_root) || !canonical.is_dir() {
        return Err(AppError::State("请选择技能库之外的 Agent Skills 目录".into()).into());
    }
    let mut root =
        agent_center::register_root(&state.db, &agent_id, &canonical, &scope, "custom", None)?;
    agent_center::set_root_enabled(&state.db, &root.id, true)?;
    root.enabled = true;
    Ok(root)
}
#[tauri::command]
pub fn read_agent_skill(state: State<'_, AppState>, id: String) -> Result<String, CommandError> {
    agent_center::skill_content(&state.db, &id).map_err(Into::into)
}
#[tauri::command]
pub fn open_agent_path(
    state: State<'_, AppState>,
    root_id: Option<String>,
    skill_id: Option<String>,
    reveal: Option<bool>,
) -> Result<(), CommandError> {
    let path = if let Some(id) = skill_id {
        agent_center::get::<agent_center::DiscoveredSkill>(&state.db, "skill", &id)?.map(|s| s.path)
    } else {
        state
            .db
            .list_discovery_roots()?
            .into_iter()
            .find(|r| Some(&r.id) == root_id.as_ref())
            .map(|r| r.configured_path)
    }
    .ok_or_else(|| AppError::State("目录不存在".into()))?;
    let open_path = if reveal.unwrap_or(false) {
        Path::new(&path).parent().unwrap_or(Path::new(&path))
    } else {
        Path::new(&path)
    };
    let canonical = agent_center::resolve_local(open_path)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(&canonical)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(AppError::from)?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&canonical)
            .spawn()
            .map_err(AppError::from)?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&canonical)
            .spawn()
            .map_err(AppError::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_agent_install(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    root_ids: Vec<String>,
) -> Result<Vec<crate::bundle_planner::SyncPlanRecord>, CommandError> {
    let db_path = state.db.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let db = crate::db::Database::initialize(db_path)?;
        let roots = db.list_discovery_roots()?;
        let mut seen = std::collections::HashSet::new();
        let mut plans = Vec::new();
        for id in root_ids {
            let root = roots
                .iter()
                .find(|r| r.id == id)
                .ok_or_else(|| AppError::State("目标目录不存在".into()))?;
            let real = crate::safe_apply::prospective_root(Path::new(&root.configured_path))?;
            if seen.insert(agent_center::path_key(&real)) {
                plans.push(crate::bundle_planner::generate_selection_plan(
                    &db, &skill_ids, &id,
                )?);
            }
        }
        if plans.is_empty() {
            return Err(AppError::State("请选择目标目录".into()));
        }
        Ok::<_, AppError>(plans)
    })
    .await
    .map_err(|_| CommandError::from(AppError::State("预览任务中断".into())))?
    .map_err(Into::into)
}
#[tauri::command]
pub async fn apply_agent_install(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<crate::safe_apply::ApplyOperationRecord, CommandError> {
    let path = state.db.path().to_path_buf();
    let operations = path.parent().unwrap().join("operations");
    tauri::async_runtime::spawn_blocking(move || {
        let db = crate::db::Database::initialize(path)?;
        crate::safe_apply::apply_sync_plan(&db, &operations, &plan_id, agent_center::now())
    })
    .await
    .map_err(|_| CommandError::from(AppError::State("安装任务中断".into())))?
    .map_err(Into::into)
}
#[tauri::command]
pub async fn restore_agent_install(
    state: State<'_, AppState>,
    operation_id: String,
) -> Result<crate::safe_apply::ApplyOperationRecord, CommandError> {
    let path = state.db.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let db = crate::db::Database::initialize(path)?;
        crate::safe_apply::restore_operation(&db, &operation_id, agent_center::now())
    })
    .await
    .map_err(|_| CommandError::from(AppError::State("恢复任务中断".into())))?
    .map_err(Into::into)
}
