use std::collections::{BTreeSet, HashSet};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::Database, error::AppError};

const MAX_GROUP_NAME_CHARS: usize = 80;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroupRecord {
    pub id: String,
    pub name: String,
    pub skill_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroupDraft {
    pub id: Option<String>,
    pub name: String,
}

pub fn initialize(db: &Database) -> Result<(), AppError> {
    db.connect()?.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS skill_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_group_items (
            group_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(group_id, skill_id),
            FOREIGN KEY(group_id) REFERENCES skill_groups(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_skill_group_items_skill
        ON skill_group_items(skill_id, group_id);

        INSERT INTO schema_meta (key, value)
        VALUES ('schema_version', '7')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
        ",
    )?;
    Ok(())
}

pub fn list_groups(db: &Database) -> Result<Vec<SkillGroupRecord>, AppError> {
    let connection = db.connect()?;
    let mut statement = connection.prepare(
        "SELECT id, name, created_at, updated_at
         FROM skill_groups
         ORDER BY name COLLATE NOCASE ASC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let headers = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut groups = Vec::with_capacity(headers.len());
    for (id, name, created_at, updated_at) in headers {
        groups.push(SkillGroupRecord {
            skill_ids: group_skill_ids(&connection, &id)?,
            id,
            name,
            created_at,
            updated_at,
        });
    }
    Ok(groups)
}

pub fn upsert_group(
    db: &Database,
    draft: &SkillGroupDraft,
    timestamp: i64,
) -> Result<SkillGroupRecord, AppError> {
    let name = validate_group_name(&draft.name)?;
    let id = draft
        .id
        .clone()
        .unwrap_or_else(|| new_group_id(&name, timestamp));
    let mut connection = db.connect()?;
    let transaction = connection.transaction()?;

    if draft.id.is_some() {
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM skill_groups WHERE id = ?1)",
            params![id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::State("Skill group was not found".to_string()));
        }
    }

    let duplicate: bool = transaction.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM skill_groups
            WHERE name = ?1 COLLATE NOCASE AND id <> ?2
        )",
        params![name, id],
        |row| row.get(0),
    )?;
    if duplicate {
        return Err(AppError::State("分组名称已存在".to_string()));
    }

    transaction.execute(
        "INSERT INTO skill_groups (id, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             updated_at = excluded.updated_at",
        params![id, name, timestamp],
    )?;
    transaction.commit()?;

    group_by_id(db, &id)?.ok_or_else(|| {
        AppError::State("Skill group upsert completed but record is missing".to_string())
    })
}

pub fn delete_group(db: &Database, id: &str) -> Result<(), AppError> {
    let changed = db
        .connect()?
        .execute("DELETE FROM skill_groups WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::State("Skill group was not found".to_string()));
    }
    Ok(())
}

