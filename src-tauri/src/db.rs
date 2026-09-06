use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::error::AppError;

#[derive(Debug)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn initialize(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let database = Self {
            path: path.as_ref().to_path_buf(),
        };

        let connection = database.connect()?;
        connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            INSERT OR IGNORE INTO schema_meta (key, value)
            VALUES ('schema_version', '1');

            CREATE TABLE IF NOT EXISTS counters (
                name TEXT PRIMARY KEY,
                value INTEGER NOT NULL
            );

            INSERT OR IGNORE INTO counters (name, value)
            VALUES ('m0_write_test', 0);
            ",
        )?;

        Ok(database)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn health_check(&self) -> Result<(), AppError> {
        let connection = self.connect()?;
        let value: i64 = connection.query_row("SELECT 1", [], |row| row.get(0))?;

        if value != 1 {
            return Err(AppError::State(
                "SQLite health check returned an unexpected value".to_string(),
            ));
        }

        Ok(())
    }

    pub fn counter(&self) -> Result<i64, AppError> {
        let connection = self.connect()?;
        let value = connection
            .query_row(
                "SELECT value FROM counters WHERE name = ?1",
                params!["m0_write_test"],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);

        Ok(value)
    }

    pub fn increment_counter(&self) -> Result<i64, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;

        let current = Self::counter_in_transaction(&transaction)?;
        let next = current + 1;

        transaction.execute(
            "
            INSERT INTO counters (name, value)
            VALUES (?1, ?2)
            ON CONFLICT(name) DO UPDATE SET value = excluded.value
            ",
            params!["m0_write_test", next],
        )?;

        transaction.commit()?;
        Ok(next)
    }

    fn counter_in_transaction(transaction: &Transaction<'_>) -> Result<i64, AppError> {
        let value = transaction
            .query_row(
                "SELECT value FROM counters WHERE name = ?1",
                params!["m0_write_test"],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);

        Ok(value)
    }

    fn connect(&self) -> Result<Connection, AppError> {
        let connection = Connection::open(&self.path)?;
        connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        Ok(connection)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::Database;

    #[test]
    fn counter_persists_across_database_reopen() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!(
            "skills-manger-m0-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&test_dir).expect("test directory should be created");
        let database_path = test_dir.join("m0.sqlite3");

        let database = Database::initialize(&database_path).expect("database should initialize");
        assert_eq!(database.counter().expect("counter should read"), 0);
        assert_eq!(
            database.increment_counter().expect("counter should update"),
            1
        );
        drop(database);

        let reopened =
            Database::initialize(&database_path).expect("database should reopen after close");
        assert_eq!(reopened.counter().expect("counter should persist"), 1);

        drop(reopened);
        let _ = fs::remove_dir_all(test_dir);
    }
}
