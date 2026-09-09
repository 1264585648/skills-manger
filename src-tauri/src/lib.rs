mod agent_discovery;
mod bundle_planner;
mod claude_code;
mod commands;
mod db;
mod error;
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
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            let library_root = app_data_dir.join("library");
            fs::create_dir_all(&library_root)?;

            let log = AppLog::new(app_data_dir.join("skills-manager.log"))?;
            let db = Database::initialize(app_data_dir.join("skills-manager.sqlite3"))?;
            agent_discovery::initialize_claude_code(&db)?;

            let _ = log.write(
                "info",
                "application_started",
                &format!("Skills Control Center {}", env!("CARGO_PKG_VERSION")),
            );

            app.manage(AppState {
                db,
                log,
                library_root,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_health,
            commands::increment_counter,
            commands::list_library_skills,
            commands::preview_skill_directory,
            commands::import_skill_directory,
            commands::list_agent_targets,
            commands::scan_claude_code,
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Skills Control Center");
}
