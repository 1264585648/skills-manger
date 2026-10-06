mod agent_catalog;
mod agent_discovery;
mod commands;
mod db;
mod error;
mod linker;
mod logging;
mod skills;
mod vault;

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use agent_discovery::ScanSnapshot;
use db::Database;
use error::AppError;
use logging::AppLog;
use tauri::Manager;

pub struct AppState {
    db: Arc<Database>,
    log: Arc<AppLog>,
    /// Serialises scans: the background warm-up and a UI-triggered scan never
    /// walk the filesystem at the same time.
    scan_lock: Arc<Mutex<()>>,
    /// Result of the most recent scan, served to the UI without rescanning.
    scan_cache: Arc<Mutex<Option<ScanSnapshot>>>,
}

impl AppState {
    /// The cached scan when one exists and no fresh pass was requested.
    fn cached_scan(&self) -> Option<ScanSnapshot> {
        self.scan_cache
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().cloned())
    }

    /// Serve the cached scan, or walk the disk when there is none (yet).
    ///
    /// The UI calls this on every mount and React's strict mode calls it twice
    /// in development; the cache means the second call costs nothing and the
    /// startup scan is never repeated while the user is waiting.
    pub fn scan(&self, force: bool, timestamp: i64) -> Result<ScanSnapshot, AppError> {
        if !force {
            if let Some(cached) = self.cached_scan() {
                return Ok(cached);
            }
        }

        let _guard = self
            .scan_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // Another thread may have finished the scan while we waited for the lock.
        if !force {
            if let Some(cached) = self.cached_scan() {
                return Ok(cached);
            }
        }

        let snapshot = agent_discovery::scan_all(&self.db, timestamp)?;
        if let Ok(mut guard) = self.scan_cache.lock() {
            *guard = Some(snapshot.clone());
        }
        Ok(snapshot)
    }

    /// Invalidate the scan cache after disk or database mutations.
    pub fn invalidate_scan_cache(&self) {
        if let Ok(mut guard) = self.scan_cache.lock() {
            *guard = None;
        }
    }
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

            let log = Arc::new(AppLog::new(app_data_dir.join("skills-manager.log"))?);
            let db = Arc::new(Database::initialize(
                app_data_dir.join("skills-manager.sqlite3"),
            )?);
            agent_discovery::ensure_targets_registered(&db, now())?;

            let scan_lock = Arc::new(Mutex::new(()));
            let scan_cache = Arc::new(Mutex::new(None));

            // Warm the cache off the main thread: the window shows immediately
            // and the first scan result is ready by the time the UI asks.
            {
                let db = Arc::clone(&db);
                let log = Arc::clone(&log);
                let scan_lock = Arc::clone(&scan_lock);
                let scan_cache = Arc::clone(&scan_cache);
                std::thread::spawn(move || {
                    let _guard = scan_lock
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    match agent_discovery::scan_all(&db, now()) {
                        Ok(snapshot) => {
                            let _ = log.write(
                                "info",
                                "startup_scan_finished",
                                &format!(
                                    "{} roots scanned; {} skills found; {} warnings",
                                    snapshot.roots.len(),
                                    snapshot.instances.len(),
                                    snapshot.warnings.len()
                                ),
                            );
                            if let Ok(mut guard) = scan_cache.lock() {
                                *guard = Some(snapshot);
                            }
                        }
                        Err(error) => {
                            let _ = log.write("warn", "startup_scan_failed", &error.to_string());
                        }
                    }
                });
            }

            let _ = log.write(
                "info",
                "application_started",
                &format!("Skills Manager {}", env!("CARGO_PKG_VERSION")),
            );

            app.manage(AppState {
                db,
                log,
                scan_lock,
                scan_cache,
            });
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
            commands::incorporate_to_vault,
            commands::deactivate_home_skill,
            commands::auto_merge_identical,
            commands::manual_merge_keep_one,
            commands::fork_skill,
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
