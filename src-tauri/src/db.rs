//! Minimal local store for the 发现 → 治理 → 写回 flow.
//!
//! Skills are never copied into a managed library: discovery caches what was
//! found on disk, governance metadata (group / tag / Chinese note) is keyed by
//! the canonical skill path, and write-back records the symlinks we created.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::{
    agent_discovery::{SkillInstanceDraft, SkillInstanceRecord},
    error::AppError,
};

/// One long-lived connection per process.
///
/// Opening a SQLite file is not free: it re-reads the schema, re-applies the
/// pragmas and re-opens the WAL. The first version of this module opened a
/// fresh connection inside every method, so a single scan paid that cost
/// hundreds of times. The connection is kept behind a mutex instead, which
/// also serialises writes so concurrent commands cannot fight over the WAL.
#[derive(Debug)]
pub struct Database {
    path: PathBuf,
    connection: Mutex<Connection>,
}

// ---------------------------------------------------------------- records

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTargetRecord {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub detected: bool,
    /// 强信号：在 PATH 里找到了该 Agent 的可执行文件（真的装了）。
    /// `detected` 只说明默认目录存在 —— 卸载后残留的空目录也会让它是 true。
    pub installed: bool,
    pub executable_path: Option<String>,
    pub last_warning: Option<String>,
    pub last_scanned_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRootRecord {
    pub id: String,
    pub agent_id: String,
    pub scope: String,
    pub configured_path: String,
    pub canonical_path: Option<String>,
    pub enabled: bool,
    pub is_default: bool,
    pub last_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GroupRecord {
    pub id: String,
    pub name: String,
    pub skill_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDraft {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub id: String,
    pub name: String,
    pub is_system: bool,
    pub skill_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDraft {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillNoteRecord {
    pub skill_path: String,
    pub note: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRecord {
    pub id: String,
    pub skill_path: String,
    pub skill_name: String,
    pub target_root_id: String,
    pub target_agent_id: String,
    pub target_root_path: String,
    pub link_path: String,
    pub created_at: i64,
}

// ---------------------------------------------------------------- schema

/// Layout version written into `schema_meta` by [`Database::initialize`].
///
/// Version 1 was produced by the pre-rebuild application generation: it stored an
/// incompatible `agent_targets` shape (extra NOT NULL columns such as
/// `capabilities_json`), keyed `skill_tags` by `skill_id`, and carried a dozen
/// tables for features that no longer exist. Version 1 databases are reset on
/// open: every row they hold is either dead (legacy features) or regenerable.
///
/// Version 3 added `skill_instances.content_signature`, the cheap
/// (path, size, mtime) fingerprint that lets a rescan skip re-hashing files
/// whose bytes cannot have changed. It is added in place so governance data
/// survives the upgrade.
const SCHEMA_VERSION: &str = "4";

/// Tables owned by the current layout, in dependency-safe drop order.
const TABLE_NAMES: &[&str] = &[
    "links",
    "skill_notes",
    "skill_tags",
    "skill_groups",
    "tags",
    "groups",
    "skill_instances",
    "discovery_roots",
    "agent_targets",
];

/// Tables that only ever existed in the pre-rebuild layout.
const LEGACY_TABLE_NAMES: &[&str] = &[
    "apply_operation_items",
    "apply_operations",
    "apply_previous_records",
    "agent_center_records",
    "bundle_items",
    "bundles",
    "counters",
    "deployments",
    "git_sources",
    "skill_sources",
    "skill_tracking",
    "skills",
    "sync_plans",
];

/// Idempotent layout for [`SCHEMA_VERSION`]: safe to run on every start.
const SCHEMA_SQL: &str = "
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_targets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    detected INTEGER NOT NULL DEFAULT 0,
    installed INTEGER NOT NULL DEFAULT 0,
    executable_path TEXT,
    last_warning TEXT,
    last_scanned_at INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_roots (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('user', 'project')),
    configured_path TEXT NOT NULL,
    canonical_path TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    last_warning TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agent_targets(id) ON DELETE CASCADE,
    UNIQUE(agent_id, scope, configured_path)
);

CREATE TABLE IF NOT EXISTS skill_instances (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('user', 'project')),
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    content_signature TEXT,
    script_count INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK(state IN ('unmanaged', 'missing')),
    first_discovered_at INTEGER NOT NULL,
    last_discovered_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agent_targets(id) ON DELETE CASCADE,
    FOREIGN KEY(root_id) REFERENCES discovery_roots(id) ON DELETE CASCADE,
    UNIQUE(agent_id, scope, path)
);

CREATE INDEX IF NOT EXISTS idx_skill_instances_root
ON skill_instances(root_id, state);

-- governance: keyed by canonical skill path, not by a library copy
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_groups (
    skill_path TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_tags (
    skill_path TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY(skill_path, tag_id),
    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skill_tags_tag ON skill_tags(tag_id);

CREATE TABLE IF NOT EXISTS skill_notes (
    skill_path TEXT PRIMARY KEY,
    note TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- write-back: symlinks created by this app
CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    skill_path TEXT NOT NULL,
    target_root_id TEXT NOT NULL,
    link_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(target_root_id) REFERENCES discovery_roots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_path ON links(link_path);

INSERT OR IGNORE INTO tags (id, name, is_system, created_at, updated_at)
VALUES
    ('tag-coding', '编码', 1, 0, 0),
    ('tag-ui', 'UI', 1, 0, 0),
    ('tag-office', '办公', 1, 0, 0),
    ('tag-review', 'Review', 1, 0, 0);
";

/// Bring an existing database up to [`SCHEMA_VERSION`].
///
/// Fresh files contain no tables yet and are left untouched; databases already at
/// [`SCHEMA_VERSION`] keep their rows. Version 1 (the pre-rebuild layout) is
/// dropped and recreated by the `CREATE TABLE IF NOT EXISTS` batch that follows,
/// while later versions are evolved in place so governance metadata survives.
fn migrate(connection: &Connection) -> Result<(), AppError> {
    let tables = table_names(connection)?;
    if tables.is_empty() {
        // Brand-new database file: nothing to migrate.
        return Ok(());
    }

    match stored_schema_version(connection)?.as_deref() {
        Some(SCHEMA_VERSION) => return Ok(()),
        Some("2") => return upgrade_v2_to_v3(connection),
        Some("3") => return upgrade_v3_to_v4(connection),
        Some(_) => {}
        None => {}
    }

    // Foreign keys are re-enabled below; `connect` turns them on for every session.
    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    for name in TABLE_NAMES.iter().chain(LEGACY_TABLE_NAMES) {
        connection.execute(&format!("DROP TABLE IF EXISTS {name}"), [])?;
    }
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(())
}

/// Add the rescan fingerprint column without touching existing rows.
fn upgrade_v2_to_v3(connection: &Connection) -> Result<(), AppError> {
    let columns = column_names(connection, "skill_instances")?;
    if !columns.iter().any(|name| name == "content_signature") {
        connection.execute(
            "ALTER TABLE skill_instances ADD COLUMN content_signature TEXT",
            [],
        )?;
    }
    connection.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SCHEMA_VERSION],
    )?;
    Ok(())
}

/// Split "detected" into two signals: a leftover directory keeps `detected`
/// true, but only a real executable sets `installed`.
fn upgrade_v3_to_v4(connection: &Connection) -> Result<(), AppError> {
    let columns = column_names(connection, "agent_targets")?;
    if !columns.iter().any(|name| name == "installed") {
        connection.execute(
            "ALTER TABLE agent_targets ADD COLUMN installed INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    // 旧库没有可执行文件信息时只能按现有 executable_path 回填：PATH 里真有可执行
    // 文件的行会被下一次 ensure_targets_registered 刷新成 1。
    connection.execute(
        "UPDATE agent_targets SET installed = CASE WHEN executable_path IS NOT NULL THEN 1 ELSE 0 END",
        [],
    )?;
    connection.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SCHEMA_VERSION],
    )?;
    Ok(())
}

fn stored_schema_version(connection: &Connection) -> Result<Option<String>, AppError> {
    if !table_names(connection)?
        .iter()
        .any(|name| name == "schema_meta")
    {
        return Ok(None);
    }
    connection
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AppError::from)
}

fn table_names(connection: &Connection) -> Result<Vec<String>, AppError> {
    let mut statement = connection.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )?;
    let names = statement.query_map([], |row| row.get::<_, String>(0))?;
    names.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

fn column_names(connection: &Connection, table: &str) -> Result<Vec<String>, AppError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement.query_map([], |row| row.get::<_, String>(1))?;
    names.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

impl Database {
    pub fn initialize(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let database = Self::open(path)?;
        {
            let connection = database.lock()?;
            migrate(&connection)?;
            connection.execute_batch(SCHEMA_SQL)?;
            connection.execute(
                "INSERT INTO schema_meta (key, value)
                 VALUES ('schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![SCHEMA_VERSION],
            )?;
        }

        Ok(database)
    }

    /// Open the database file once and keep the connection for the process.
    fn open(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let connection = Connection::open(path.as_ref())?;
        connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -16000;
            PRAGMA busy_timeout = 5000;
            ",
        )?;

        Ok(Self {
            path: path.as_ref().to_path_buf(),
            connection: Mutex::new(connection),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn vault_dir(&self) -> PathBuf {
        self.path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("vault")
    }

    pub fn vault_skills_dir(&self) -> PathBuf {
        self.vault_dir().join("skills")
    }

    pub fn vault_archive_dir(&self) -> PathBuf {
        self.vault_dir().join(".archive")
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.connection.lock().map_err(|_| {
            AppError::State("database connection lock was poisoned by a previous panic".to_string())
        })
    }

    pub fn health_check(&self) -> Result<(), AppError> {
        let connection = self.lock()?;
        let value: i64 = connection.query_row("SELECT 1", [], |row| row.get(0))?;
        if value != 1 {
            return Err(AppError::State(
                "SQLite health check returned an unexpected value".to_string(),
            ));
        }
        Ok(())
    }

    // ------------------------------------------------------ agent targets

    pub fn list_agent_targets(&self) -> Result<Vec<AgentTargetRecord>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, name, provider, detected, installed, executable_path, last_warning, last_scanned_at
             FROM agent_targets ORDER BY name",
        )?;
        let rows = statement.query_map([], map_agent_target)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn upsert_agent_target(
        &self,
        record: &AgentTargetRecord,
        timestamp: i64,
    ) -> Result<AgentTargetRecord, AppError> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO agent_targets
                (id, name, provider, detected, installed, executable_path, last_warning, last_scanned_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                provider = excluded.provider,
                detected = excluded.detected,
                installed = excluded.installed,
                executable_path = excluded.executable_path,
                last_warning = excluded.last_warning,
                last_scanned_at = excluded.last_scanned_at,
                updated_at = excluded.updated_at",
            params![
                record.id,
                record.name,
                record.provider,
                i64::from(record.detected),
                i64::from(record.installed),
                record.executable_path,
                record.last_warning,
                record.last_scanned_at,
                timestamp
            ],
        )?;
        Ok(record.clone())
    }

    // ------------------------------------------------------ discovery roots

    pub fn list_discovery_roots(&self) -> Result<Vec<DiscoveryRootRecord>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, agent_id, scope, configured_path, canonical_path, enabled, is_default, last_warning
             FROM discovery_roots ORDER BY agent_id, scope, configured_path",
        )?;
        let rows = statement.query_map([], map_discovery_root)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn discovery_root(&self, id: &str) -> Result<Option<DiscoveryRootRecord>, AppError> {
        let connection = self.lock()?;
        let record = connection
            .query_row(
                "SELECT id, agent_id, scope, configured_path, canonical_path, enabled, is_default, last_warning
                 FROM discovery_roots WHERE id = ?1",
                params![id],
                map_discovery_root,
            )
            .optional()?;
        Ok(record)
    }

    pub fn upsert_discovery_root(
        &self,
        record: &DiscoveryRootRecord,
        timestamp: i64,
    ) -> Result<DiscoveryRootRecord, AppError> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO discovery_roots
                (id, agent_id, scope, configured_path, canonical_path, enabled, is_default, last_warning, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET
                canonical_path = excluded.canonical_path,
                enabled = excluded.enabled,
                last_warning = excluded.last_warning,
                updated_at = excluded.updated_at",
            params![
                record.id,
                record.agent_id,
                record.scope,
                record.configured_path,
                record.canonical_path,
                i64::from(record.enabled),
                i64::from(record.is_default),
                record.last_warning,
                timestamp
            ],
        )?;
        Ok(record.clone())
    }

    pub fn remove_discovery_root(&self, id: &str) -> Result<(), AppError> {
        let connection = self.lock()?;
        connection.execute("DELETE FROM discovery_roots WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ------------------------------------------------------ skill instances

    pub fn list_skill_instances(&self) -> Result<Vec<SkillInstanceRecord>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, agent_id, root_id, scope, path, name, description, content_hash,
                    script_count, state, first_discovered_at, last_discovered_at
             FROM skill_instances ORDER BY name, path",
        )?;
        let rows = statement.query_map([], map_skill_instance)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn skill_instance_by_path(
        &self,
        path: &str,
    ) -> Result<Option<SkillInstanceRecord>, AppError> {
        let connection = self.lock()?;
        let record = connection
            .query_row(
                "SELECT id, agent_id, root_id, scope, path, name, description, content_hash,
                        script_count, state, first_discovered_at, last_discovered_at
                 FROM skill_instances WHERE path = ?1",
                params![path],
                map_skill_instance,
            )
            .optional()?;
        Ok(record)
    }

    /// `path -> (content_hash, content_signature)` for every cached instance.
    ///
    /// A rescan compares the cheap on-disk fingerprint against the stored
    /// signature and reuses the stored hash when they match, so unchanged
    /// skills are never read byte for byte again.
    pub fn skill_signatures(&self) -> Result<HashMap<String, (String, Option<String>)>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare("SELECT path, content_hash, content_signature FROM skill_instances")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;

        let mut signatures = HashMap::new();
        for entry in rows {
            let (path, hash, signature) = entry?;
            signatures.insert(path, (hash, signature));
        }
        Ok(signatures)
    }

    /// Replace the instance set of one root: new drafts are upserted, drafts that
    /// disappeared are kept as `missing` so the UI can show what went away.
    pub fn reconcile_root_instances(
        &self,
        root_id: &str,
        drafts: &[SkillInstanceDraft],
        timestamp: i64,
    ) -> Result<(), AppError> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;

        let mut sql = String::from(
            "UPDATE skill_instances SET state = 'missing', updated_at = ? WHERE root_id = ?",
        );
        if !drafts.is_empty() {
            sql.push_str(&format!(
                " AND id NOT IN ({})",
                vec!["?"; drafts.len()].join(", ")
            ));
        }
        let mut parameters: Vec<&dyn rusqlite::ToSql> = vec![&timestamp, &root_id];
        parameters.extend(drafts.iter().map(|draft| &draft.id as &dyn rusqlite::ToSql));
        transaction.execute(&sql, parameters.as_slice())?;

        for draft in drafts {
            transaction.execute(
                "INSERT INTO skill_instances
                    (id, agent_id, root_id, scope, path, name, description, content_hash,
                     content_signature, script_count, state, first_discovered_at,
                     last_discovered_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'unmanaged', ?11, ?11, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    content_hash = excluded.content_hash,
                    content_signature = excluded.content_signature,
                    script_count = excluded.script_count,
                    state = 'unmanaged',
                    last_discovered_at = excluded.last_discovered_at,
                    updated_at = excluded.updated_at",
                params![
                    draft.id,
                    draft.agent_id,
                    draft.root_id,
                    draft.scope,
                    draft.path,
                    draft.name,
                    draft.description,
                    draft.content_hash,
                    draft.content_signature,
                    draft.script_count,
                    timestamp
                ],
            )?;
        }

        transaction.commit()?;
        Ok(())
    }

    // ------------------------------------------------------ groups

    pub fn list_groups(&self) -> Result<Vec<GroupRecord>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT g.id, g.name, COUNT(sg.skill_path) AS skill_count
             FROM groups g
             LEFT JOIN skill_groups sg ON sg.group_id = g.id
             GROUP BY g.id, g.name
             ORDER BY g.name",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(GroupRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                skill_count: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn upsert_group(
        &self,
        draft: &GroupDraft,
        timestamp: i64,
    ) -> Result<GroupRecord, AppError> {
        let name = draft.name.trim();
        if name.is_empty() {
            return Err(AppError::State("分组名称不能为空".to_string()));
        }
        let id = draft.id.clone().unwrap_or_else(|| {
            crate::skills::hash_text(&format!("group\0{}", name.to_lowercase()))
        });

        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO groups (id, name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
            params![id, name, timestamp],
        )?;

        Ok(GroupRecord {
            id,
            name: name.to_string(),
            skill_count: 0,
        })
    }

    pub fn delete_group(&self, id: &str) -> Result<(), AppError> {
        let connection = self.lock()?;
        connection.execute("DELETE FROM groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// One skill belongs to at most one group; `None` clears the assignment.
    pub fn set_skill_group(
        &self,
        skill_path: &str,
        group_id: Option<&str>,
        timestamp: i64,
    ) -> Result<(), AppError> {
        let connection = self.lock()?;
        match group_id {
            Some(group_id) => connection.execute(
                "INSERT INTO skill_groups (skill_path, group_id, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(skill_path) DO UPDATE SET group_id = excluded.group_id, updated_at = excluded.updated_at",
                params![skill_path, group_id, timestamp],
            )?,
            None => connection.execute(
                "DELETE FROM skill_groups WHERE skill_path = ?1",
                params![skill_path],
            )?,
        };
        Ok(())
    }

    pub fn skill_group_assignments(&self) -> Result<Vec<(String, String)>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT skill_path, group_id FROM skill_groups")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    // ------------------------------------------------------ tags

    pub fn list_tags(&self) -> Result<Vec<TagRecord>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT t.id, t.name, t.is_system, COUNT(st.skill_path) AS skill_count
             FROM tags t
             LEFT JOIN skill_tags st ON st.tag_id = t.id
             GROUP BY t.id, t.name, t.is_system
             ORDER BY t.is_system DESC, t.name",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(TagRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                is_system: row.get::<_, i64>(2)? != 0,
                skill_count: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn upsert_tag(&self, draft: &TagDraft, timestamp: i64) -> Result<TagRecord, AppError> {
        let name = draft.name.trim();
        if name.is_empty() {
            return Err(AppError::State("标签名称不能为空".to_string()));
        }
        let id = draft
            .id
            .clone()
            .unwrap_or_else(|| crate::skills::hash_text(&format!("tag\0{}", name.to_lowercase())));

        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO tags (id, name, is_system, created_at, updated_at)
             VALUES (?1, ?2, 0, ?3, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
            params![id, name, timestamp],
        )?;

        Ok(TagRecord {
            id,
            name: name.to_string(),
            is_system: false,
            skill_count: 0,
        })
    }

    pub fn delete_tag(&self, id: &str) -> Result<(), AppError> {
        let connection = self.lock()?;
        connection.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_skill_tags(&self, skill_path: &str, tag_ids: &[String]) -> Result<(), AppError> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM skill_tags WHERE skill_path = ?1",
            params![skill_path],
        )?;
        for tag_id in tag_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO skill_tags (skill_path, tag_id) VALUES (?1, ?2)",
                params![skill_path, tag_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn skill_tag_assignments(&self) -> Result<Vec<(String, String)>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT skill_path, tag_id FROM skill_tags")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    // ------------------------------------------------------ notes

    pub fn set_skill_note(
        &self,
        skill_path: &str,
        note: &str,
        timestamp: i64,
    ) -> Result<SkillNoteRecord, AppError> {
        let note = note.trim();
        let connection = self.lock()?;
        if note.is_empty() {
            connection.execute(
                "DELETE FROM skill_notes WHERE skill_path = ?1",
                params![skill_path],
            )?;
        } else {
            connection.execute(
                "INSERT INTO skill_notes (skill_path, note, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(skill_path) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at",
                params![skill_path, note, timestamp],
            )?;
        }
        Ok(SkillNoteRecord {
            skill_path: skill_path.to_string(),
            note: note.to_string(),
            updated_at: timestamp,
        })
    }

    pub fn list_skill_notes(&self) -> Result<Vec<SkillNoteRecord>, AppError> {
        let connection = self.lock()?;
        let mut statement =
            connection.prepare("SELECT skill_path, note, updated_at FROM skill_notes")?;
        let rows = statement.query_map([], |row| {
            Ok(SkillNoteRecord {
                skill_path: row.get(0)?,
                note: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn transfer_governance_metadata(
        &self,
        from_path: &str,
        to_path: &str,
        timestamp: i64,
    ) -> Result<(), AppError> {
        if from_path == to_path {
            return Ok(());
        }
        let connection = self.lock()?;

        let note: Option<String> = connection
            .query_row(
                "SELECT note FROM skill_notes WHERE skill_path = ?1",
                params![from_path],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(note) = note {
            connection.execute(
                "INSERT INTO skill_notes (skill_path, note, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(skill_path) DO NOTHING",
                params![to_path, note, timestamp],
            )?;
        }

        let group_id: Option<String> = connection
            .query_row(
                "SELECT group_id FROM skill_groups WHERE skill_path = ?1",
                params![from_path],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(group_id) = group_id {
            connection.execute(
                "INSERT INTO skill_groups (skill_path, group_id, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(skill_path) DO NOTHING",
                params![to_path, group_id, timestamp],
            )?;
        }

        let mut statement =
            connection.prepare("SELECT tag_id FROM skill_tags WHERE skill_path = ?1")?;
        let tags = statement
            .query_map(params![from_path], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        for tag_id in tags {
            connection.execute(
                "INSERT OR IGNORE INTO skill_tags (skill_path, tag_id) VALUES (?1, ?2)",
                params![to_path, tag_id],
            )?;
        }

        Ok(())
    }

    // ------------------------------------------------------ links (write-back)

    pub fn list_links(&self) -> Result<Vec<LinkRecord>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT l.id, l.skill_path, si.name, l.target_root_id, r.agent_id, r.configured_path,
                    l.link_path, l.created_at
             FROM links l
             JOIN discovery_roots r ON r.id = l.target_root_id
             LEFT JOIN skill_instances si ON si.path = l.skill_path
             ORDER BY l.created_at DESC",
        )?;
        let rows = statement.query_map([], map_link_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn link_by_id(&self, id: &str) -> Result<Option<LinkRecord>, AppError> {
        let connection = self.lock()?;
        let record = connection
            .query_row(
                "SELECT l.id, l.skill_path, si.name, l.target_root_id, r.agent_id, r.configured_path,
                        l.link_path, l.created_at
                 FROM links l
                 JOIN discovery_roots r ON r.id = l.target_root_id
                 LEFT JOIN skill_instances si ON si.path = l.skill_path
                 WHERE l.id = ?1",
                params![id],
                map_link_row,
            )
            .optional()?;
        Ok(record)
    }

    pub fn insert_link(&self, record: &LinkRecord) -> Result<(), AppError> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO links (id, skill_path, target_root_id, link_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET link_path = excluded.link_path",
            params![
                record.id,
                record.skill_path,
                record.target_root_id,
                record.link_path,
                record.created_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_link(&self, id: &str) -> Result<(), AppError> {
        let connection = self.lock()?;
        connection.execute("DELETE FROM links WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Every link path this app created, loaded once per scan instead of one
    /// query per symlink entry found on disk.
    pub fn link_paths(&self) -> Result<HashSet<String>, AppError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT link_path FROM links")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<Result<HashSet<_>, _>>()?)
    }

    #[cfg(test)]
    pub fn link_count(&self) -> Result<i64, AppError> {
        let connection = self.lock()?;
        Ok(connection.query_row("SELECT COUNT(*) FROM links", [], |row| row.get(0))?)
    }
}

// ---------------------------------------------------------------- mappers

fn map_agent_target(row: &Row<'_>) -> rusqlite::Result<AgentTargetRecord> {
    Ok(AgentTargetRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        provider: row.get(2)?,
        detected: row.get::<_, i64>(3)? != 0,
        installed: row.get::<_, i64>(4)? != 0,
        executable_path: row.get(5)?,
        last_warning: row.get(6)?,
        last_scanned_at: row.get(7)?,
    })
}

fn map_discovery_root(row: &Row<'_>) -> rusqlite::Result<DiscoveryRootRecord> {
    Ok(DiscoveryRootRecord {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        scope: row.get(2)?,
        configured_path: row.get(3)?,
        canonical_path: row.get(4)?,
        enabled: row.get::<_, i64>(5)? != 0,
        is_default: row.get::<_, i64>(6)? != 0,
        last_warning: row.get(7)?,
    })
}

pub(crate) fn map_skill_instance(row: &Row<'_>) -> rusqlite::Result<SkillInstanceRecord> {
    Ok(SkillInstanceRecord {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        root_id: row.get(2)?,
        scope: row.get(3)?,
        path: row.get(4)?,
        name: row.get(5)?,
        description: row.get(6)?,
        content_hash: row.get(7)?,
        script_count: row.get(8)?,
        state: row.get(9)?,
        first_discovered_at: row.get(10)?,
        last_discovered_at: row.get(11)?,
    })
}

fn map_link_row(row: &Row<'_>) -> rusqlite::Result<LinkRecord> {
    Ok(LinkRecord {
        id: row.get(0)?,
        skill_path: row.get(1)?,
        skill_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        target_root_id: row.get(3)?,
        target_agent_id: row.get(4)?,
        target_root_path: row.get(5)?,
        link_path: row.get(6)?,
        created_at: row.get(7)?,
    })
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::skills::unix_timestamp;

    use super::*;

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("skills-manger-db-{label}-{nonce}"))
    }

    fn target() -> AgentTargetRecord {
        AgentTargetRecord {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            provider: "Anthropic".to_string(),
            detected: false,
            installed: false,
            executable_path: None,
            last_warning: None,
            last_scanned_at: None,
        }
    }

    fn root(id: &str) -> DiscoveryRootRecord {
        DiscoveryRootRecord {
            id: id.to_string(),
            agent_id: "claude-code".to_string(),
            scope: "project".to_string(),
            configured_path: "C:/projects/demo/.claude/skills".to_string(),
            canonical_path: None,
            enabled: true,
            is_default: false,
            last_warning: None,
        }
    }

    #[test]
    fn pre_rebuild_database_is_reset_to_the_current_layout() {
        let directory = test_root("legacy-migration");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let path = directory.join("skills.sqlite3");

        // Simulate the pre-rebuild layout: schema_version 1, agent_targets with the
        // extra NOT NULL capabilities_json column, skill_tags keyed by skill_id, and
        // legacy feature tables carrying rows.
        {
            let connection = rusqlite::Connection::open(&path).expect("legacy file should open");
            connection
                .execute_batch(
                    "
                    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE agent_targets (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        provider TEXT NOT NULL,
                        capabilities_json TEXT NOT NULL,
                        detected INTEGER NOT NULL,
                        version TEXT,
                        updated_at INTEGER NOT NULL
                    );
                    CREATE TABLE skill_tags (
                        skill_id TEXT NOT NULL,
                        tag_id TEXT NOT NULL,
                        PRIMARY KEY(skill_id, tag_id)
                    );
                    CREATE TABLE bundles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
                    INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1');
                    INSERT INTO agent_targets
                        (id, name, provider, capabilities_json, detected, updated_at)
                        VALUES ('legacy-agent', 'Legacy', 'Old', '[]', 1, 1);
                    INSERT INTO bundles (id, name) VALUES ('b1', 'legacy bundle');
                    ",
                )
                .expect("legacy layout should be created");
        }

        let db = Database::initialize(&path).expect("initialize should reset the legacy database");
        let now = unix_timestamp().expect("clock should be valid");

        // The exact write that crashed the desktop app before this migration.
        db.upsert_agent_target(&target(), now)
            .expect("target should persist on a reset database");

        let connection = db.lock().expect("connection should open");
        assert_eq!(
            stored_schema_version(&connection).expect("version should be readable"),
            Some(SCHEMA_VERSION.to_string()),
            "schema version should be bumped"
        );
        let tables = table_names(&connection).expect("tables should be readable");
        assert!(
            !tables.contains(&"bundles".to_string()),
            "legacy tables should be dropped, got {tables:?}"
        );
        let agent_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(agent_targets)")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("agent_targets columns should be readable");
        assert!(
            !agent_columns.contains(&"capabilities_json".to_string()),
            "agent_targets should be recreated without legacy columns, got {agent_columns:?}"
        );
    }

    #[test]
    fn reinitialize_keeps_current_schema_data() {
        let directory = test_root("reinitialize");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let path = directory.join("skills.sqlite3");

        let db = Database::initialize(&path).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        db.upsert_agent_target(&target(), now)
            .expect("target should persist");
        db.upsert_group(
            &GroupDraft {
                id: None,
                name: "催收工具".to_string(),
            },
            now,
        )
        .expect("group should persist");
        drop(db);

        let db = Database::initialize(&path).expect("re-initialize should succeed");
        let groups = db.list_groups().expect("groups should be listed");
        assert!(
            groups.iter().any(|group| group.name == "催收工具"),
            "governance data must survive re-initialization, got {groups:?}"
        );
        db.upsert_agent_target(&target(), now)
            .expect("target write should still work after re-initialize");
    }

    /// Version 3 only adds a column: upgrading must not cost the user their
    /// groups, tags or notes.
    #[test]
    fn version_two_database_upgrades_in_place_and_keeps_governance() {
        let directory = test_root("upgrade-v2");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let path = directory.join("skills.sqlite3");

        {
            let connection = rusqlite::Connection::open(&path).expect("v2 file should open");
            connection
                .execute_batch(
                    "
                    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE agent_targets (
                        id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
                        detected INTEGER NOT NULL DEFAULT 0, executable_path TEXT,
                        last_warning TEXT, last_scanned_at INTEGER, updated_at INTEGER NOT NULL
                    );
                    CREATE TABLE discovery_roots (
                        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, scope TEXT NOT NULL,
                        configured_path TEXT NOT NULL, canonical_path TEXT,
                        enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0,
                        last_warning TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                    );
                    CREATE TABLE skill_instances (
                        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, root_id TEXT NOT NULL,
                        scope TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL,
                        description TEXT NOT NULL, content_hash TEXT NOT NULL,
                        script_count INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
                        first_discovered_at INTEGER NOT NULL, last_discovered_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );
                    CREATE TABLE groups (
                        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                    );
                    INSERT INTO schema_meta (key, value) VALUES ('schema_version', '2');
                    INSERT INTO groups (id, name, created_at, updated_at)
                    VALUES ('g1', '催收工具', 1, 1);
                    ",
                )
                .expect("v2 layout should be created");
        }

        let db = Database::initialize(&path).expect("upgrade should succeed");

        // The connection lock is not reentrant: drop it before calling back
        // into `db`, or the second lock waits forever.
        {
            let connection = db.lock().expect("connection should open");
            assert_eq!(
                stored_schema_version(&connection).expect("version should be readable"),
                Some(SCHEMA_VERSION.to_string())
            );
            assert!(
                column_names(&connection, "skill_instances")
                    .expect("columns should be readable")
                    .contains(&"content_signature".to_string()),
                "the fingerprint column should be added in place"
            );
        }

        assert!(
            db.list_groups()
                .expect("groups should list")
                .iter()
                .any(|group| group.name == "催收工具"),
            "governance data must survive the upgrade"
        );

        drop(db);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn governance_round_trip_and_cascade() {
        let directory = test_root("governance");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let db = Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        db.upsert_agent_target(&target(), now)
            .expect("target should persist");

        let group = db
            .upsert_group(
                &GroupDraft {
                    id: None,
                    name: "催收工具".to_string(),
                },
                now,
            )
            .expect("group should persist");
        assert_eq!(db.list_groups().expect("groups should list").len(), 1);

        let skill_path = "C:/projects/demo/.claude/skills/demo-skill";
        db.set_skill_group(skill_path, Some(&group.id), now)
            .expect("group assignment should persist");
        let assignments = db
            .skill_group_assignments()
            .expect("assignments should list");
        assert_eq!(
            assignments,
            vec![(skill_path.to_string(), group.id.clone())]
        );
        assert_eq!(
            db.list_groups().expect("groups should list")[0].skill_count,
            1
        );

        db.set_skill_tags(
            skill_path,
            &["tag-coding".to_string(), "tag-ui".to_string()],
        )
        .expect("tags should persist");
        let tags = db.list_tags().expect("tags should list");
        assert_eq!(tags.len(), 4);
        assert_eq!(
            tags.iter()
                .find(|tag| tag.id == "tag-coding")
                .map(|tag| tag.skill_count),
            Some(1)
        );

        db.set_skill_note(skill_path, "用于演示的最小 Skill", now)
            .expect("note should persist");
        assert_eq!(
            db.list_skill_notes().expect("notes should list")[0].note,
            "用于演示的最小 Skill"
        );

        db.set_skill_group(skill_path, None, now)
            .expect("group should clear");
        db.delete_group(&group.id).expect("group should delete");
        assert!(db.list_groups().expect("groups should list").is_empty());

        drop(db);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn reconcile_marks_disappeared_instances_missing() {
        let directory = test_root("reconcile");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let db = Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        db.upsert_agent_target(&target(), now)
            .expect("target should persist");
        let record = db
            .upsert_discovery_root(&root("root-1"), now)
            .expect("root should persist");

        let draft = SkillInstanceDraft {
            id: "instance-1".to_string(),
            agent_id: "claude-code".to_string(),
            root_id: record.id.clone(),
            scope: "project".to_string(),
            path: "C:/projects/demo/.claude/skills/demo-skill".to_string(),
            name: "demo-skill".to_string(),
            description: "Demo.".to_string(),
            content_hash: "abc".to_string(),
            content_signature: "fingerprint".to_string(),
            script_count: 0,
        };
        db.reconcile_root_instances(&record.id, std::slice::from_ref(&draft), now)
            .expect("first reconcile should work");
        assert_eq!(
            db.list_skill_instances().expect("instances should list")[0].state,
            "unmanaged"
        );

        db.reconcile_root_instances(&record.id, &[], now + 1)
            .expect("empty reconcile should work");
        let instances = db.list_skill_instances().expect("instances should list");
        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].state, "missing");
        assert_eq!(instances[0].first_discovered_at, now);
        assert_eq!(instances[0].last_discovered_at, now);

        drop(db);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn removing_root_cascades_to_instances_and_links() {
        let directory = test_root("cascade");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let db = Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        db.upsert_agent_target(&target(), now)
            .expect("target should persist");
        let record = db
            .upsert_discovery_root(&root("root-1"), now)
            .expect("root should persist");

        let draft = SkillInstanceDraft {
            id: "instance-1".to_string(),
            agent_id: "claude-code".to_string(),
            root_id: record.id.clone(),
            scope: "project".to_string(),
            path: "C:/projects/demo/.claude/skills/demo-skill".to_string(),
            name: "demo-skill".to_string(),
            description: "Demo.".to_string(),
            content_hash: "abc".to_string(),
            content_signature: "fingerprint".to_string(),
            script_count: 0,
        };
        db.reconcile_root_instances(&record.id, std::slice::from_ref(&draft), now)
            .expect("reconcile should work");

        db.insert_link(&LinkRecord {
            id: "link-1".to_string(),
            skill_path: draft.path.clone(),
            skill_name: draft.name.clone(),
            target_root_id: record.id.clone(),
            target_agent_id: "claude-code".to_string(),
            target_root_path: record.configured_path.clone(),
            link_path: "C:/projects/demo/.claude/skills/demo-skill".to_string(),
            created_at: now,
        })
        .expect("link should persist");

        db.remove_discovery_root(&record.id)
            .expect("root should delete");
        assert!(db
            .list_skill_instances()
            .expect("instances should list")
            .is_empty());
        assert_eq!(db.link_count().expect("links should count"), 0);

        drop(db);
        let _ = fs::remove_dir_all(directory);
    }
}
