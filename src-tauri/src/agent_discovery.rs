use std::{
    ffi::OsStr,
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{claude_code, db::Database, error::AppError, skills};

const CLAUDE_CODE_ID: &str = "claude-code";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTargetRecord {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub capabilities: Vec<String>,
    pub detected: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
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
    pub(crate) script_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDiscoverySnapshot {
    pub target: AgentTargetRecord,
    pub roots: Vec<DiscoveryRootRecord>,
    pub instances: Vec<SkillInstanceRecord>,
    pub warnings: Vec<String>,
}

pub fn initialize_claude_code(db: &Database) -> Result<(), AppError> {
    let timestamp = unix_timestamp()?;
    ensure_target_registration(db, timestamp)?;

    if let Some(home) = claude_code::current_home() {
        ensure_default_user_root(db, &claude_code::default_user_skills_root(&home), timestamp)?;
    }
    Ok(())
}

pub fn scan_claude_code(
    db: &Database,
    library_root: &Path,
) -> Result<AgentDiscoverySnapshot, AppError> {
    let home = claude_code::current_home().ok_or_else(|| {
        AppError::State("the current user home directory is unavailable".to_string())
    })?;
    let path_value = std::env::var_os("PATH").unwrap_or_default();
    scan_claude_code_with_environment(db, library_root, &home, &path_value, unix_timestamp()?)
}

fn scan_claude_code_with_environment(
    db: &Database,
    library_root: &Path,
    home: &Path,
    path_value: &OsStr,
    timestamp: i64,
) -> Result<AgentDiscoverySnapshot, AppError> {
    let mut target = detect_target(Some((path_value, timestamp)));
    let executable_warning = target.last_warning.clone();
    db.upsert_agent_target(&target, timestamp)?;
    ensure_default_user_root(db, &claude_code::default_user_skills_root(home), timestamp)?;

    let roots = db.list_discovery_roots()?;
    let mut warnings = executable_warning.into_iter().collect::<Vec<_>>();
    for root in roots
        .iter()
        .filter(|root| root.agent_id == CLAUDE_CODE_ID && root.enabled)
    {
        warnings.extend(scan_and_persist_root(db, root, library_root, timestamp)?);
    }

    target.last_warning = if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("; "))
    };
    let target = db.upsert_agent_target(&target, timestamp)?;

    Ok(AgentDiscoverySnapshot {
        target,
        roots: db.list_discovery_roots()?,
        instances: db.list_skill_instances()?,
        warnings,
    })
}

pub fn register_project_root(
    db: &Database,
    library_root: &Path,
    path: impl AsRef<Path>,
    timestamp: i64,
) -> Result<DiscoveryRootRecord, AppError> {
    let path = path.as_ref();
    validate_real_directory(path)?;
    let canonical = path.canonicalize()?;
    validate_project_skills_root(&canonical)?;
    let canonical_library = library_root.canonicalize()?;
    if canonical.starts_with(&canonical_library) {
        return Err(AppError::InvalidSkill(
            "managed Library paths cannot be registered as Agent roots".to_string(),
        ));
    }

    ensure_target_registration(db, timestamp)?;

    let canonical_text = canonical.to_string_lossy().into_owned();
    let record = DiscoveryRootRecord {
        id: stable_root_id("project", &canonical_text),
        agent_id: CLAUDE_CODE_ID.to_string(),
        scope: "project".to_string(),
        configured_path: canonical_text.clone(),
        canonical_path: Some(canonical_text),
        enabled: true,
        is_default: false,
        last_warning: None,
    };
    db.upsert_discovery_root(&record, timestamp)
}

fn ensure_target_registration(db: &Database, timestamp: i64) -> Result<(), AppError> {
    let already_registered = db
        .list_agent_targets()?
        .iter()
        .any(|target| target.id == CLAUDE_CODE_ID);
    if !already_registered {
        db.upsert_agent_target(&detect_target(None), timestamp)?;
    }
    Ok(())
}

fn detect_target(environment: Option<(&OsStr, i64)>) -> AgentTargetRecord {
    let executable =
        environment.and_then(|(path_value, _)| claude_code::find_executable(path_value));
    let was_scanned = environment.is_some();
    let detected = executable.is_some();
    AgentTargetRecord {
        id: CLAUDE_CODE_ID.to_string(),
        name: "Claude Code".to_string(),
        provider: "Anthropic".to_string(),
        capabilities: vec!["detect".to_string(), "read-skills".to_string()],
        detected,
        executable_path: executable.map(|path| path.to_string_lossy().into_owned()),
        version: None,
        last_warning: (was_scanned && !detected)
            .then(|| "Claude Code executable was not found on PATH".to_string()),
        last_scanned_at: environment.map(|(_, timestamp)| timestamp),
    }
}

