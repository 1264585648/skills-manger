use std::{
    ffi::{OsStr, OsString},
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    db::Database,
    error::AppError,
    safe_apply,
    skills::{self, ImportSkillResult, SkillRecord},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSourceDraft {
    pub url: String,
    pub reference: String,
    pub skill_subpath: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitSourceRecord {
    pub id: String,
    pub skill_id: String,
    pub url: String,
    pub reference: String,
    pub skill_subpath: String,
    pub checkout_path: String,
    pub last_fetched_revision: String,
    pub last_checked_at: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUpdateRecord {
    pub skill_id: String,
    pub skill_name: String,
    pub source_id: String,
    pub source_url: String,
    pub reference: String,
    pub base_hash: String,
    pub library_hash: Option<String>,
    pub upstream_hash: String,
    pub upstream_revision: String,
    pub status: String,
    pub checked_at: i64,
    pub can_promote: bool,
}

#[derive(Debug)]
struct TrackingRecord {
    base_hash: String,
    upstream_hash: String,
    upstream_revision: String,
    checked_at: i64,
}

pub fn register_git_source(
    db: &Database,
    library_root: &Path,
    checkouts_root: &Path,
    draft: &GitSourceDraft,
    timestamp: i64,
) -> Result<SkillUpdateRecord, AppError> {
    register_git_source_inner(db, library_root, checkouts_root, draft, timestamp, false)
}

fn register_git_source_inner(
    db: &Database,
    library_root: &Path,
    checkouts_root: &Path,
    draft: &GitSourceDraft,
    timestamp: i64,
    allow_local: bool,
) -> Result<SkillUpdateRecord, AppError> {
    let url = validate_url(&draft.url, allow_local)?;
    let reference = validate_reference(&draft.reference)?;
    let subpath = validate_subpath(&draft.skill_subpath)?;
    let source_id = hash_text(&format!("git\0{url}\0{reference}\0{}", subpath.display()));
    if let Some(existing) = git_source_by_id(db, &source_id)? {
        return update_status_for(db, &existing);
    }

    let checkout_root = prepare_checkout_root(checkouts_root)?;
    let checkout = checkout_root.join(&source_id);
    if checkout.exists() || fs::symlink_metadata(&checkout).is_ok() {
        return Err(AppError::State(
            "Git checkout path already exists without a tracking record".to_string(),
        ));
    }
    clone_source(&url, &reference, &checkout)?;
    let revision = git_output(&checkout, ["rev-parse", "HEAD"])?;
    let skill_path = checkout.join(&subpath);
    let inspected = match skills::inspect_portable_skill(&skill_path) {
        Ok(inspected) => inspected,
        Err(error) => {
            let _ = skills::remove_if_exists(&checkout);
            return Err(error);
        }
    };
    let locator = format!("{url}#{reference}:{}", subpath.to_string_lossy());
    let imported = match skills::import_tracked_skill_directory(
        db,
        library_root,
        &skill_path,
        &source_id,
        &locator,
    ) {
        Ok(imported) => imported,
        Err(error) => {
            let _ = skills::remove_if_exists(&checkout);
            return Err(error);
        }
    };

    if let Err(error) = persist_new_source(
        db,
        &source_id,
        &imported.skill,
        &url,
        &reference,
        &subpath,
        &checkout,
        &revision,
        &inspected.content_hash,
        timestamp,
    ) {
        cleanup_failed_registration(db, &imported.skill, &checkout);
        return Err(error);
    }
    update_status_for(
        db,
        &git_source_by_id(db, &source_id)?
            .ok_or_else(|| AppError::State("Git source record is missing".to_string()))?,
    )
}

pub fn list_update_statuses(db: &Database) -> Result<Vec<SkillUpdateRecord>, AppError> {
    list_git_sources(db)?
        .iter()
        .map(|source| update_status_for(db, source))
        .collect()
}

pub fn check_git_source(
    db: &Database,
    source_id: &str,
    timestamp: i64,
) -> Result<SkillUpdateRecord, AppError> {
    let source = git_source_by_id(db, source_id)?
        .ok_or_else(|| AppError::State("Git source was not found".to_string()))?;
    let checkout = Path::new(&source.checkout_path);
    let result = (|| {
        fetch_source(checkout, &source.reference)?;
        let revision = git_output(checkout, ["rev-parse", "HEAD"])?;
        let skill_path = checkout.join(validate_subpath(&source.skill_subpath)?);
        let inspected = skills::inspect_portable_skill(&skill_path)?;
        let connection = db.connect()?;
        connection.execute(
            "UPDATE git_sources SET last_fetched_revision = ?2, last_checked_at = ?3,
                    last_error = NULL, updated_at = ?3 WHERE id = ?1",
            params![source.id, revision, timestamp],
        )?;
        connection.execute(
            "UPDATE skill_tracking SET upstream_hash = ?2, upstream_revision = ?3,
                    checked_at = ?4 WHERE git_source_id = ?1",
            params![source.id, inspected.content_hash, revision, timestamp],
        )?;
        Ok::<(), AppError>(())
    })();
    if let Err(error) = result {
        let _ = db.connect()?.execute(
            "UPDATE git_sources SET last_error = ?2, last_checked_at = ?3, updated_at = ?3
             WHERE id = ?1",
            params![source.id, error.to_string(), timestamp],
        );
        return Err(error);
    }
    update_status_for(
        db,
        &git_source_by_id(db, source_id)?
            .ok_or_else(|| AppError::State("Git source was not found after check".to_string()))?,
    )
}

pub fn promote_git_source(
    db: &Database,
    library_root: &Path,
    source_id: &str,
    timestamp: i64,
) -> Result<ImportSkillResult, AppError> {
    let source = git_source_by_id(db, source_id)?
        .ok_or_else(|| AppError::State("Git source was not found".to_string()))?;
    let status = update_status_for(db, &source)?;
    if status.status != "upstream_update" {
        return Err(AppError::State(format!(
            "Git source cannot be promoted while status is {}",
            status.status
        )));
    }
    let subpath = validate_subpath(&source.skill_subpath)?;
    let skill_path = Path::new(&source.checkout_path).join(subpath);
    let locator = format!(
        "{}#{}:{}",
        source.url, source.reference, source.skill_subpath
    );
    let imported = skills::import_tracked_skill_directory(
        db,
        library_root,
        &skill_path,
        &source.id,
        &locator,
    )?;
    if imported.skill.content_hash != status.upstream_hash {
        return Err(AppError::State(
            "upstream checkout changed during Library promotion".to_string(),
        ));
    }
    db.connect()?.execute(
        "UPDATE skill_tracking SET base_hash = upstream_hash,
                base_revision = upstream_revision, checked_at = ?2
         WHERE git_source_id = ?1",
        params![source.id, timestamp],
    )?;
    Ok(imported)
}

fn update_status_for(
    db: &Database,
    source: &GitSourceRecord,
) -> Result<SkillUpdateRecord, AppError> {
    let skill = db
        .list_skills()?
        .into_iter()
        .find(|skill| skill.id == source.skill_id)
        .ok_or_else(|| AppError::State("tracked Library Skill was not found".to_string()))?;
    let tracking = tracking_for(db, &skill.id)?;
    let library_hash = skills::inspect_managed_skill(Path::new(&skill.library_path), &skill.name)
        .ok()
        .map(|(hash, _)| hash);
    let deployments = safe_apply::list_deployments(db)?
        .into_iter()
        .filter(|deployment| deployment.skill_id == skill.id)
        .collect::<Vec<_>>();
    let mut missing = false;
    let mut drift = false;
    for deployment in deployments {
        let destination = Path::new(&deployment.destination_path);
        if !destination.exists() {
            missing = true;
            continue;
        }
        match skills::inspect_skill(destination) {
            Ok(inspected) if inspected.content_hash == deployment.deployed_hash => {}
            _ => drift = true,
        }
    }
    let status = if drift {
        "target_drift"
    } else if missing {
        "missing"
    } else {
        classify_hashes(
            &tracking.base_hash,
            library_hash.as_deref(),
            &tracking.upstream_hash,
        )
    };
    Ok(SkillUpdateRecord {
        skill_id: skill.id,
        skill_name: skill.name,
        source_id: source.id.clone(),
        source_url: source.url.clone(),
        reference: source.reference.clone(),
        base_hash: tracking.base_hash,
        library_hash,
        upstream_hash: tracking.upstream_hash,
        upstream_revision: tracking.upstream_revision,
        status: status.to_string(),
        checked_at: tracking.checked_at,
        can_promote: status == "upstream_update",
    })
}

fn classify_hashes(base: &str, library: Option<&str>, upstream: &str) -> &'static str {
    match library {
        None => "conflict",
        Some(library) if library == base && upstream == base => "clean",
        Some(library) if library == base && upstream != base => "upstream_update",
        Some(library) if library != base && upstream == base => "local_modified",
        Some(library) if library == upstream => "clean",
        Some(_) => "conflict",
    }
}

#[allow(clippy::too_many_arguments)]
fn persist_new_source(
    db: &Database,
    source_id: &str,
    skill: &SkillRecord,
    url: &str,
    reference: &str,
    subpath: &Path,
    checkout: &Path,
    revision: &str,
    content_hash: &str,
    timestamp: i64,
) -> Result<(), AppError> {
    let mut connection = db.connect()?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO git_sources (
           id, skill_id, url, reference, skill_subpath, checkout_path,
           last_fetched_revision, last_checked_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)",
        params![
            source_id,
            skill.id,
            url,
            reference,
            subpath.to_string_lossy(),
            checkout.to_string_lossy(),
            revision,
            timestamp
        ],
    )?;
    transaction.execute(
        "INSERT INTO skill_tracking (
           skill_id, git_source_id, base_hash, base_revision,
           upstream_hash, upstream_revision, checked_at
         ) VALUES (?1, ?2, ?3, ?4, ?3, ?4, ?5)",
        params![skill.id, source_id, content_hash, revision, timestamp],
    )?;
    transaction.commit()?;
    Ok(())
}

