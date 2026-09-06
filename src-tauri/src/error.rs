use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("YAML parse error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("invalid skill: {0}")]
    InvalidSkill(String),

    #[error("{0}")]
    State(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        let code = match &error {
            AppError::Database(_) => "database_error",
            AppError::Io(_) => "filesystem_error",
            AppError::Serialization(_) => "serialization_error",
            AppError::Yaml(_) => "invalid_skill",
            AppError::InvalidSkill(_) => "invalid_skill",
            AppError::State(_) => "state_error",
        };

        Self {
            code: code.to_string(),
            message: error.to_string(),
        }
    }
}