fn ensure_default_user_root(
    db: &Database,
    path: &Path,
    timestamp: i64,
) -> Result<DiscoveryRootRecord, AppError> {
    let configured_path = path.to_string_lossy().into_owned();
    let canonical_path = path
        .canonicalize()
        .ok()
        .map(|value| value.to_string_lossy().into_owned());
    let record = DiscoveryRootRecord {
        id: stable_root_id("user", &configured_path),
        agent_id: CLAUDE_CODE_ID.to_string(),
        scope: "user".to_string(),
        configured_path,
        canonical_path,
        enabled: true,
        is_default: true,
        last_warning: None,
    };
    db.upsert_discovery_root(&record, timestamp)
}

fn validate_real_directory(path: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::InvalidSkill(format!(
            "discovery root cannot be inspected: {} ({error})",
            path.display()
        ))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::InvalidSkill(
            "discovery root must be a real directory and cannot be a symbolic link".to_string(),
        ));
    }
    Ok(())
}

fn validate_project_skills_root(path: &Path) -> Result<(), AppError> {
    let name = path.file_name().and_then(|value| value.to_str());
    let parent = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str());
    if !name.is_some_and(|value| value.eq_ignore_ascii_case("skills"))
        || !parent.is_some_and(|value| value.eq_ignore_ascii_case(".claude"))
    {
        return Err(AppError::InvalidSkill(
            "project discovery root must point to a .claude/skills directory".to_string(),
        ));
    }
    Ok(())
}

fn stable_root_id(scope: &str, path: &str) -> String {
    hash_text(&format!("{CLAUDE_CODE_ID}\0{scope}\0{path}"))
}

pub(crate) fn scan_and_persist_root(
    db: &Database,
    root: &DiscoveryRootRecord,
    library_root: &Path,
    timestamp: i64,
) -> Result<Vec<String>, AppError> {
    let configured_path = Path::new(&root.configured_path);
    let metadata = match fs::symlink_metadata(configured_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let warning = format!(
                "discovery root is not available: {}",
                configured_path.display()
            );
            persist_root_warning(db, root, None, &warning, timestamp)?;
            return Ok(vec![warning]);
        }
        Err(error) => {
            let warning = format!(
                "discovery root cannot be inspected: {} ({error})",
                configured_path.display()
            );
            persist_root_warning(db, root, None, &warning, timestamp)?;
            return Ok(vec![warning]);
        }
    };

    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        let warning = format!(
            "discovery root must be a real directory and cannot be a symbolic link: {}",
            configured_path.display()
        );
        persist_root_warning(db, root, None, &warning, timestamp)?;
        return Ok(vec![warning]);
    }

    let canonical_root = match configured_path.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            let warning = format!(
                "discovery root cannot be canonicalized: {} ({error})",
                configured_path.display()
            );
            persist_root_warning(db, root, None, &warning, timestamp)?;
            return Ok(vec![warning]);
        }
    };
    let canonical_library = library_root.canonicalize()?;
    if canonical_root.starts_with(&canonical_library) {
        let warning = "managed Library paths cannot be scanned as Agent roots".to_string();
        persist_root_warning(
            db,
            root,
            Some(canonical_root.to_string_lossy().into_owned()),
            &warning,
            timestamp,
        )?;
        return Ok(vec![warning]);
    }

    let mut entries = match fs::read_dir(&canonical_root) {
        Ok(entries) => match entries.collect::<Result<Vec<_>, _>>() {
            Ok(entries) => entries,
            Err(error) => {
                let warning = format!(
                    "discovery root cannot be read completely: {} ({error})",
                    canonical_root.display()
                );
                persist_root_warning(
                    db,
                    root,
                    Some(canonical_root.to_string_lossy().into_owned()),
                    &warning,
                    timestamp,
                )?;
                return Ok(vec![warning]);
            }
        },
        Err(error) => {
            let warning = format!(
                "discovery root cannot be read: {} ({error})",
                canonical_root.display()
            );
            persist_root_warning(
                db,
                root,
                Some(canonical_root.to_string_lossy().into_owned()),
                &warning,
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
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                warnings.push(format!("cannot inspect {}: {error}", path.display()));
                continue;
            }
        };
        if file_type.is_symlink() {
            warnings.push(format!(
                "symbolic links are not supported during discovery: {}",
                path.display()
            ));
            continue;
        }
        if !file_type.is_dir() || !path.join("SKILL.md").is_file() {
            continue;
        }

        match skills::inspect_skill(&path) {
            Ok(inspected) => {
                let canonical_path = inspected.source_path.to_string_lossy().into_owned();
                instances.push(SkillInstanceDraft {
                    id: stable_instance_id(&root.scope, &canonical_path),
                    agent_id: root.agent_id.clone(),
                    root_id: root.id.clone(),
                    scope: root.scope.clone(),
                    path: canonical_path,
                    name: inspected.name,
                    description: inspected.description,
                    content_hash: inspected.content_hash,
                    script_count: inspected.script_count,
                });
            }
            Err(error) => warnings.push(format!("{}: {error}", path.display())),
        }
    }

    db.reconcile_root_instances(&root.id, &instances, timestamp)?;
    let canonical_text = canonical_root.to_string_lossy().into_owned();
    let mut updated_root = root.clone();
    updated_root.canonical_path = Some(canonical_text);
    updated_root.last_warning = if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("; "))
    };
    db.upsert_discovery_root(&updated_root, timestamp)?;

    Ok(warnings)
}