fn cleanup_failed_registration(db: &Database, skill: &SkillRecord, checkout: &Path) {
    let _ = db.connect().and_then(|connection| {
        connection.execute("DELETE FROM skills WHERE id = ?1", params![skill.id])?;
        connection.execute(
            "DELETE FROM skill_sources WHERE id NOT IN (SELECT source_id FROM skills)",
            [],
        )?;
        Ok(())
    });
    let _ = skills::remove_if_exists(Path::new(&skill.library_path));
    let _ = skills::remove_if_exists(checkout);
}

fn tracking_for(db: &Database, skill_id: &str) -> Result<TrackingRecord, AppError> {
    db.connect()?
        .query_row(
            "SELECT base_hash, base_revision, upstream_hash, upstream_revision, checked_at
             FROM skill_tracking WHERE skill_id = ?1",
            params![skill_id],
            |row| {
                Ok(TrackingRecord {
                    base_hash: row.get(0)?,
                    upstream_hash: row.get(2)?,
                    upstream_revision: row.get(3)?,
                    checked_at: row.get(4)?,
                })
            },
        )
        .map_err(AppError::from)
}

fn list_git_sources(db: &Database) -> Result<Vec<GitSourceRecord>, AppError> {
    let connection = db.connect()?;
    let mut statement = connection.prepare(
        "SELECT id, skill_id, url, reference, skill_subpath, checkout_path,
                last_fetched_revision, last_checked_at, last_error, created_at, updated_at
         FROM git_sources ORDER BY created_at, id",
    )?;
    let rows = statement.query_map([], row_to_git_source)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn git_source_by_id(db: &Database, id: &str) -> Result<Option<GitSourceRecord>, AppError> {
    Ok(db
        .connect()?
        .query_row(
            "SELECT id, skill_id, url, reference, skill_subpath, checkout_path,
                    last_fetched_revision, last_checked_at, last_error, created_at, updated_at
             FROM git_sources WHERE id = ?1",
            params![id],
            row_to_git_source,
        )
        .optional()?)
}

fn row_to_git_source(row: &rusqlite::Row<'_>) -> rusqlite::Result<GitSourceRecord> {
    Ok(GitSourceRecord {
        id: row.get(0)?,
        skill_id: row.get(1)?,
        url: row.get(2)?,
        reference: row.get(3)?,
        skill_subpath: row.get(4)?,
        checkout_path: row.get(5)?,
        last_fetched_revision: row.get(6)?,
        last_checked_at: row.get(7)?,
        last_error: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn validate_url(value: &str, allow_local: bool) -> Result<String, AppError> {
    let value = value.trim();
    if allow_local && Path::new(value).is_dir() {
        return Ok(value.to_string());
    }
    if !value.starts_with("https://") {
        return Err(AppError::State(
            "Git source URL must use https://".to_string(),
        ));
    }
    let authority = value
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return Err(AppError::State(
            "Git source URL cannot contain embedded credentials".to_string(),
        ));
    }
    Ok(value.trim_end_matches('/').to_string())
}

fn validate_reference(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty()
        || value.starts_with('-')
        || value.contains("..")
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._/-".contains(character))
    {
        return Err(AppError::State("Git reference is not valid".to_string()));
    }
    Ok(value.to_string())
}

fn validate_subpath(value: &str) -> Result<PathBuf, AppError> {
    let trimmed = value.trim();
    let path = if trimmed.is_empty() { Path::new(".") } else { Path::new(trimmed) };
    if path.is_absolute()
        || path.components().any(|component| {
            !matches!(component, Component::Normal(_) | Component::CurDir)
                || component.as_os_str() == OsStr::new(".git")
        })
    {
        return Err(AppError::State(
            "Git Skill subpath must stay inside the checkout".to_string(),
        ));
    }
    Ok(path.to_path_buf())
}

fn prepare_checkout_root(path: &Path) -> Result<PathBuf, AppError> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::State(
            "Git checkout root must be a real directory".to_string(),
        ));
    }
    Ok(path.canonicalize()?)
}

