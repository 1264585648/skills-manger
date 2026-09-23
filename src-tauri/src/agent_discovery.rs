//! Discovery: register the known agents from the static catalog, keep their
//! skills roots, and scan those roots for skills in place. Scanning is
//! read-only and never executes anything inside a skill directory.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{
    agent_catalog::{self, AgentDefinition},
    db::{AgentTargetRecord, Database, DiscoveryRootRecord},
    error::AppError,
    skills,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstanceRecord {
    pub id: String,
    pub agent_id: String,
    pub root_id: String,
    pub scope: String,
    pub path: String,
    pub name: String,
    pub description: String,
    pub content_hash: String,
    pub script_count: i64,
    pub state: String,
    pub first_discovered_at: i64,
    pub last_discovered_at: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct SkillInstanceDraft {
    pub(crate) id: String,
    pub(crate) agent_id: String,
    pub(crate) root_id: String,
    pub(crate) scope: String,
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) content_hash: String,
    pub(crate) content_signature: String,
    pub(crate) script_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSnapshot {
    pub targets: Vec<AgentTargetRecord>,
    pub roots: Vec<DiscoveryRootRecord>,
    pub instances: Vec<SkillInstanceRecord>,
    pub warnings: Vec<String>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn platform_executable_names(agent: &AgentDefinition) -> Vec<String> {
    #[cfg(windows)]
    let suffixes = ["", ".exe", ".cmd", ".bat"];
    #[cfg(not(windows))]
    let suffixes = [""];
    agent
        .commands
        .iter()
        .flat_map(|command| {
            suffixes
                .iter()
                .map(move |suffix| format!("{command}{suffix}"))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn find_executable(path_value: &std::ffi::OsStr, candidates: &[String]) -> Option<PathBuf> {
    std::env::split_paths(path_value).find_map(|directory| {
        candidates.iter().find_map(|candidate| {
            let path = directory.join(candidate);
            if path.is_file() {
                path.canonicalize().ok()
            } else {
                None
            }
        })
    })
}

fn detect_target(agent: &AgentDefinition, home: Option<&Path>) -> AgentTargetRecord {
    let executable = std::env::var_os("PATH").and_then(|path| {
        let candidates = platform_executable_names(agent);
        find_executable(&path, &candidates)
    });

    let roots_exist = home.is_some_and(|home| {
        agent
            .user_roots
            .iter()
            .any(|relative| home.join(relative).is_dir())
    });
    let detected = roots_exist || executable.is_some();
    let installed = executable.is_some();

    AgentTargetRecord {
        id: agent.id.to_string(),
        name: agent.name.to_string(),
        provider: agent.provider.to_string(),
        detected,
        installed,
        executable_path: executable.map(|path| path.to_string_lossy().into_owned()),
        last_warning: (!detected).then(|| format!("{} 未在 PATH 或默认目录中找到", agent.name)),
        last_scanned_at: None,
    }
}

fn stable_root_id(agent_id: &str, scope: &str, path: &str) -> String {
    skills::hash_text(&format!("{agent_id}\0{scope}\0{path}"))
}

fn stable_instance_id(agent_id: &str, root_id: &str, scope: &str, canonical_path: &str) -> String {
    skills::hash_text(&format!("{agent_id}\0{root_id}\0{scope}\0{canonical_path}"))
}

/// Register one target per catalog agent (idempotent; detection is refreshed).
pub fn ensure_targets_registered(db: &Database, timestamp: i64) -> Result<(), AppError> {
    let home = home_dir();
    // One query instead of one per catalog agent: the previous version scanned
    // the whole table 15 times on every start.
    let existing: HashMap<String, AgentTargetRecord> = db
        .list_agent_targets()?
        .into_iter()
        .map(|target| (target.id.clone(), target))
        .collect();

    for agent in agent_catalog::AGENTS {
        let detected = detect_target(agent, home.as_deref());
        let record = match existing.get(&detected.id) {
            Some(previous) if !previous.detected => AgentTargetRecord {
                detected: detected.detected,
                installed: detected.installed,
                executable_path: detected
                    .executable_path
                    .or(previous.executable_path.clone()),
                last_warning: detected.last_warning,
                last_scanned_at: previous.last_scanned_at,
                ..previous.clone()
            },
            _ => detected,
        };
        db.upsert_agent_target(&record, timestamp)?;
    }
    Ok(())
}

/// Register the default user roots that exist on disk for every catalog agent.
pub fn ensure_default_user_roots(db: &Database, timestamp: i64) -> Result<Vec<String>, AppError> {
    let mut warnings = Vec::new();
    let Some(home) = home_dir() else {
        return Ok(warnings);
    };

    for agent in agent_catalog::AGENTS {
        for relative in agent.user_roots {
            let configured = home.join(relative);
            if !configured.is_dir() {
                continue;
            }
            let canonical = match configured.canonicalize() {
                Ok(path) => path,
                Err(error) => {
                    warnings.push(format!("{} 不可用: {error}", configured.display()));
                    continue;
                }
            };
            let canonical_text = canonical.to_string_lossy().into_owned();
            let record = DiscoveryRootRecord {
                id: stable_root_id(agent.id, "user", &canonical_text),
                agent_id: agent.id.to_string(),
                scope: "user".to_string(),
                configured_path: configured.to_string_lossy().into_owned(),
                canonical_path: Some(canonical_text),
                enabled: true,
                is_default: true,
                last_warning: None,
            };
            db.upsert_discovery_root(&record, timestamp)?;
        }
    }
    Ok(warnings)
}

/// Register a project skills root for an agent (e.g. `<repo>/.claude/skills`).
pub fn register_project_root(
    db: &Database,
    agent_id: &str,
    path: impl AsRef<Path>,
    timestamp: i64,
) -> Result<DiscoveryRootRecord, AppError> {
    let agent = agent_catalog::definition(agent_id)
        .ok_or_else(|| AppError::State(format!("未知 Agent: {agent_id}")))?;
    let path = path.as_ref();

    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::InvalidSkill(format!("目录不可用: {} ({error})", path.display()))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::InvalidSkill(
            "项目 Skills 目录必须是真实目录，不能是符号链接".to_string(),
        ));
    }
    let canonical = path.canonicalize()?;
    if !matches_project_convention(agent, &canonical) {
        return Err(AppError::InvalidSkill(format!(
            "{} 的项目目录需要匹配 {} 之一",
            agent.name,
            agent.project_roots.join(" / ")
        )));
    }

    let canonical_text = canonical.to_string_lossy().into_owned();
    let record = DiscoveryRootRecord {
        id: stable_root_id(agent.id, "project", &canonical_text),
        agent_id: agent.id.to_string(),
        scope: "project".to_string(),
        configured_path: path.to_string_lossy().into_owned(),
        canonical_path: Some(canonical_text),
        enabled: true,
        is_default: false,
        last_warning: None,
    };
    db.upsert_discovery_root(&record, timestamp)
}

fn matches_project_convention(agent: &AgentDefinition, canonical: &Path) -> bool {
    let components: Vec<String> = canonical
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect();
    agent.project_roots.iter().any(|pattern| {
        let expected: Vec<&str> = pattern.split('/').collect();
        components.len() >= expected.len()
            && expected
                .iter()
                .zip(components[components.len() - expected.len()..].iter())
                .all(|(want, got)| want.eq_ignore_ascii_case(got))
    })
}

/// Everything a scan needs from the database, read once and shared by all roots.
struct ScanContext {
    /// Link paths this app created, so its own write-back entries stay silent.
    link_paths: HashSet<String>,
    /// `skill path -> (content_hash, content_signature)` from the previous scan.
    signatures: HashMap<String, (String, Option<String>)>,
}

/// Scan every enabled root and refresh the instance cache.
pub fn scan_all(db: &Database, timestamp: i64) -> Result<ScanSnapshot, AppError> {
    // Targets first: discovery_roots.agent_id references agent_targets(id),
    // so a fresh database would fail the foreign key otherwise.
    ensure_targets_registered(db, timestamp)?;
    let mut warnings = ensure_default_user_roots(db, timestamp)?;

    let context = ScanContext {
        link_paths: db.link_paths()?,
        signatures: db.skill_signatures()?,
    };

    let roots = db.list_discovery_roots()?;
    for root in &roots {
        if !root.enabled {
            continue;
        }
        warnings.extend(scan_and_persist_root(db, root, &context, timestamp)?);
    }

    snapshot(db, warnings)
}

/// The cached picture, without touching the disk.
///
/// Served to the UI while a background scan is still running or right after it
/// finished, so opening the app never waits for the filesystem.
pub fn snapshot(db: &Database, warnings: Vec<String>) -> Result<ScanSnapshot, AppError> {
    Ok(ScanSnapshot {
        targets: db.list_agent_targets()?,
        roots: db.list_discovery_roots()?,
        instances: db.list_skill_instances()?,
        warnings,
    })
}

fn scan_and_persist_root(
    db: &Database,
    root: &DiscoveryRootRecord,
    context: &ScanContext,
    timestamp: i64,
) -> Result<Vec<String>, AppError> {
    let configured_path = Path::new(&root.configured_path);
    let metadata = match fs::symlink_metadata(configured_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let warning = format!("目录不存在: {}", configured_path.display());
            save_root_state(db, root, None, Some(&warning), timestamp)?;
            return Ok(vec![warning]);
        }
        Err(error) => {
            let warning = format!("目录不可用: {} ({error})", configured_path.display());
            save_root_state(db, root, None, Some(&warning), timestamp)?;
            return Ok(vec![warning]);
        }
    };

    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        let warning = format!("目录必须是真实目录: {}", configured_path.display());
        save_root_state(db, root, None, Some(&warning), timestamp)?;
        return Ok(vec![warning]);
    }

    let canonical_root = configured_path.canonicalize()?;
    let mut entries = match fs::read_dir(&canonical_root) {
        Ok(entries) => entries.collect::<Result<Vec<_>, _>>()?,
        Err(error) => {
            let warning = format!("目录读取失败: {} ({error})", canonical_root.display());
            save_root_state(
                db,
                root,
                Some(canonical_root.to_string_lossy().into_owned()),
                Some(&warning),
                timestamp,
            )?;
            return Ok(vec![warning]);
        }
    };
    entries.sort_by_key(|entry| entry.file_name());

    let mut warnings = Vec::new();
    let mut instances = Vec::new();
    for entry in entries {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            warnings.push(format!("无法读取条目: {}", path.display()));
            continue;
        };
        if file_type.is_symlink() {
            // Links this app created during write-back are expected and silent.
            if !context
                .link_paths
                .contains(&path.to_string_lossy().into_owned())
            {
                warnings.push(format!("跳过符号链接: {}", path.display()));
            }
            continue;
        }
        if !file_type.is_dir() || !path.join("SKILL.md").is_file() {
            continue;
        }

        // Cheap case: the fingerprint still matches, so the stored hash is
        // reused and no file body is read.
        let cached = context
            .signatures
            .get(&path.to_string_lossy().into_owned())
            .map(|(hash, signature)| (hash.as_str(), signature.as_deref()));

        match skills::inspect_skill(&path, cached) {
            Ok(inspected) => {
                let canonical_path = inspected.source_path.to_string_lossy().into_owned();
                instances.push(SkillInstanceDraft {
                    id: stable_instance_id(&root.agent_id, &root.id, &root.scope, &canonical_path),
                    agent_id: root.agent_id.clone(),
                    root_id: root.id.clone(),
                    scope: root.scope.clone(),
                    path: canonical_path,
                    name: inspected.name,
                    description: inspected.description,
                    content_hash: inspected.content_hash,
                    content_signature: inspected.content_signature,
                    script_count: inspected.script_count,
                });
            }
            Err(error) => warnings.push(format!("{}: {error}", path.display())),
        }
    }

    db.reconcile_root_instances(&root.id, &instances, timestamp)?;
    let canonical_text = canonical_root.to_string_lossy().into_owned();
    let warning = if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("; "))
    };
    save_root_state(
        db,
        root,
        Some(canonical_text),
        warning.as_deref(),
        timestamp,
    )?;

    Ok(warnings)
}