fn persist_root_warning(
    db: &Database,
    root: &DiscoveryRootRecord,
    canonical_path: Option<String>,
    warning: &str,
    timestamp: i64,
) -> Result<(), AppError> {
    let mut updated_root = root.clone();
    updated_root.canonical_path = canonical_path;
    updated_root.last_warning = Some(warning.to_string());
    db.upsert_discovery_root(&updated_root, timestamp)?;
    Ok(())
}

fn stable_instance_id(scope: &str, canonical_path: &str) -> String {
    hash_text(&format!("{CLAUDE_CODE_ID}\0{scope}\0{canonical_path}"))
}

fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    to_hex(&hasher.finalize())
}

fn to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

pub(crate) fn unix_timestamp() -> Result<i64, AppError> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::State(format!("system clock error: {error}")))?
        .as_secs();
    i64::try_from(seconds)
        .map_err(|_| AppError::State("timestamp does not fit into i64".to_string()))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::db::Database;

    use super::{
        ensure_target_registration, scan_and_persist_root, AgentTargetRecord, DiscoveryRootRecord,
        SkillInstanceRecord,
    };

    fn test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "skills-manger-m3-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn write_skill(root: &Path, name: &str, description: &str) {
        fs::create_dir_all(root).expect("skill directory should exist");
        fs::write(
            root.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {description}\n---\n\n# Test\n"),
        )
        .expect("manifest should write");
    }

    fn prepare_database(
        test_directory: &Path,
        skills_root: &Path,
        root_id: &str,
        scope: &str,
    ) -> (Database, DiscoveryRootRecord, PathBuf) {
        let library = test_directory.join("library");
        fs::create_dir_all(&library).expect("library should exist");
        let database = Database::initialize(test_directory.join("skills.sqlite3"))
            .expect("database should initialize");
        database
            .upsert_agent_target(
                &AgentTargetRecord {
                    id: "claude-code".to_string(),
                    name: "Claude Code".to_string(),
                    provider: "Anthropic".to_string(),
                    capabilities: vec!["detect".to_string()],
                    detected: false,
                    executable_path: None,
                    version: None,
                    last_warning: None,
                    last_scanned_at: None,
                },
                1,
            )
            .expect("target should persist");
        let record = DiscoveryRootRecord {
            id: root_id.to_string(),
            agent_id: "claude-code".to_string(),
            scope: scope.to_string(),
            configured_path: skills_root.to_string_lossy().into_owned(),
            canonical_path: None,
            enabled: true,
            is_default: scope == "user",
            last_warning: None,
        };
        let record = database
            .upsert_discovery_root(&record, 1)
            .expect("root should persist");
        (database, record, library)
    }

    fn instance_by_name(instances: &[SkillInstanceRecord], name: &str) -> SkillInstanceRecord {
        instances
            .iter()
            .find(|instance| instance.name == name)
            .cloned()
            .expect("instance should exist")
    }

    #[test]
    fn initialization_preserves_last_detection_result() {
        let test_directory = test_root("preserve-target");
        fs::create_dir_all(&test_directory).expect("test directory should exist");
        let database = Database::initialize(test_directory.join("skills.sqlite3"))
            .expect("database should initialize");
        let detected = AgentTargetRecord {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            provider: "Anthropic".to_string(),
            capabilities: vec!["detect".to_string(), "read-skills".to_string()],
            detected: true,
            executable_path: Some("C:/tools/claude.exe".to_string()),
            version: None,
            last_warning: None,
            last_scanned_at: Some(10),
        };
        database
            .upsert_agent_target(&detected, 10)
            .expect("target should persist");

        ensure_target_registration(&database, 20).expect("initialization should be idempotent");

        assert_eq!(
            database.list_agent_targets().expect("targets should list"),
            vec![detected]
        );
        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn discovers_valid_skills_without_executing_scripts() {
        let test_directory = test_root("safe-scan");
        let skills_root = test_directory
            .join("project")
            .join(".claude")
            .join("skills");
        let skill = skills_root.join("demo-skill");
        write_skill(&skill, "demo-skill", "Safe scanner fixture.");
        fs::create_dir_all(skill.join("scripts")).expect("scripts directory should exist");
        let sentinel = test_directory.join("SCRIPT_EXECUTED");
        fs::write(
            skill.join("scripts").join("run.sh"),
            format!("echo executed > {}", sentinel.display()),
        )
        .expect("script fixture should write");
        let (database, root, library) =
            prepare_database(&test_directory, &skills_root, "root-safe", "project");

        let warnings = scan_and_persist_root(&database, &root, &library, 10)
            .expect("root scan should succeed");
        let instances = database
            .list_skill_instances()
            .expect("instances should list");

        assert!(warnings.is_empty());
        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].state, "unmanaged");
        assert_eq!(instances[0].script_count, 1);
        assert!(!sentinel.exists());

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn invalid_skill_does_not_hide_valid_sibling() {
        let test_directory = test_root("invalid-sibling");
        let skills_root = test_directory
            .join("project")
            .join(".claude")
            .join("skills");
        write_skill(
            &skills_root.join("valid-skill"),
            "valid-skill",
            "Valid sibling fixture.",
        );
        write_skill(
            &skills_root.join("wrong-directory"),
            "different-name",
            "Invalid sibling fixture.",
        );
        let (database, root, library) =
            prepare_database(&test_directory, &skills_root, "root-invalid", "project");

        let warnings = scan_and_persist_root(&database, &root, &library, 10)
            .expect("root scan should isolate invalid skill");
        let instances = database
            .list_skill_instances()
            .expect("instances should list");

        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].name, "valid-skill");
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("wrong-directory"));

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn same_name_in_different_roots_has_distinct_identity() {
        let test_directory = test_root("same-name");
        let first_root = test_directory.join("first").join(".claude").join("skills");
        let second_root = test_directory.join("second").join(".claude").join("skills");
        write_skill(
            &first_root.join("demo-skill"),
            "demo-skill",
            "First source.",
        );
        write_skill(
            &second_root.join("demo-skill"),
            "demo-skill",
            "Second source.",
        );
        let (database, first, library) =
            prepare_database(&test_directory, &first_root, "root-first", "project");
        let second = database
            .upsert_discovery_root(
                &DiscoveryRootRecord {
                    id: "root-second".to_string(),
                    agent_id: "claude-code".to_string(),
                    scope: "project".to_string(),
                    configured_path: second_root.to_string_lossy().into_owned(),
                    canonical_path: None,
                    enabled: true,
                    is_default: false,
                    last_warning: None,
                },
                1,
            )
            .expect("second root should persist");

        scan_and_persist_root(&database, &first, &library, 10).expect("first root should scan");
        scan_and_persist_root(&database, &second, &library, 11).expect("second root should scan");
        let instances = database
            .list_skill_instances()
            .expect("instances should list");

        assert_eq!(instances.len(), 2);
        assert_ne!(instances[0].id, instances[1].id);
        assert_ne!(instances[0].path, instances[1].path);

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn successful_rescan_marks_removed_instance_missing() {
        let test_directory = test_root("missing-instance");
        let skills_root = test_directory
            .join("project")
            .join(".claude")
            .join("skills");
        let skill = skills_root.join("demo-skill");
        write_skill(&skill, "demo-skill", "Missing instance fixture.");
        let (database, root, library) =
            prepare_database(&test_directory, &skills_root, "root-missing", "project");
        scan_and_persist_root(&database, &root, &library, 10).expect("initial scan should work");

        fs::remove_dir_all(&skill).expect("fixture skill should be removed");
        scan_and_persist_root(&database, &root, &library, 20).expect("rescan should work");
        let instances = database
            .list_skill_instances()
            .expect("instances should list");

        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].state, "missing");
        assert_eq!(instances[0].last_discovered_at, 10);

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn missing_root_preserves_existing_instances_and_returns_warning() {
        let test_directory = test_root("missing-root");
        let skills_root = test_directory
            .join("project")
            .join(".claude")
            .join("skills");
        write_skill(
            &skills_root.join("demo-skill"),
            "demo-skill",
            "Missing root fixture.",
        );
        let (database, root, library) =
            prepare_database(&test_directory, &skills_root, "root-unavailable", "project");
        scan_and_persist_root(&database, &root, &library, 10).expect("initial scan should work");
        let before = instance_by_name(
            &database
                .list_skill_instances()
                .expect("instances should list"),
            "demo-skill",
        );

        fs::remove_dir_all(&skills_root).expect("fixture root should be removed");
        let warnings = scan_and_persist_root(&database, &root, &library, 20)
            .expect("missing root should be recoverable");
        let after = instance_by_name(
            &database
                .list_skill_instances()
                .expect("instances should list"),
            "demo-skill",
        );

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("not available"));
        assert_eq!(after.state, "unmanaged");
        assert_eq!(after.last_discovered_at, before.last_discovered_at);

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn project_root_must_be_dot_claude_skills() {
        let test_directory = test_root("invalid-project-root");
        let invalid_root = test_directory.join("skills");
        let library = test_directory.join("library");
        fs::create_dir_all(&invalid_root).expect("invalid root should exist");
        fs::create_dir_all(&library).expect("library should exist");
        let database = Database::initialize(test_directory.join("skills.sqlite3"))
            .expect("database should initialize");

        let error = super::register_project_root(&database, &library, &invalid_root, 10)
            .expect_err("invalid root should be rejected");

        assert!(error.to_string().contains(".claude"));
        assert!(database
            .list_discovery_roots()
            .expect("roots should list")
            .is_empty());

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn duplicate_project_root_returns_existing_record() {
        let test_directory = test_root("duplicate-project-root");
        let skills_root = test_directory
            .join("project")
            .join(".claude")
            .join("skills");
        let library = test_directory.join("library");
        fs::create_dir_all(&skills_root).expect("project root should exist");
        fs::create_dir_all(&library).expect("library should exist");
        let database = Database::initialize(test_directory.join("skills.sqlite3"))
            .expect("database should initialize");
        database
            .upsert_agent_target(
                &AgentTargetRecord {
                    id: "claude-code".to_string(),
                    name: "Claude Code".to_string(),
                    provider: "Anthropic".to_string(),
                    capabilities: vec!["detect".to_string()],
                    detected: false,
                    executable_path: None,
                    version: None,
                    last_warning: None,
                    last_scanned_at: None,
                },
                1,
            )
            .expect("target should persist");

        let first = super::register_project_root(&database, &library, &skills_root, 10)
            .expect("first registration should work");
        let second = super::register_project_root(&database, &library, &skills_root, 20)
            .expect("duplicate registration should be idempotent");

        assert_eq!(first.id, second.id);
        assert_eq!(
            database
                .list_discovery_roots()
                .expect("roots should list")
                .len(),
            1
        );

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn linked_skill_directory_is_not_followed() {
        let test_directory = test_root("linked-skill");
        let skills_root = test_directory
            .join("project")
            .join(".claude")
            .join("skills");
        let external_skill = test_directory.join("outside").join("external-skill");
        let linked_skill = skills_root.join("external-skill");
        fs::create_dir_all(&skills_root).expect("skills root should exist");
        write_skill(
            &external_skill,
            "external-skill",
            "External linked fixture.",
        );

        #[cfg(unix)]
        std::os::unix::fs::symlink(&external_skill, &linked_skill)
            .expect("directory symlink should be created");
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(&external_skill, &linked_skill).is_err() {
            let _ = fs::remove_dir_all(test_directory);
            return;
        }

        let (database, root, library) =
            prepare_database(&test_directory, &skills_root, "root-linked", "project");
        let warnings = scan_and_persist_root(&database, &root, &library, 10)
            .expect("linked child should be recoverable");

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("symbolic links"));
        assert!(database
            .list_skill_instances()
            .expect("instances should list")
            .is_empty());

        drop(database);
        let _ = fs::remove_dir_all(test_directory);
    }
}
