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
pub fn scan(state: State<'_, AppState>, force: Option<bool>) -> Result<ScanSnapshot, CommandError> {
    // `force` asks for a real pass over the disk. Everything else is served
    // from the cache filled by the startup scan or the last explicit scan, so
    // mounting the page (twice, under React strict mode) is instant.
    let force = force.unwrap_or(false);
    let snapshot = state
        .scan(force, unix_timestamp()?)
        .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        if force {
            "scan_finished"
        } else {
            "scan_served_from_cache"
        },
        &format!(
            "{} roots; {} skills; {} warnings",
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

    state.invalidate_scan_cache();
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

    state.invalidate_scan_cache();
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
    let _ = state.log.write(
        "info",
        "cmd_link_skill_called",
        &format!("path={skill_path}, target={target_root_id}"),
    );
    let outcome = linker::link_skill(&state.db, &skill_path, &target_root_id, unix_timestamp()?)
        .map_err(|err| {
            let _ = state.log.write(
                "error",
                "link_skill_failed",
                &format!("path={skill_path}, target={target_root_id}: {err}"),
            );
            CommandError::from(err)
        })?;

    let _ = state.log.write(
        "info",
        if outcome.created {
            "link_created"
        } else {
            "link_kept"
        },
        &format!("{} -> {}", outcome.link.skill_path, outcome.link.link_path),
    );

    state.invalidate_scan_cache();
    Ok(outcome)
}

#[tauri::command]
pub fn unlink_skill(
    state: State<'_, AppState>,
    link_id: String,
) -> Result<crate::db::LinkRecord, CommandError> {
    let _ = state.log.write(
        "info",
        "cmd_unlink_skill_called",
        &format!("link_id={link_id}"),
    );
    let link = linker::unlink_skill(&state.db, &link_id)
        .map_err(|err| {
            let _ = state.log.write(
                "error",
                "unlink_skill_failed",
                &format!("link_id={link_id}: {err}"),
            );
            CommandError::from(err)
        })?;

    let _ = state.log.write(
        "info",
        "link_removed",
        &format!("link removed: {}", link.link_path),
    );

    state.invalidate_scan_cache();
    Ok(link)
}

#[tauri::command]
pub fn list_links(state: State<'_, AppState>) -> Result<Vec<crate::db::LinkRecord>, CommandError> {
    state.db.list_links().map_err(CommandError::from)
}

// ------------------------------------------------------------------ 中央库与合并

#[tauri::command]
pub fn incorporate_to_vault(
    state: State<'_, AppState>,
    skill_path: String,
) -> Result<String, CommandError> {
    let _ = state.log.write(
        "info",
        "cmd_incorporate_to_vault_called",
        &format!("path={skill_path}"),
    );
    let canonical = crate::vault::incorporate_skill(
        &state.db,
        std::path::Path::new(&skill_path),
        unix_timestamp()?,
    )
    .map_err(|err| {
        let _ = state.log.write(
            "error",
            "incorporate_failed",
            &format!("path={skill_path}: {err}"),
        );
        CommandError::from(err)
    })?;

    let _ = state.log.write(
        "info",
        "skill_incorporated_to_vault",
        &format!("{skill_path} -> {}", canonical.display()),
    );

    state.invalidate_scan_cache();
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn deactivate_home_skill(
    state: State<'_, AppState>,
    skill_path: String,
) -> Result<String, CommandError> {
    let _ = state.log.write(
        "info",
        "cmd_deactivate_home_skill_called",
        &format!("path={skill_path}"),
    );
    let canonical = crate::vault::deactivate_home_skill(
        &state.db,
        std::path::Path::new(&skill_path),
        unix_timestamp()?,
    )
    .map_err(|err| {
        let _ = state.log.write(
            "error",
            "deactivate_failed",
            &format!("path={skill_path}: {err}"),
        );
        CommandError::from(err)
    })?;

    let _ = state.log.write(
        "info",
        "home_skill_deactivated",
        &format!("{skill_path} deactivated; preserved in {}", canonical.display()),
    );

    state.invalidate_scan_cache();
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn auto_merge_identical(
    state: State<'_, AppState>,
) -> Result<crate::vault::AutoMergeReport, CommandError> {
    let report = crate::vault::auto_merge_identical(&state.db, unix_timestamp()?)
        .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "auto_merge_identical_completed",
        &format!(
            "merged {} skills; created {} links",
            report.merged_names.len(),
            report.links_created
        ),
    );

    state.invalidate_scan_cache();
    Ok(report)
}

#[tauri::command]
pub fn manual_merge_keep_one(
    state: State<'_, AppState>,
    skill_name: String,
    winner_path: String,
) -> Result<String, CommandError> {
    let canonical = crate::vault::manual_merge_keep_one(
        &state.db,
        &skill_name,
        std::path::Path::new(&winner_path),
        unix_timestamp()?,
    )
    .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "manual_merge_keep_one_completed",
        &format!("{skill_name} retained from {winner_path}"),
    );

    state.invalidate_scan_cache();
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn fork_skill(
    state: State<'_, AppState>,
    source_path: String,
    new_name: String,
) -> Result<String, CommandError> {
    let canonical = crate::vault::fork_skill(
        &state.db,
        std::path::Path::new(&source_path),
        &new_name,
        unix_timestamp()?,
    )
    .map_err(CommandError::from)?;

    let _ = state.log.write(
        "info",
        "fork_skill_completed",
        &format!("{source_path} forked to {new_name}"),
    );

    state.invalidate_scan_cache();
    Ok(canonical.to_string_lossy().into_owned())
}