fn clone_source(url: &str, reference: &str, checkout: &Path) -> Result<(), AppError> {
    let args = vec![
        OsString::from("clone"),
        OsString::from("--no-checkout"),
        OsString::from("--single-branch"),
        OsString::from("--branch"),
        OsString::from(reference),
        OsString::from("--"),
        OsString::from(url),
        checkout.as_os_str().to_owned(),
    ];
    run_git(None, args)?;
    run_git(Some(checkout), ["checkout", "--detach", "HEAD"])?;
    Ok(())
}

fn fetch_source(checkout: &Path, reference: &str) -> Result<(), AppError> {
    run_git(
        Some(checkout),
        ["fetch", "--force", "origin", reference],
    )?;
    run_git(Some(checkout), ["checkout", "--detach", "FETCH_HEAD"])?;
    Ok(())
}

fn git_output<const N: usize>(checkout: &Path, args: [&str; N]) -> Result<String, AppError> {
    let output = git_command(Some(checkout), args).output()?;
    if !output.status.success() {
        return Err(git_failure(&output.stderr));
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|_| AppError::State("Git returned non-UTF-8 output".to_string()))
}

fn run_git<I, S>(checkout: Option<&Path>, args: I) -> Result<(), AppError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = git_command(checkout, args).output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(git_failure(&output.stderr))
    }
}

