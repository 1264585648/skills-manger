use std::{
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::error::AppError;

#[derive(Debug)]
pub struct AppLog {
    path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent<'a> {
    timestamp_unix_ms: u128,
    level: &'a str,
    event: &'a str,
    message: &'a str,
}

impl AppLog {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let log = Self {
            path: path.as_ref().to_path_buf(),
        };

        log.write("info", "application_log_initialized", "local log ready")?;
        Ok(log)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn write(&self, level: &str, event: &str, message: &str) -> Result<(), AppError> {
        let timestamp_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| AppError::State(error.to_string()))?
            .as_millis();

        let log_event = LogEvent {
            timestamp_unix_ms,
            level,
            event,
            message,
        };

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;

        serde_json::to_writer(&mut file, &log_event)?;
        file.write_all(b"\n")?;
        Ok(())
    }
}