pub fn set_skill_groups(
    db: &Database,
    skill_id: &str,
    group_ids: &[String],
    timestamp: i64,
) -> Result<Vec<SkillGroupRecord>, AppError> {
    let mut seen = HashSet::new();
    let mut unique_group_ids = Vec::new();
    for group_id in group_ids {
        if seen.insert(group_id.clone()) {
            unique_group_ids.push(group_id.clone());
        }
    }

    let mut connection = db.connect()?;
    let transaction = connection.transaction()?;
    let skill_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM skills WHERE id = ?1)",
        params![skill_id],
        |row| row.get(0),
    )?;
    if !skill_exists {
        return Err(AppError::State("Library Skill was not found".to_string()));
    }

    for group_id in &unique_group_ids {
        let group_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM skill_groups WHERE id = ?1)",
            params![group_id],
            |row| row.get(0),
        )?;
        if !group_exists {
            return Err(AppError::State(format!(
                "Skill group was not found: {group_id}"
            )));
        }
    }

    let previous_group_ids = {
        let mut statement =
            transaction.prepare("SELECT group_id FROM skill_group_items WHERE skill_id = ?1")?;
        let rows = statement.query_map(params![skill_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    transaction.execute(
        "DELETE FROM skill_group_items WHERE skill_id = ?1",
        params![skill_id],
    )?;
    for group_id in &unique_group_ids {
        transaction.execute(
            "INSERT INTO skill_group_items (group_id, skill_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![group_id, skill_id, timestamp],
        )?;
    }

    let affected_ids = previous_group_ids
        .into_iter()
        .chain(unique_group_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    for group_id in affected_ids {
        transaction.execute(
            "UPDATE skill_groups SET updated_at = ?2 WHERE id = ?1",
            params![group_id, timestamp],
        )?;
    }
    transaction.commit()?;

    list_groups(db)
}

fn validate_group_name(value: &str) -> Result<String, AppError> {
    let name = value.trim();
    if name.is_empty() {
        return Err(AppError::State("分组名称不能为空".to_string()));
    }
    if name.chars().count() > MAX_GROUP_NAME_CHARS {
        return Err(AppError::State(format!(
            "分组名称不能超过 {MAX_GROUP_NAME_CHARS} 个字符"
        )));
    }
    if name.chars().any(char::is_control) {
        return Err(AppError::State("分组名称不能包含控制字符".to_string()));
    }
    Ok(name.to_string())
}

fn new_group_id(name: &str, timestamp: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"skill-group\0");
    hasher.update(name.to_lowercase().as_bytes());
    hasher.update(b"\0");
    hasher.update(timestamp.to_string().as_bytes());
    format!("group-{:x}", hasher.finalize())
}

fn group_by_id(db: &Database, id: &str) -> Result<Option<SkillGroupRecord>, AppError> {
    let connection = db.connect()?;
    let header = connection
        .query_row(
            "SELECT id, name, created_at, updated_at FROM skill_groups WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;

    match header {
        Some((id, name, created_at, updated_at)) => Ok(Some(SkillGroupRecord {
            skill_ids: group_skill_ids(&connection, &id)?,
            id,
            name,
            created_at,
            updated_at,
        })),
        None => Ok(None),
    }
}

fn group_skill_ids(
    connection: &rusqlite::Connection,
    group_id: &str,
) -> Result<Vec<String>, AppError> {
    let mut statement = connection.prepare(
        "SELECT item.skill_id
         FROM skill_group_items item
         INNER JOIN skills skill ON skill.id = item.skill_id
         WHERE item.group_id = ?1
         ORDER BY skill.name COLLATE NOCASE ASC, item.skill_id ASC",
    )?;
    let rows = statement.query_map(params![group_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{db::Database, skills::SkillDraft};

    use super::{
        delete_group, initialize, list_groups, set_skill_groups, upsert_group, SkillGroupDraft,
    };

    fn fixture_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "skills-manger-groups-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn groups_persist_membership_rename_and_delete() {
        let root = fixture_root();
        fs::create_dir_all(&root).expect("fixture directory should exist");
        let database =
            Database::initialize(root.join("groups.sqlite3")).expect("database should initialize");
        initialize(&database).expect("group schema should initialize");
        assert_eq!(
            database
                .schema_version()
                .expect("schema version should read"),
            "7"
        );

        database
            .upsert_skill(&SkillDraft {
                id: "skill-1".to_string(),
                source_id: "source-1".to_string(),
                source_kind: "local".to_string(),
                source_locator: root.join("source").to_string_lossy().into_owned(),
                relative_path: ".".to_string(),
                name: "demo-skill".to_string(),
                description: "Demo".to_string(),
                version: None,
                license: None,
                compatibility: None,
                allowed_tools: None,
                metadata_json: "{}".to_string(),
                content_hash: "hash-1".to_string(),
                library_path: root.join("library/skill-1").to_string_lossy().into_owned(),
                script_count: 0,
                timestamp: 10,
            })
            .expect("skill should persist");

        let group = upsert_group(
            &database,
            &SkillGroupDraft {
                id: None,
                name: "研发效率".to_string(),
            },
            20,
        )
        .expect("group should create");
        assert!(group.skill_ids.is_empty());

        let selected_group_ids = vec![group.id.clone()];
        let groups = set_skill_groups(&database, "skill-1", &selected_group_ids, 30)
            .expect("membership should persist");
        assert_eq!(groups[0].skill_ids, vec!["skill-1"]);

        let renamed = upsert_group(
            &database,
            &SkillGroupDraft {
                id: Some(group.id.clone()),
                name: "研发工具".to_string(),
            },
            40,
        )
        .expect("group should rename");
        assert_eq!(renamed.name, "研发工具");
        assert_eq!(renamed.skill_ids, vec!["skill-1"]);

        delete_group(&database, &group.id).expect("group should delete");
        assert!(list_groups(&database)
            .expect("groups should list")
            .is_empty());

        drop(database);
        let _ = fs::remove_dir_all(root);
    }
}