fn git_command<I, S>(checkout: Option<&Path>, args: I) -> Command
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new("git");
    if let Some(checkout) = checkout {
        command.arg("-C").arg(checkout);
    }
    command
        .arg("-c")
        .arg(format!("core.hooksPath={}", null_device()))
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0");
    command
}

fn null_device() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

fn git_failure(stderr: &[u8]) -> AppError {
    let detail = String::from_utf8_lossy(stderr);
    AppError::State(format!("Git command failed: {}", detail.trim()))
}

fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let mut output = String::with_capacity(64);
    for byte in hasher.finalize() {
        use std::fmt::Write;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use crate::{db::Database, skills};

    use super::{
        check_git_source, list_update_statuses, promote_git_source,
        register_git_source_inner, GitSourceDraft,
    };

    fn git(directory: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(directory)
            .args(args)
            .status()
            .expect("git should run");
        assert!(status.success(), "git command should succeed");
    }

    fn commit_skill(repository: &Path, body: &str) {
        let skill = repository.join("demo-skill");
        fs::create_dir_all(&skill).expect("skill should exist");
        fs::write(
            skill.join("SKILL.md"),
            format!("---\nname: demo-skill\ndescription: Git fixture.\n---\n\n{body}\n"),
        )
        .expect("manifest should write");
        git(repository, &["add", "."]);
        git(repository, &["commit", "-m", body]);
    }

    #[test]
    fn git_source_tracks_upstream_local_conflict_and_explicit_promotion() {
        let root = std::env::temp_dir().join(format!(
            "skills-manger-m6-git-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let repository = root.join("repository");
        let library = root.join("library");
        fs::create_dir_all(&repository).expect("repository should exist");
        fs::create_dir_all(&library).expect("library should exist");
        git(&repository, &["init", "--initial-branch=main"]);
        git(&repository, &["config", "user.name", "M6 Test"]);
        git(&repository, &["config", "user.email", "m6@example.invalid"]);
        commit_skill(&repository, "version one");

        let database = Database::initialize(root.join("skills.sqlite3")).expect("database");
        let draft = GitSourceDraft {
            url: repository.to_string_lossy().into_owned(),
            reference: "main".to_string(),
            skill_subpath: "demo-skill".to_string(),
        };
        let initial = register_git_source_inner(
            &database,
            &library,
            &root.join("checkouts"),
            &draft,
            10,
            true,
        )
        .expect("source should register");
        assert_eq!(initial.status, "clean");

        commit_skill(&repository, "version two");
        let update = check_git_source(&database, &initial.source_id, 20)
            .expect("source should refresh");
        assert_eq!(update.status, "upstream_update");
        assert!(update.can_promote);
        let promoted = promote_git_source(&database, &library, &initial.source_id, 30)
            .expect("upstream should promote");
        assert_eq!(promoted.outcome, "updated");
        assert_eq!(
            list_update_statuses(&database).expect("statuses should list")[0].status,
            "clean"
        );

        fs::write(
            Path::new(&promoted.skill.library_path).join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Git fixture.\n---\n\nlocal edit\n",
        )
        .expect("Library mutation should write");
        assert_eq!(
            list_update_statuses(&database).expect("statuses should list")[0].status,
            "local_modified"
        );
        commit_skill(&repository, "version three");
        let conflict = check_git_source(&database, &initial.source_id, 40)
            .expect("source should refresh");
        assert_eq!(conflict.status, "conflict");
        assert!(!conflict.can_promote);
        assert!(promote_git_source(&database, &library, &initial.source_id, 50).is_err());
        assert!(skills::inspect_managed_skill(
            Path::new(&promoted.skill.library_path),
            "demo-skill"
        )
        .is_ok());

        drop(database);
        let _ = fs::remove_dir_all(root);
    }
}
