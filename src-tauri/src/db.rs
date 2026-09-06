use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::{
    error::AppError,
    skills::{SkillDraft, SkillRecord},
};

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

            CREATE TABLE IF NOT EXISTS counters (
                name TEXT PRIMARY KEY,
                value INTEGER NOT NULL
            );

            INSERT OR IGNORE INTO counters (name, value)
            VALUES ('m0_write_test', 0);

            CREATE TABLE IF NOT EXISTS skill_sources (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                locator TEXT NOT NULL,
                UNIQUE(kind, locator)
            );

            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                version TEXT,
                license TEXT,
                compatibility TEXT,
                allowed_tools TEXT,
                metadata_json TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                library_path TEXT NOT NULL,
                script_count INTEGER NOT NULL DEFAULT 0,
                imported_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(source_id) REFERENCES skill_sources(id),
                UNIQUE(source_id, relative_path)
            );

            CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
            CREATE INDEX IF NOT EXISTS idx_skills_updated_at ON skills(updated_at DESC);

            INSERT INTO schema_meta (key, value)
            VALUES ('schema_version', '2')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
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

    pub fn list_skills(&self) -> Result<Vec<SkillRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "
            SELECT
                s.id,
                s.name,
                s.description,
                src.kind,
                src.locator,
                s.version,
                s.license,
                s.compatibility,
                s.allowed_tools,
                s.content_hash,
                s.library_path,
                s.script_count,
                s.imported_at,
                s.updated_at
            FROM skills s
            INNER JOIN skill_sources src ON src.id = s.source_id
            ORDER BY s.updated_at DESC, s.name COLLATE NOCASE ASC
            ",
        )?;

        let rows = statement.query_map([], row_to_skill)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn skill_by_identity(
        &self,
        source_id: &str,
        relative_path: &str,
    ) -> Result<Option<SkillRecord>, AppError> {
        let connection = self.connect()?;
        Ok(connection
            .query_row(
                "
                SELECT
                    s.id,
                    s.name,
                    s.description,
                    src.kind,
                    src.locator,
                    s.version,
                    s.license,
                    s.compatibility,
                    s.allowed_tools,
                    s.content_hash,
                    s.library_path,
                    s.script_count,
                    s.imported_at,
                    s.updated_at
                FROM skills s
                INNER JOIN skill_sources src ON src.id = s.source_id
                WHERE s.source_id = ?1 AND s.relative_path = ?2
                ",
                params![source_id, relative_path],
                row_to_skill,
            )
            .optional()?)
    }

    pub fn upsert_skill(&self, draft: &SkillDraft) -> Result<SkillRecord, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;

        transaction.execute(
            "
            INSERT INTO skill_sources (id, kind, locator)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                locator = excluded.locator
            ",
            params![draft.source_id, draft.source_kind, draft.source_locator],
        )?;

        transaction.execute(
            "
            INSERT INTO skills (
                id, source_id, relative_path, name, description, version,
                license, compatibility, allowed_tools, metadata_json,
                content_hash, library_path, script_count, imported_at, updated_at
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15
            )
            ON CONFLICT(id) DO UPDATE SET
                source_id = excluded.source_id,
                relative_path = excluded.relative_path,
                name = excluded.name,
                description = excluded.description,
                version = excluded.version,
                license = excluded.license,
                compatibility = excluded.compatibility,
                allowed_tools = excluded.allowed_tools,
                metadata_json = excluded.metadata_json,
                content_hash = excluded.content_hash,
                library_path = excluded.library_path,
                script_count = excluded.script_count,
                updated_at = excluded.updated_at
            ",
            params![
                draft.id,
                draft.source_id,
                draft.relative_path,
                draft.name,
                draft.description,
                draft.version,
                draft.license,
                draft.compatibility,
                draft.allowed_tools,
                draft.metadata_json,
                draft.content_hash,
                draft.library_path,
                draft.script_count,
                draft.timestamp,
                draft.timestamp,
            ],
        )?;

        transaction.commit()?;

        self.skill_by_identity(&draft.source_id, &draft.relative_path)?
            .ok_or_else(|| AppError::State("skill upsert completed but record is missing".to_string()))
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

fn row_to_skill(row: &Row<'_>) -> rusqlite::Result<SkillRecord> {
    Ok(SkillRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        source_kind: row.get(3)?,
        source_locator: row.get(4)?,
        version: row.get(5)?,
        license: row.get(6)?,
        compatibility: row.get(7)?,
        allowed_tools: row.get(8)?,
        content_hash: row.get(9)?,
        library_path: row.get(10)?,
        script_count: row.get(11)?,
        imported_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
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
