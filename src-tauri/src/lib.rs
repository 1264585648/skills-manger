mod agent_catalog;
mod agent_discovery;
mod commands;
mod db;
mod error;
mod linker;
mod logging;
mod skills;

use std::{fs, path::PathBuf};

use db::Database;
use logging::AppLog;
use tauri::Manager;

pub struct AppState {
    db: Database,
    log: AppLog,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let app_data_dir = std::env::var_os("SKILLS_MANAGER_QA_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app_data_dir);
            fs::create_dir_all(&app_data_dir)?;

            let log = AppLog::new(app_data_dir.join("skills-manager.log"))?;
            let db = Database::initialize(app_data_dir.join("skills-manager.sqlite3"))?;
            agent_discovery::ensure_targets_registered(&db, now())?;
            if let Err(error) = agent_discovery::scan_all(&db, now()) {
                let _ = log.write("warn", "initial_scan_failed", &error.to_string());
            }

            let _ = log.write(
                "info",
                "application_started",
                &format!("Skills Manager {}", env!("CARGO_PKG_VERSION")),
            );

            app.manage(AppState { db, log });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_health,
            commands::list_agent_catalog,
            commands::scan,
            commands::list_agent_targets,
            commands::list_discovery_roots,
            commands::list_skill_instances,
            commands::add_project_root,
            commands::remove_project_root,
            commands::list_groups,
            commands::upsert_group,
            commands::delete_group,
            commands::set_skill_group,
            commands::list_skill_group_assignments,
            commands::list_tags,
            commands::upsert_tag,
            commands::delete_tag,
            commands::set_skill_tags,
            commands::list_skill_tag_assignments,
            commands::set_skill_note,
            commands::list_skill_notes,
            commands::link_skill,
            commands::unlink_skill,
            commands::list_links,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Skills Manager");
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
