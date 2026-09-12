mod agent_catalog;
mod agent_center;
mod agent_commands;
mod agent_discovery;
mod agent_management;
#[cfg(test)]
mod agent_management_tests;
mod bundle_planner;
mod claude_code;
mod codex;
mod commands;
mod db;
mod error;
mod git_sources;
mod logging;
mod safe_apply;
mod skill_preview;
mod skills;

use std::{fs, path::PathBuf};

use db::Database;
use logging::AppLog;
use tauri::Manager;

pub struct AppState {
    db: Database,
    log: AppLog,
    library_root: PathBuf,
    scan: std::sync::Arc<agent_center::ScanController>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let app_data_dir = std::env::var_os("SKILLS_CENTER_QA_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app_data_dir);
            fs::create_dir_all(&app_data_dir)?;

            let library_root = app_data_dir.join("library");
            fs::create_dir_all(&library_root)?;

            let log = AppLog::new(app_data_dir.join("skills-manager.log"))?;
            let db = Database::initialize(app_data_dir.join("skills-manager.sqlite3"))?;
            agent_center::initialize(&db)?;
            let scan = std::sync::Arc::new(agent_center::ScanController::default());
            agent_center::start_scan(&db, &library_root, scan.clone(), None, None)?;

            let _ = log.write(
                "info",
                "application_started",
                &format!("Skills Control Center {}", env!("CARGO_PKG_VERSION")),
            );

            app.manage(AppState {
                db,
                log,
                library_root,
                scan,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agent_commands::get_agent_center,
            agent_commands::get_agent_preferences,
            agent_commands::save_agent_preferences,
            agent_commands::get_agent_management,
            agent_commands::preview_agent_updates,
            agent_commands::bind_agent_skill,
            agent_commands::prepare_agent_import,
            agent_commands::import_agent_skill,
            agent_commands::relocate_agent_root,
            agent_commands::register_preferred_agent_root,
            agent_commands::start_agent_scan,
            agent_commands::cancel_agent_scan,
            agent_commands::save_project_area,
            agent_commands::remove_project_area,
            agent_commands::set_agent_root_enabled,
            agent_commands::register_agent_root,
            agent_commands::read_agent_skill,
            agent_commands::open_agent_path,
            agent_commands::preview_agent_install,
            agent_commands::apply_agent_install,
            agent_commands::restore_agent_install,
            commands::get_health,
            commands::increment_counter,
            commands::list_library_skills,
            commands::list_tags,
            commands::upsert_tag,
            commands::delete_tag,
            commands::set_skill_tags,
            commands::set_skill_tag_assignments,
            commands::preview_skill_directory,
            commands::import_skill_directory,
            commands::list_agent_targets,
            commands::scan_claude_code,
            commands::scan_codex,
            commands::list_discovery_roots,
            commands::add_discovery_root,
            commands::remove_discovery_root,
            commands::list_skill_instances,
            commands::list_bundles,
            commands::upsert_bundle,
            commands::delete_bundle,
            commands::generate_sync_plan,
            commands::apply_sync_plan,
            commands::list_deployments,
            commands::list_apply_operations,
            commands::register_git_source,
            commands::list_skill_updates,
            commands::check_git_source,
            commands::promote_git_source,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Skills Control Center");
}
