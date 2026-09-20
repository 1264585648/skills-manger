//! Tauri command surface for the minimal 发现 → 治理 → 写回 flow.

use serde::Serialize;
use tauri::State;

use crate::{
    agent_discovery::{self, ScanSnapshot, SkillInstanceRecord},
    db::{GroupDraft, GroupRecord, SkillNoteRecord, TagDraft, TagRecord},
    error::CommandError,
    linker,
    skills::unix_timestamp,
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
    pub app_version: String,
    pub database_ok: bool,
    pub database_path: String,
    pub log_path: String,
}

#[tauri::command]
pub fn get_health(state: State<'_, AppState>) -> Result<HealthSnapshot, CommandError> {
    state.db.health_check().map_err(CommandError::from)?;

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
    })
}

// ------------------------------------------------------------------ 发现

#[tauri::command]
pub fn scan(state: State<'_, AppState>) -> Result<ScanSnapshot, CommandError> {
    let snapshot =
        agent_discovery::scan_all(&state.db, unix_timestamp()?).map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "scan_finished",
        &format!(
            "{} roots scanned; {} skills found; {} warnings",
            snapshot.roots.len(),
            snapshot.instances.len(),
            snapshot.warnings.len()
        ),
    );

    Ok(snapshot)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentRecord {
    pub skill_path: String,
    pub target_id: String,
}

#[tauri::command]
pub fn list_agent_catalog() -> Vec<&'static crate::agent_catalog::AgentDefinition> {
    crate::agent_catalog::AGENTS.iter().collect()
}

fn map_assignments(pairs: Vec<(String, String)>) -> Vec<AssignmentRecord> {
    pairs
        .into_iter()
        .map(|(skill_path, target_id)| AssignmentRecord {
            skill_path,
            target_id,
        })
        .collect()
}

#[tauri::command]
pub fn list_agent_targets(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::AgentTargetRecord>, CommandError> {
    state.db.list_agent_targets().map_err(CommandError::from)
}

#[tauri::command]
pub fn list_discovery_roots(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::DiscoveryRootRecord>, CommandError> {
    state.db.list_discovery_roots().map_err(CommandError::from)
}

#[tauri::command]
pub fn list_skill_instances(
    state: State<'_, AppState>,
) -> Result<Vec<SkillInstanceRecord>, CommandError> {
    state.db.list_skill_instances().map_err(CommandError::from)
}

#[tauri::command]
pub fn add_project_root(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
) -> Result<crate::db::DiscoveryRootRecord, CommandError> {
    let record = agent_discovery::register_project_root(
        &state.db,
        &agent_id,
        std::path::Path::new(&path),
        unix_timestamp()?,
    )
    .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "project_root_added",
        &format!(
            "{} project root registered: {}",
            record.agent_id, record.configured_path
        ),
    );

    Ok(record)
}

#[tauri::command]
pub fn remove_project_root(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state
        .db
        .remove_discovery_root(&id)
        .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "project_root_removed",
        &format!("discovery root registration removed: {id}"),
    );

    Ok(())
}

// ------------------------------------------------------------------ 治理

#[tauri::command]
pub fn list_groups(state: State<'_, AppState>) -> Result<Vec<GroupRecord>, CommandError> {
    state.db.list_groups().map_err(CommandError::from)
}

#[tauri::command]
pub fn list_skill_group_assignments(
    state: State<'_, AppState>,
) -> Result<Vec<AssignmentRecord>, CommandError> {
    state
        .db
        .skill_group_assignments()
        .map(map_assignments)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn upsert_group(
    state: State<'_, AppState>,
    draft: GroupDraft,
) -> Result<GroupRecord, CommandError> {
    state
        .db
        .upsert_group(&draft, unix_timestamp()?)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn delete_group(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.db.delete_group(&id).map_err(CommandError::from)
}

#[tauri::command]
pub fn set_skill_group(
    state: State<'_, AppState>,
    skill_path: String,
    group_id: Option<String>,
) -> Result<(), CommandError> {
    state
        .db
        .set_skill_group(&skill_path, group_id.as_deref(), unix_timestamp()?)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<TagRecord>, CommandError> {
    state.db.list_tags().map_err(CommandError::from)
}

#[tauri::command]
pub fn list_skill_tag_assignments(
    state: State<'_, AppState>,
) -> Result<Vec<AssignmentRecord>, CommandError> {
    state
        .db
        .skill_tag_assignments()
        .map(map_assignments)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn upsert_tag(state: State<'_, AppState>, draft: TagDraft) -> Result<TagRecord, CommandError> {
    state
        .db
        .upsert_tag(&draft, unix_timestamp()?)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.db.delete_tag(&id).map_err(CommandError::from)
}

#[tauri::command]
pub fn set_skill_tags(
    state: State<'_, AppState>,
    skill_path: String,
    tag_ids: Vec<String>,
) -> Result<(), CommandError> {
    state
        .db
        .set_skill_tags(&skill_path, &tag_ids)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn set_skill_note(
    state: State<'_, AppState>,
    skill_path: String,
    note: String,
) -> Result<SkillNoteRecord, CommandError> {
    state
        .db
        .set_skill_note(&skill_path, &note, unix_timestamp()?)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn list_skill_notes(state: State<'_, AppState>) -> Result<Vec<SkillNoteRecord>, CommandError> {
    state.db.list_skill_notes().map_err(CommandError::from)
}

// ------------------------------------------------------------------ 写回

#[tauri::command]
pub fn link_skill(
    state: State<'_, AppState>,
    skill_path: String,
    target_root_id: String,
) -> Result<linker::LinkOutcome, CommandError> {
    let outcome = linker::link_skill(&state.db, &skill_path, &target_root_id, unix_timestamp()?)
        .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        if outcome.created {
            "link_created"
        } else {
            "link_kept"
        },
        &format!("{} -> {}", outcome.link.skill_path, outcome.link.link_path),
    );

    Ok(outcome)
}

#[tauri::command]
pub fn unlink_skill(
    state: State<'_, AppState>,
    link_id: String,
) -> Result<crate::db::LinkRecord, CommandError> {
    let link = linker::unlink_skill(&state.db, &link_id).map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "link_removed",
        &format!("link removed: {}", link.link_path),
    );

    Ok(link)
}

#[tauri::command]
pub fn list_links(state: State<'_, AppState>) -> Result<Vec<crate::db::LinkRecord>, CommandError> {
    state.db.list_links().map_err(CommandError::from)
}