/// Persist a root's canonical path and warning, skipping the write when nothing
/// actually changed (a rescan now writes far less than it used to).
fn save_root_state(
    db: &Database,
    root: &DiscoveryRootRecord,
    canonical_path: Option<String>,
    warning: Option<&str>,
    timestamp: i64,
) -> Result<(), AppError> {
    let next_warning = warning
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if root.canonical_path == canonical_path && root.last_warning == next_warning {
        return Ok(());
    }

    let mut updated_root = root.clone();
    updated_root.canonical_path = canonical_path;
    updated_root.last_warning = next_warning;
    db.upsert_discovery_root(&updated_root, timestamp)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{db::Database, skills::unix_timestamp};

    use super::*;

    /// Test-side view of what `scan_all` loads once per scan.
    fn scan_context(db: &Database) -> ScanContext {
        ScanContext {
            link_paths: db.link_paths().expect("links should list"),
            signatures: db.skill_signatures().expect("signatures should list"),
        }
    }

    fn test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("skills-manger-discovery-{label}-{nonce}"))
    }

    fn write_skill(root: &Path, name: &str, description: &str) {
        fs::create_dir_all(root).expect("skill directory should exist");
        fs::write(
            root.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {description}\n---\n\n# Test\n"),
        )
        .expect("manifest should write");
    }

    #[test]
    fn project_root_registration_validates_convention() {
        let directory = test_root("convention");
        let valid = directory.join("project").join(".claude").join("skills");
        fs::create_dir_all(&valid).expect("valid root should exist");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        ensure_targets_registered(&database, now).expect("targets should register");

        let record = register_project_root(&database, "claude-code", &valid, now)
            .expect("valid project root should register");
        assert_eq!(record.agent_id, "claude-code");
        assert_eq!(record.scope, "project");
        assert!(!record.is_default);

        let invalid = directory.join("project").join("skills");
        fs::create_dir_all(&invalid).expect("invalid root should exist");
        let error = register_project_root(&database, "claude-code", &invalid, now)
            .expect_err("unbounded root should fail");
        assert!(error.to_string().contains(".claude/skills"));

        let unknown = register_project_root(&database, "not-an-agent", &valid, now)
            .expect_err("unknown agent should fail");
        assert!(unknown.to_string().contains("未知 Agent"));

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn scan_finds_skills_and_isolates_invalid_siblings() {
        let directory = test_root("scan");
        let skills_root = directory.join("project").join(".agents").join("skills");
        write_skill(
            &skills_root.join("valid-skill"),
            "valid-skill",
            "Valid fixture.",
        );
        write_skill(
            &skills_root.join("wrong-directory"),
            "different-name",
            "Invalid fixture.",
        );
        fs::create_dir_all(&directory).expect("test directory should exist");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        ensure_targets_registered(&database, now).expect("targets should register");

        let record = register_project_root(&database, "codex", &skills_root, now)
            .expect("root should register");
        let warnings = scan_and_persist_root(&database, &record, &scan_context(&database), now)
            .expect("root scan should succeed");
        let instances = database
            .list_skill_instances()
            .expect("instances should list");

        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].name, "valid-skill");
        assert_eq!(instances[0].state, "unmanaged");
        assert_eq!(instances[0].agent_id, "codex");
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("wrong-directory"));

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rescan_marks_disappeared_skill_missing() {
        let directory = test_root("missing");
        let skills_root = directory.join("project").join(".claude").join("skills");
        let skill = skills_root.join("demo-skill");
        write_skill(&skill, "demo-skill", "Missing fixture.");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        ensure_targets_registered(&database, now).expect("targets should register");

        let record = register_project_root(&database, "claude-code", &skills_root, now)
            .expect("root should register");
        scan_and_persist_root(&database, &record, &scan_context(&database), now)
            .expect("first scan should work");

        fs::remove_dir_all(&skill).expect("fixture should be removed");
        scan_and_persist_root(&database, &record, &scan_context(&database), now + 1)
            .expect("rescan should work");

        let instances = database
            .list_skill_instances()
            .expect("instances should list");
        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].state, "missing");

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn scan_tolerates_missing_root() {
        let directory = test_root("missing-root");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let skills_root = directory.join("project").join(".claude").join("skills");
        write_skill(&skills_root.join("demo-skill"), "demo-skill", "Fixture.");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");
        ensure_targets_registered(&database, now).expect("targets should register");

        let record = register_project_root(&database, "claude-code", &skills_root, now)
            .expect("root should register");
        scan_and_persist_root(&database, &record, &scan_context(&database), now)
            .expect("first scan should work");

        fs::remove_dir_all(&skills_root).expect("root should be removed");
        let warnings = scan_and_persist_root(&database, &record, &scan_context(&database), now + 1)
            .expect("missing root should be recoverable");

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("不存在"));
        let instances = database
            .list_skill_instances()
            .expect("instances should list");
        assert_eq!(instances[0].state, "unmanaged");

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn scan_all_on_fresh_database_registers_targets_first() {
        let directory = test_root("fresh-scan");
        fs::create_dir_all(&directory).expect("test directory should exist");
        let database =
            Database::initialize(directory.join("skills.sqlite3")).expect("db should open");
        let now = unix_timestamp().expect("clock should be valid");

        // Fresh database, no targets registered yet: scan_all must register the
        // agent targets before any discovery root is written, otherwise the
        // discovery_roots foreign key fails on the very first scan.
        let snapshot = scan_all(&database, now).expect("fresh scan should succeed");
        assert!(!snapshot.targets.is_empty());

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }
}
