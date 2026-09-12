use std::path::{Path, PathBuf};

use rusqlite::{params, types::Type, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use crate::{
    agent_discovery::{
        AgentTargetRecord, DiscoveryRootRecord, SkillInstanceDraft, SkillInstanceRecord,
    },
    bundle_planner::{
        new_bundle_id, validate_bundle_draft, BundleDraft, BundleItemRecord, BundleRecord,
    },
    error::AppError,
    skills::{SkillDraft, SkillRecord},
};

#[derive(Debug)]
pub struct Database {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub id: String,
    pub name: String,
    pub is_system: bool,
    pub skill_count: i64,
    pub skill_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDraft {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAssignment {
    pub skill_id: String,
    pub tag_ids: Vec<String>,
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

            CREATE TABLE IF NOT EXISTS agent_center_records (
                kind TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL,
                PRIMARY KEY(kind,id));

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

            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                is_system INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS skill_tags (
                skill_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                PRIMARY KEY(skill_id, tag_id),
                FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE,
                FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_skill_tags_tag ON skill_tags(tag_id);

            CREATE TABLE IF NOT EXISTS agent_targets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                capabilities_json TEXT NOT NULL,
                detected INTEGER NOT NULL DEFAULT 0,
                executable_path TEXT,
                version TEXT,
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

            CREATE INDEX IF NOT EXISTS idx_skill_instances_name
            ON skill_instances(name);

            CREATE TABLE IF NOT EXISTS bundles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                description TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bundle_items (
                bundle_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                mode TEXT NOT NULL CHECK(mode IN ('required', 'optional')),
                position INTEGER NOT NULL,
                PRIMARY KEY(bundle_id, skill_id),
                UNIQUE(bundle_id, position),
                FOREIGN KEY(bundle_id) REFERENCES bundles(id) ON DELETE CASCADE,
                FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS sync_plans (
                id TEXT PRIMARY KEY,
                bundle_id TEXT NOT NULL,
                root_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('previewed', 'running', 'applied', 'stale', 'failed')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(bundle_id) REFERENCES bundles(id) ON DELETE CASCADE,
                FOREIGN KEY(root_id) REFERENCES discovery_roots(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS deployments (
                id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL,
                root_id TEXT NOT NULL,
                destination_path TEXT NOT NULL,
                deployed_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(skill_id, root_id),
                UNIQUE(root_id, destination_path),
                FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE RESTRICT,
                FOREIGN KEY(root_id) REFERENCES discovery_roots(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS apply_operations (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'rolled_back', 'rollback_failed')),
                error TEXT,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                FOREIGN KEY(plan_id) REFERENCES sync_plans(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS apply_operation_items (
                operation_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                action TEXT NOT NULL CHECK(action IN ('add', 'update')),
                destination_path TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'applied', 'rolled_back', 'failed')),
                snapshot_path TEXT,
                deployed_hash TEXT,
                error TEXT,
                position INTEGER NOT NULL,
                PRIMARY KEY(operation_id, skill_id),
                UNIQUE(operation_id, position),
                FOREIGN KEY(operation_id) REFERENCES apply_operations(id) ON DELETE CASCADE,
                FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS apply_previous_records (
                operation_id TEXT NOT NULL, skill_id TEXT NOT NULL, payload_json TEXT NOT NULL,
                PRIMARY KEY(operation_id,skill_id));

            CREATE TABLE IF NOT EXISTS git_sources (
                id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL UNIQUE,
                url TEXT NOT NULL,
                reference TEXT NOT NULL,
                skill_subpath TEXT NOT NULL,
                checkout_path TEXT NOT NULL UNIQUE,
                last_fetched_revision TEXT NOT NULL,
                last_checked_at INTEGER NOT NULL,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE,
                UNIQUE(url, reference, skill_subpath)
            );

            CREATE TABLE IF NOT EXISTS skill_tracking (
                skill_id TEXT PRIMARY KEY,
                git_source_id TEXT NOT NULL UNIQUE,
                base_hash TEXT NOT NULL,
                base_revision TEXT NOT NULL,
                upstream_hash TEXT NOT NULL,
                upstream_revision TEXT NOT NULL,
                checked_at INTEGER NOT NULL,
                FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE,
                FOREIGN KEY(git_source_id) REFERENCES git_sources(id) ON DELETE CASCADE
            );

            INSERT INTO schema_meta (key, value)
            VALUES ('schema_version', '7')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;

            INSERT OR IGNORE INTO tags (id, name, is_system, created_at, updated_at)
            VALUES
                ('tag-coding', '编码', 1, 0, 0),
                ('tag-ui', 'UI', 1, 0, 0),
                ('tag-office', '办公', 1, 0, 0),
                ('tag-review', 'Review', 1, 0, 0);
            ",
        )?;

        let has_selection_plans: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_meta WHERE key='selection_plan_version')",
            [],
            |r| r.get(0),
        )?;
        if !has_selection_plans {
            // Direct skill selections have no Bundle owner. Keep plan IDs and operation references.
            connection.execute_batch(
                "PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
                CREATE TABLE sync_plans_next (
                    id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, root_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL, status TEXT NOT NULL,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                    FOREIGN KEY(root_id) REFERENCES discovery_roots(id) ON DELETE CASCADE);
                INSERT INTO sync_plans_next SELECT * FROM sync_plans;
                DROP TABLE sync_plans;
                ALTER TABLE sync_plans_next RENAME TO sync_plans;
                INSERT INTO schema_meta(key,value) VALUES ('selection_plan_version','1');
                COMMIT; PRAGMA foreign_keys=ON;",
            )?;
        }
        let location_version: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_meta WHERE key='deployment_location_version')",
            [],
            |r| r.get(0),
        )?;
        if !location_version {
            connection.execute_batch("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
                CREATE TABLE deployments_next (
                  id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,root_id TEXT NOT NULL,destination_path TEXT NOT NULL,
                  deployed_hash TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
                  UNIQUE(root_id,destination_path),FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE RESTRICT,
                  FOREIGN KEY(root_id) REFERENCES discovery_roots(id) ON DELETE CASCADE);
                INSERT INTO deployments_next SELECT * FROM deployments;
                CREATE TABLE apply_operation_items_next (
                  operation_id TEXT NOT NULL,skill_id TEXT NOT NULL,action TEXT NOT NULL,destination_path TEXT NOT NULL,
                  status TEXT NOT NULL,snapshot_path TEXT,deployed_hash TEXT,error TEXT,position INTEGER NOT NULL,
                  PRIMARY KEY(operation_id,position),FOREIGN KEY(operation_id) REFERENCES apply_operations(id) ON DELETE CASCADE,
                  FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE RESTRICT);
                INSERT INTO apply_operation_items_next SELECT * FROM apply_operation_items;
                CREATE TABLE apply_previous_records_next(operation_id TEXT NOT NULL,skill_id TEXT NOT NULL,position INTEGER NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(operation_id,position));
                INSERT INTO apply_previous_records_next SELECT p.operation_id,p.skill_id,i.position,p.payload_json FROM apply_previous_records p JOIN apply_operation_items i ON p.operation_id=i.operation_id AND p.skill_id=i.skill_id;
                DROP TABLE deployments; ALTER TABLE deployments_next RENAME TO deployments;
                DROP TABLE apply_operation_items; ALTER TABLE apply_operation_items_next RENAME TO apply_operation_items;
                DROP TABLE apply_previous_records; ALTER TABLE apply_previous_records_next RENAME TO apply_previous_records;
                INSERT INTO schema_meta(key,value) VALUES ('deployment_location_version','1');
                COMMIT; PRAGMA foreign_keys=ON;")?;
        }
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

    #[cfg(test)]
    pub fn schema_version(&self) -> Result<String, AppError> {
        let connection = self.connect()?;
        Ok(connection.query_row(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn upsert_agent_target(
        &self,
        record: &AgentTargetRecord,
        timestamp: i64,
    ) -> Result<AgentTargetRecord, AppError> {
        let connection = self.connect()?;
        let capabilities_json = serde_json::to_string(&record.capabilities)?;
        connection.execute(
            "
            INSERT INTO agent_targets (
                id, name, provider, capabilities_json, detected,
                executable_path, version, last_warning, last_scanned_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                provider = excluded.provider,
                capabilities_json = excluded.capabilities_json,
                detected = excluded.detected,
                executable_path = excluded.executable_path,
                version = excluded.version,
                last_warning = excluded.last_warning,
                last_scanned_at = excluded.last_scanned_at,
                updated_at = excluded.updated_at
            ",
            params![
                record.id,
                record.name,
                record.provider,
                capabilities_json,
                record.detected,
                record.executable_path,
                record.version,
                record.last_warning,
                record.last_scanned_at,
                timestamp,
            ],
        )?;

        self.agent_target_by_id(&record.id)?.ok_or_else(|| {
            AppError::State("agent target upsert completed but record is missing".to_string())
        })
    }

    pub fn list_agent_targets(&self) -> Result<Vec<AgentTargetRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "
            SELECT id, name, provider, capabilities_json, detected,
                   executable_path, version, last_warning, last_scanned_at
            FROM agent_targets
            ORDER BY name COLLATE NOCASE ASC
            ",
        )?;
        let rows = statement.query_map([], row_to_agent_target)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn upsert_discovery_root(
        &self,
        record: &DiscoveryRootRecord,
        timestamp: i64,
    ) -> Result<DiscoveryRootRecord, AppError> {
        let connection = self.connect()?;
        connection.execute(
            "
            INSERT INTO discovery_roots (
                id, agent_id, scope, configured_path, canonical_path,
                enabled, is_default, last_warning, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                agent_id = excluded.agent_id,
                scope = excluded.scope,
                configured_path = excluded.configured_path,
                canonical_path = excluded.canonical_path,
                enabled = excluded.enabled,
                is_default = excluded.is_default,
                last_warning = excluded.last_warning,
                updated_at = excluded.updated_at
            ",
            params![
                record.id,
                record.agent_id,
                record.scope,
                record.configured_path,
                record.canonical_path,
                record.enabled,
                record.is_default,
                record.last_warning,
                timestamp,
                timestamp,
            ],
        )?;

        self.discovery_root_by_id(&record.id)?.ok_or_else(|| {
            AppError::State("discovery root upsert completed but record is missing".to_string())
        })
    }

    pub fn list_discovery_roots(&self) -> Result<Vec<DiscoveryRootRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "
            SELECT id, agent_id, scope, configured_path, canonical_path,
                   enabled, is_default, last_warning
            FROM discovery_roots
            ORDER BY is_default DESC, scope ASC, configured_path COLLATE NOCASE ASC
            ",
        )?;
        let rows = statement.query_map([], row_to_discovery_root)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn remove_discovery_root(&self, id: &str) -> Result<(), AppError> {
        let connection = self.connect()?;
        connection.execute(
            "DELETE FROM discovery_roots WHERE id = ?1 AND is_default = 0",
            params![id],
        )?;
        Ok(())
    }

    pub fn list_skill_instances(&self) -> Result<Vec<SkillInstanceRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "
            SELECT id, agent_id, root_id, scope, path, name, description,
                   content_hash, script_count, state,
                   first_discovered_at, last_discovered_at
            FROM skill_instances
            ORDER BY state ASC, name COLLATE NOCASE ASC, path COLLATE NOCASE ASC
            ",
        )?;
        let rows = statement.query_map([], row_to_skill_instance)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn reconcile_root_instances(
        &self,
        root_id: &str,
        instances: &[SkillInstanceDraft],
        timestamp: i64,
    ) -> Result<(), AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE skill_instances SET state = 'missing', updated_at = ?2 WHERE root_id = ?1",
            params![root_id, timestamp],
        )?;

        for instance in instances {
            transaction.execute(
                "
                INSERT INTO skill_instances (
                    id, agent_id, root_id, scope, path, name, description,
                    content_hash, script_count, state,
                    first_discovered_at, last_discovered_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                        'unmanaged', ?10, ?10, ?10)
                ON CONFLICT(id) DO UPDATE SET
                    agent_id = excluded.agent_id,
                    root_id = excluded.root_id,
                    scope = excluded.scope,
                    path = excluded.path,
                    name = excluded.name,
                    description = excluded.description,
                    content_hash = excluded.content_hash,
                    script_count = excluded.script_count,
                    state = 'unmanaged',
                    last_discovered_at = excluded.last_discovered_at,
                    updated_at = excluded.updated_at
                ",
                params![
                    instance.id,
                    instance.agent_id,
                    instance.root_id,
                    instance.scope,
                    instance.path,
                    instance.name,
                    instance.description,
                    instance.content_hash,
                    instance.script_count,
                    timestamp,
                ],
            )?;
        }

        transaction.commit()?;
        Ok(())
    }

    pub fn list_bundles(&self) -> Result<Vec<BundleRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id, name, description, created_at, updated_at
             FROM bundles ORDER BY updated_at DESC, name ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        let headers = rows.collect::<Result<Vec<_>, _>>()?;
        let mut bundles = Vec::with_capacity(headers.len());
        for (id, name, description, created_at, updated_at) in headers {
            bundles.push(BundleRecord {
                items: Self::bundle_items(&connection, &id)?,
                id,
                name,
                description,
                created_at,
                updated_at,
            });
        }
        Ok(bundles)
    }

    pub fn upsert_bundle(
        &self,
        draft: &BundleDraft,
        timestamp: i64,
    ) -> Result<BundleRecord, AppError> {
        validate_bundle_draft(draft)?;
        let id = draft
            .id
            .clone()
            .unwrap_or_else(|| new_bundle_id(&draft.name, timestamp));
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;

        for item in &draft.items {
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM skills WHERE id = ?1)",
                params![item.skill_id],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(AppError::State(format!(
                    "Library Skill was not found: {}",
                    item.skill_id
                )));
            }
        }

        transaction.execute(
            "INSERT INTO bundles (id, name, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 description = excluded.description,
                 updated_at = excluded.updated_at",
            params![id, draft.name.trim(), draft.description.trim(), timestamp],
        )?;
        transaction.execute("DELETE FROM bundle_items WHERE bundle_id = ?1", params![id])?;
        for (position, item) in draft.items.iter().enumerate() {
            transaction.execute(
                "INSERT INTO bundle_items (bundle_id, skill_id, mode, position)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, item.skill_id, item.mode, position as i64],
            )?;
        }
        transaction.commit()?;

        self.bundle_by_id(&id)?.ok_or_else(|| {
            AppError::State("bundle upsert completed but record is missing".to_string())
        })
    }

    pub fn delete_bundle(&self, id: &str) -> Result<(), AppError> {
        let connection = self.connect()?;
        let changed = connection.execute("DELETE FROM bundles WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(AppError::State("bundle was not found".to_string()));
        }
        Ok(())
    }

    pub fn list_tags(&self) -> Result<Vec<TagRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT t.id, t.name, t.is_system, COUNT(st.skill_id)
             FROM tags t LEFT JOIN skill_tags st ON st.tag_id = t.id
             GROUP BY t.id, t.name, t.is_system
             ORDER BY t.is_system DESC, t.name COLLATE NOCASE ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, i64>(3)?,
            ))
        })?;
        let headers = rows.collect::<Result<Vec<_>, _>>()?;
        headers
            .into_iter()
            .map(|(id, name, is_system, skill_count)| {
                let mut links = connection.prepare(
                    "SELECT skill_id FROM skill_tags WHERE tag_id = ?1 ORDER BY skill_id",
                )?;
                let skill_ids = links
                    .query_map(params![id], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(TagRecord {
                    id,
                    name,
                    is_system,
                    skill_count,
                    skill_ids,
                })
            })
            .collect()
    }

    pub fn upsert_tag(&self, draft: &TagDraft, timestamp: i64) -> Result<TagRecord, AppError> {
        let name = draft.name.trim();
        if name.is_empty() || name.chars().count() > 32 {
            return Err(AppError::State(
                "标签名称不能为空且不能超过 32 个字符".to_string(),
            ));
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        if let Some(id) = &draft.id {
            let is_system: Option<bool> = transaction
                .query_row(
                    "SELECT is_system != 0 FROM tags WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()?;
            match is_system {
                Some(true) => return Err(AppError::State("系统标签不可重命名".to_string())),
                None => return Err(AppError::State("标签不存在".to_string())),
                Some(false) => {
                    transaction.execute(
                        "UPDATE tags SET name = ?1, updated_at = ?2 WHERE id = ?3",
                        params![name, timestamp, id],
                    )?;
                }
            }
        } else {
            let mut id = format!("tag-custom-{timestamp}");
            let mut suffix = 1;
            while transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM tags WHERE id = ?1)",
                params![id],
                |row| row.get::<_, bool>(0),
            )? {
                id = format!("tag-custom-{timestamp}-{suffix}");
                suffix += 1;
            }
            transaction.execute(
                "INSERT INTO tags (id, name, is_system, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)",
                params![id, name, timestamp],
            )?;
        }
        transaction.commit()?;
        self.list_tags()?
            .into_iter()
            .find(|tag| tag.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| AppError::State("标签保存后未找到记录".to_string()))
    }

    pub fn delete_tag(&self, id: &str) -> Result<(), AppError> {
        let connection = self.connect()?;
        let is_system: Option<bool> = connection
            .query_row(
                "SELECT is_system != 0 FROM tags WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        match is_system {
            Some(true) => Err(AppError::State("系统标签不可删除".to_string())),
            None => Err(AppError::State("标签不存在".to_string())),
            Some(false) => {
                connection.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
                Ok(())
            }
        }
    }

    pub fn set_skill_tag_assignments(&self, assignments: &[TagAssignment]) -> Result<(), AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let mut seen_skills = std::collections::HashSet::new();
        let mut valid_tags = std::collections::HashSet::new();
        for assignment in assignments {
            if !seen_skills.insert(assignment.skill_id.clone()) {
                return Err(AppError::State(
                    "同一批次不能重复提交同一个 Skill".to_string(),
                ));
            }
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM skills WHERE id = ?1)",
                params![assignment.skill_id],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(AppError::State(format!(
                    "Library Skill was not found: {}",
                    assignment.skill_id
                )));
            }
            for tag_id in &assignment.tag_ids {
                if valid_tags.contains(tag_id) {
                    continue;
                }
                let tag_exists: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM tags WHERE id = ?1)",
                    params![tag_id],
                    |row| row.get(0),
                )?;
                if !tag_exists {
                    return Err(AppError::State(format!("标签不存在: {tag_id}")));
                }
                valid_tags.insert(tag_id.clone());
            }
        }
        for assignment in assignments {
            transaction.execute(
                "DELETE FROM skill_tags WHERE skill_id = ?1",
                params![assignment.skill_id],
            )?;
            for tag_id in &assignment.tag_ids {
                transaction.execute(
                    "INSERT OR IGNORE INTO skill_tags (skill_id, tag_id) VALUES (?1, ?2)",
                    params![assignment.skill_id, tag_id],
                )?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn set_skill_tags(&self, skill_ids: &[String], tag_ids: &[String]) -> Result<(), AppError> {
        let assignments = skill_ids
            .iter()
            .map(|skill_id| TagAssignment {
                skill_id: skill_id.clone(),
                tag_ids: tag_ids.to_vec(),
            })
            .collect::<Vec<_>>();
        self.set_skill_tag_assignments(&assignments)
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
            .ok_or_else(|| {
                AppError::State("skill upsert completed but record is missing".to_string())
            })
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

    pub(crate) fn connect(&self) -> Result<Connection, AppError> {
        let connection = Connection::open(&self.path)?;
        connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        Ok(connection)
    }

    fn agent_target_by_id(&self, id: &str) -> Result<Option<AgentTargetRecord>, AppError> {
        let connection = self.connect()?;
        Ok(connection
            .query_row(
                "
                SELECT id, name, provider, capabilities_json, detected,
                       executable_path, version, last_warning, last_scanned_at
                FROM agent_targets
                WHERE id = ?1
                ",
                params![id],
                row_to_agent_target,
            )
            .optional()?)
    }

    fn discovery_root_by_id(&self, id: &str) -> Result<Option<DiscoveryRootRecord>, AppError> {
        let connection = self.connect()?;
        Ok(connection
            .query_row(
                "
                SELECT id, agent_id, scope, configured_path, canonical_path,
                       enabled, is_default, last_warning
                FROM discovery_roots
                WHERE id = ?1
                ",
                params![id],
                row_to_discovery_root,
            )
            .optional()?)
    }

    fn bundle_by_id(&self, id: &str) -> Result<Option<BundleRecord>, AppError> {
        let connection = self.connect()?;
        let header = connection
            .query_row(
                "SELECT id, name, description, created_at, updated_at FROM bundles WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;
        match header {
            Some((id, name, description, created_at, updated_at)) => Ok(Some(BundleRecord {
                items: Self::bundle_items(&connection, &id)?,
                id,
                name,
                description,
                created_at,
                updated_at,
            })),
            None => Ok(None),
        }
    }

    fn bundle_items(
        connection: &Connection,
        bundle_id: &str,
    ) -> Result<Vec<BundleItemRecord>, AppError> {
        let mut statement = connection.prepare(
            "SELECT skill_id, mode, position FROM bundle_items
             WHERE bundle_id = ?1 ORDER BY position ASC",
        )?;
        let rows = statement.query_map(params![bundle_id], |row| {
            Ok(BundleItemRecord {
                skill_id: row.get(0)?,
                mode: row.get(1)?,
                position: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
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

fn row_to_agent_target(row: &Row<'_>) -> rusqlite::Result<AgentTargetRecord> {
    let capabilities_json: String = row.get(3)?;
    let capabilities = serde_json::from_str(&capabilities_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, Type::Text, Box::new(error))
    })?;

    Ok(AgentTargetRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        provider: row.get(2)?,
        capabilities,
        detected: row.get(4)?,
        executable_path: row.get(5)?,
        version: row.get(6)?,
        last_warning: row.get(7)?,
        last_scanned_at: row.get(8)?,
    })
}

fn row_to_discovery_root(row: &Row<'_>) -> rusqlite::Result<DiscoveryRootRecord> {
    Ok(DiscoveryRootRecord {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        scope: row.get(2)?,
        configured_path: row.get(3)?,
        canonical_path: row.get(4)?,
        enabled: row.get(5)?,
        is_default: row.get(6)?,
        last_warning: row.get(7)?,
    })
}

fn row_to_skill_instance(row: &Row<'_>) -> rusqlite::Result<SkillInstanceRecord> {
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::agent_discovery::{AgentTargetRecord, DiscoveryRootRecord, SkillInstanceDraft};
    use crate::bundle_planner::{BundleDraft, BundleItemDraft};
    use crate::skills::SkillDraft;

    use super::{Database, TagDraft};

    #[test]
    fn counter_persists_across_database_reopen() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let test_dir =
            std::env::temp_dir().join(format!("skills-manger-m0-{}-{nonce}", std::process::id()));
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

    #[test]
    fn discovery_records_persist_across_database_reopen() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!(
            "skills-manger-m3-db-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&test_dir).expect("test directory should be created");
        let database_path = test_dir.join("m3.sqlite3");
        let timestamp = 1_788_777_600;

        let database = Database::initialize(&database_path).expect("database should initialize");
        let target = AgentTargetRecord {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            provider: "Anthropic".to_string(),
            capabilities: vec!["detect".to_string()],
            detected: true,
            executable_path: Some("C:/tools/claude.exe".to_string()),
            version: None,
            last_warning: None,
            last_scanned_at: Some(timestamp),
        };
        database
            .upsert_agent_target(&target, timestamp)
            .expect("target should persist");

        let root = DiscoveryRootRecord {
            id: "root-1".to_string(),
            agent_id: target.id.clone(),
            scope: "project".to_string(),
            configured_path: "C:/repo/.claude/skills".to_string(),
            canonical_path: Some("C:/repo/.claude/skills".to_string()),
            enabled: true,
            is_default: false,
            last_warning: None,
        };
        database
            .upsert_discovery_root(&root, timestamp)
            .expect("root should persist");

        database
            .reconcile_root_instances(
                &root.id,
                &[SkillInstanceDraft {
                    id: "instance-1".to_string(),
                    agent_id: target.id.clone(),
                    root_id: root.id.clone(),
                    scope: root.scope.clone(),
                    path: "C:/repo/.claude/skills/demo-skill".to_string(),
                    name: "demo-skill".to_string(),
                    description: "Persisted discovery fixture.".to_string(),
                    content_hash: "abc123".to_string(),
                    script_count: 0,
                }],
                timestamp,
            )
            .expect("instances should reconcile");
        drop(database);

        let reopened =
            Database::initialize(&database_path).expect("database should reopen after close");
        assert_eq!(
            reopened
                .schema_version()
                .expect("schema version should read"),
            "7"
        );
        assert_eq!(
            reopened.list_agent_targets().expect("targets should list"),
            vec![target]
        );
        assert_eq!(
            reopened.list_discovery_roots().expect("roots should list"),
            vec![root]
        );
        let instances = reopened
            .list_skill_instances()
            .expect("instances should list");
        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].id, "instance-1");
        assert_eq!(instances[0].state, "unmanaged");
        assert_eq!(instances[0].first_discovered_at, timestamp);
        assert_eq!(instances[0].last_discovered_at, timestamp);

        drop(reopened);
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn bundle_records_replace_items_transactionally_and_persist() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!(
            "skills-manger-m4-db-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&test_dir).expect("test directory should exist");
        let database_path = test_dir.join("m4.sqlite3");
        let database = Database::initialize(&database_path).expect("database should initialize");
        for id in ["skill-a", "skill-b"] {
            database
                .upsert_skill(&SkillDraft {
                    id: id.to_string(),
                    source_id: format!("source-{id}"),
                    source_kind: "local".to_string(),
                    source_locator: format!("C:/fixtures/{id}"),
                    relative_path: ".".to_string(),
                    name: id.to_string(),
                    description: "Fixture".to_string(),
                    version: None,
                    license: None,
                    compatibility: None,
                    allowed_tools: None,
                    metadata_json: "{}".to_string(),
                    content_hash: format!("hash-{id}"),
                    library_path: format!("C:/library/{id}"),
                    script_count: 0,
                    timestamp: 10,
                })
                .expect("skill should persist");
        }
        let created = database
            .upsert_bundle(
                &BundleDraft {
                    id: None,
                    name: "Development".to_string(),
                    description: "Fixture bundle".to_string(),
                    items: vec![BundleItemDraft {
                        skill_id: "skill-a".to_string(),
                        mode: "required".to_string(),
                    }],
                },
                20,
            )
            .expect("bundle should persist");
        database
            .upsert_bundle(
                &BundleDraft {
                    id: Some(created.id.clone()),
                    name: created.name.clone(),
                    description: "Updated fixture".to_string(),
                    items: vec![BundleItemDraft {
                        skill_id: "skill-b".to_string(),
                        mode: "optional".to_string(),
                    }],
                },
                30,
            )
            .expect("bundle should update");
        drop(database);

        let reopened = Database::initialize(&database_path).expect("database should reopen");
        let bundles = reopened.list_bundles().expect("bundles should list");
        assert_eq!(bundles.len(), 1);
        assert_eq!(bundles[0].id, created.id);
        assert_eq!(bundles[0].description, "Updated fixture");
        assert_eq!(bundles[0].items.len(), 1);
        assert_eq!(bundles[0].items[0].skill_id, "skill-b");
        assert_eq!(bundles[0].items[0].mode, "optional");
        assert_eq!(bundles[0].created_at, 20);
        assert_eq!(bundles[0].updated_at, 30);

        drop(reopened);
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn tags_are_seeded_persisted_and_system_tags_are_protected() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!("skills-manger-tags-{nonce}"));
        fs::create_dir_all(&test_dir).unwrap();
        let database = Database::initialize(test_dir.join("tags.sqlite3")).unwrap();
        let names: Vec<_> = database
            .list_tags()
            .unwrap()
            .into_iter()
            .map(|tag| tag.name)
            .collect();
        assert_eq!(names, vec!["Review", "UI", "办公", "编码"]);
        database
            .upsert_skill(&SkillDraft {
                id: "tagged-skill".into(),
                source_id: "tagged-source".into(),
                source_kind: "local".into(),
                source_locator: "C:/tagged".into(),
                relative_path: ".".into(),
                name: "tagged-skill".into(),
                description: "Fixture".into(),
                version: None,
                license: None,
                compatibility: None,
                allowed_tools: None,
                metadata_json: "{}".into(),
                content_hash: "hash".into(),
                library_path: "C:/library/tagged-skill".into(),
                script_count: 0,
                timestamp: 1,
            })
            .unwrap();
        let tag_ids: Vec<_> = database
            .list_tags()
            .unwrap()
            .into_iter()
            .filter(|tag| tag.name == "编码" || tag.name == "Review")
            .map(|tag| tag.id)
            .collect();
        database
            .set_skill_tags(&["tagged-skill".into()], &tag_ids)
            .unwrap();
        let tagged = database
            .list_tags()
            .unwrap()
            .into_iter()
            .filter(|tag| tag.skill_count == 1)
            .count();
        assert_eq!(tagged, 2);
        assert!(database.delete_tag("tag-coding").is_err());
        let custom = database
            .upsert_tag(
                &TagDraft {
                    id: None,
                    name: "自定义".into(),
                },
                2,
            )
            .unwrap();
        database.delete_tag(&custom.id).unwrap();
        drop(database);
        let reopened = Database::initialize(test_dir.join("tags.sqlite3")).unwrap();
        assert_eq!(
            reopened
                .list_tags()
                .unwrap()
                .into_iter()
                .filter(|tag| tag.skill_count == 1)
                .count(),
            2
        );
        let _ = fs::remove_dir_all(test_dir);
    }
}
