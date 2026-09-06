use serde::Serialize;
use tauri::State;

use crate::{error::CommandError, AppState};

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

    let _ = state
        .log
        .write("info", "health_check", "desktop bridge and SQLite are ready");

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
