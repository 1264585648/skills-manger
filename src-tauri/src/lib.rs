mod commands;
mod db;
mod error;
mod logging;

use std::fs;

use db::Database;
use logging::AppLog;
use tauri::Manager;

pub struct AppState {
    db: Database,
    log: AppLog,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            let log = AppLog::new(app_data_dir.join("skills-manager.log"))?;
            let db = Database::initialize(app_data_dir.join("skills-manager.sqlite3"))?;

            let _ = log.write(
                "info",
                "application_started",
                &format!("Skills Control Center {}", env!("CARGO_PKG_VERSION")),
            );

            app.manage(AppState { db, log });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_health,
            commands::increment_counter
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Skills Control Center");
}
