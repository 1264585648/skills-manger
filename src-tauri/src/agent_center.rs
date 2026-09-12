use crate::{
    agent_catalog::{self, AgentDefinition, AGENTS},
    agent_discovery::{AgentTargetRecord, DiscoveryRootRecord, SkillInstanceDraft},
    claude_code,
    db::Database,
    error::AppError,
};
use rusqlite::{params, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub severity: String,
    pub path: String,
    pub message: String,
    pub suggestion: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub status: String,
    pub evidence: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub id: String,
    pub source: String,
    pub status: String,
    pub writable: bool,
    pub area_id: Option<String>,
    pub scanned_at: Option<i64>,
    pub diagnostics: Vec<Diagnostic>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub id: String,
    pub agent_id: String,
    pub root_id: String,
    pub path: String,
    pub resolved_path: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub linked: bool,
    pub diagnostics: Vec<Diagnostic>,
    pub modified_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArea {
    pub id: String,
    pub path: String,
    pub max_depth: u32,
    pub enabled: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub running: bool,
    pub cancelled: bool,
    pub completed: usize,
    pub total: usize,
    pub current: String,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
}
#[derive(Default)]
pub struct ScanController {
    pub status: Mutex<ScanStatus>,
    pub cancel: AtomicBool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CenterSnapshot {
    pub catalog: &'static [AgentDefinition],
    pub agents: Vec<AgentTargetRecord>,
    pub detections: HashMap<String, Detection>,
    pub roots: Vec<DiscoveryRootRecord>,
    pub root_details: HashMap<String, RootInfo>,
    pub skills: Vec<DiscoveredSkill>,
    pub projects: Vec<ProjectArea>,
    pub scan: ScanStatus,
    pub project_diagnostics: HashMap<String, Vec<Diagnostic>>,
}

pub fn key(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn display(path: &Path) -> String {
    let text = dunce::simplified(path).to_string_lossy().into_owned();
    if cfg!(windows) {
        text.replace('/', "\\")
    } else {
        text
    }
}
pub fn path_key(path: &Path) -> String {
    let value = display(path);
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}
pub fn now() -> i64 {
    crate::agent_discovery::unix_timestamp().unwrap_or(0)
}
fn issue(code: &str, path: &Path, message: impl Into<String>) -> Diagnostic {
    Diagnostic {
        code: code.into(),
        severity: "warning".into(),
        path: display(path),
        message: message.into(),
        suggestion: match code {
            "invalid_metadata" => "检查 SKILL.md 的 YAML 元数据",
            "network_path" => "将技能保存到本地目录后重扫",
            "scan_limit" => "缩小项目区或提高扫描深度后重扫",
            "cancelled" => "重新扫描以更新完整结果",
            _ => "检查目录和访问权限后重扫",
        }
        .into(),
    }
}
pub fn put<T: Serialize>(db: &Database, kind: &str, id: &str, value: &T) -> Result<(), AppError> {
    db.connect()?.execute("INSERT INTO agent_center_records(kind,id,payload_json) VALUES (?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET payload_json=excluded.payload_json", params![kind,id,serde_json::to_string(value)?])?;
    Ok(())
}
pub fn get<T: DeserializeOwned>(
    db: &Database,
    kind: &str,
    id: &str,
) -> Result<Option<T>, AppError> {
    let raw: Option<String> = db
        .connect()?
        .query_row(
            "SELECT payload_json FROM agent_center_records WHERE kind=?1 AND id=?2",
            params![kind, id],
            |row| row.get(0),
        )
        .optional()?;
    raw.map(|s| serde_json::from_str(&s).map_err(AppError::from))
        .transpose()
}
pub fn list<T: DeserializeOwned>(db: &Database, kind: &str) -> Result<Vec<T>, AppError> {
    let connection = db.connect()?;
    let mut statement = connection
        .prepare("SELECT payload_json FROM agent_center_records WHERE kind=?1 ORDER BY id")?;
    let rows = statement.query_map([kind], |row| row.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}
pub fn initialize(db: &Database) -> Result<(), AppError> {
    let connection = db.connect()?;
    connection.execute_batch("CREATE TABLE IF NOT EXISTS agent_center_records(kind TEXT NOT NULL,id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(kind,id));")?;
    let migrated: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_meta WHERE key='agent_center_version' AND value='2')",
        [],
        |r| r.get(0),
    )?;
    if !migrated {
        // Discovery is a rebuildable index; library, roots and deployment ownership stay intact.
        connection.execute_batch("BEGIN IMMEDIATE; DELETE FROM skill_instances; DELETE FROM agent_center_records WHERE kind='skill'; UPDATE agent_targets SET last_warning=NULL; UPDATE discovery_roots SET last_warning=NULL; INSERT INTO schema_meta(key,value) VALUES ('agent_center_version','2') ON CONFLICT(key) DO UPDATE SET value='2'; COMMIT;")?;
    }
    let existing = db.list_agent_targets()?;
    for agent in AGENTS {
        if !existing.iter().any(|a| a.id == agent.id) {
            db.upsert_agent_target(
                &AgentTargetRecord {
                    id: agent.id.into(),
                    name: agent.name.into(),
                    provider: agent.provider.into(),
                    capabilities: vec!["detect".into(), "read-skills".into(), "safe-apply".into()],
                    detected: false,
                    executable_path: None,
                    version: None,
                    last_warning: None,
                    last_scanned_at: None,
                },
                now(),
            )?;
        }
    }
    Ok(())
}
pub fn snapshot(db: &Database, controller: &ScanController) -> Result<CenterSnapshot, AppError> {
    let roots = db.list_discovery_roots()?;
    let root_ids: HashSet<_> = roots.iter().map(|r| r.id.as_str()).collect();
    let root_details = list::<RootInfo>(db, "root")?
        .into_iter()
        .filter(|r| root_ids.contains(r.id.as_str()))
        .map(|r| (r.id.clone(), r))
        .collect();
    let mut detections = HashMap::new();
    for agent in AGENTS {
        detections.insert(
            agent.id.into(),
            get(db, "detection", agent.id)?.unwrap_or_default(),
        );
    }
    let projects: Vec<ProjectArea> = list(db, "project")?;
    let mut project_diagnostics = HashMap::new();
    for area in &projects {
        project_diagnostics.insert(
            area.id.clone(),
            get(db, "project_diagnostics", &area.id)?.unwrap_or_default(),
        );
    }
    Ok(CenterSnapshot {
        catalog: AGENTS,
        agents: db.list_agent_targets()?,
        detections,
        roots: roots.clone(),
        root_details,
        project_diagnostics,
        skills: list::<DiscoveredSkill>(db, "skill")?
            .into_iter()
            .filter(|s| root_ids.contains(s.root_id.as_str()))
            .collect(),
        projects,
        scan: controller
            .status
            .lock()
            .map_err(|_| AppError::State("扫描状态不可用".into()))?
            .clone(),
    })
}
pub fn start_scan(
    db: &Database,
    library: &Path,
    controller: Arc<ScanController>,
    agent_id: Option<String>,
    root_id: Option<String>,
) -> Result<ScanStatus, AppError> {
    if agent_id
        .as_ref()
        .is_some_and(|id| agent_catalog::definition(id).is_none())
    {
        return Err(AppError::State("未知 Agent".into()));
    }
    let initial = {
        let mut state = controller
            .status
            .lock()
            .map_err(|_| AppError::State("扫描状态不可用".into()))?;
        if state.running {
            return Ok(state.clone());
        }
        controller.cancel.store(false, Ordering::Relaxed);
        *state = ScanStatus {
            running: true,
            started_at: Some(now()),
            ..Default::default()
        };
        state.clone()
    };
    let db_path = db.path().to_path_buf();
    let library = library.to_path_buf();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let db = Database::initialize(db_path)?;
            scan(
                &db,
                &library,
                &controller,
                agent_id.as_deref(),
                root_id.as_deref(),
            )
        }));
        if let Ok(mut state) = controller.status.lock() {
            state.running = false;
            state.finished_at = Some(now());
            state.cancelled = controller.cancel.load(Ordering::Relaxed);
            state.error = match result {
                Ok(Ok(())) => None,
                Ok(Err(e)) => Some(e.to_string()),
                Err(_) => Some("扫描中断，请重试".into()),
            };
        }
    });
    Ok(initial)
}

pub fn save_project(
    db: &Database,
    path: &Path,
    max_depth: u32,
    enabled: bool,
) -> Result<ProjectArea, AppError> {
    if !(1..=12).contains(&max_depth) {
        return Err(AppError::State("扫描深度应为 1 至 12".into()));
    }
    let canonical = resolve_local(path)?;
    if !canonical.is_dir() {
        return Err(AppError::State("请选择项目父目录".into()));
    }
    let project = ProjectArea {
        id: key(&path_key(&canonical)),
        path: display(&canonical),
        max_depth,
        enabled,
    };
    put(db, "project", &project.id, &project)?;
    Ok(project)
}
pub fn remove_project(db: &Database, id: &str) -> Result<(), AppError> {
    db.connect()?.execute(
        "DELETE FROM agent_center_records WHERE kind='project' AND id=?1",
        [id],
    )?;
    for root in list::<RootInfo>(db, "root")?
        .into_iter()
        .filter(|r| r.area_id.as_deref() == Some(id))
    {
        set_root_enabled(db, &root.id, false)?;
    }
    Ok(())
}
pub fn set_root_enabled(db: &Database, id: &str, enabled: bool) -> Result<(), AppError> {
    let changed = db.connect()?.execute(
        "UPDATE discovery_roots SET enabled=?2 WHERE id=?1",
        params![id, enabled],
    )?;
    if changed == 0 {
        return Err(AppError::State("目录记录不存在".into()));
    }
    Ok(())
}
pub fn register_root(
    db: &Database,
    agent_id: &str,
    path: &Path,
    scope: &str,
    source: &str,
    area_id: Option<String>,
) -> Result<DiscoveryRootRecord, AppError> {
    if agent_catalog::definition(agent_id).is_none() || !["user", "project"].contains(&scope) {
        return Err(AppError::State("无效的 Agent 或目录范围".into()));
    }
    let configured = display(path);
    let previous = db.list_discovery_roots()?.into_iter().find(|r| {
        r.agent_id == agent_id
            && r.scope == scope
            && path_key(Path::new(&r.configured_path)) == path_key(path)
    });
    let id = previous
        .as_ref()
        .map(|r| r.id.clone())
        .unwrap_or_else(|| key(&format!("{agent_id}\0{scope}\0{}", path_key(path))));
    let resolved = resolve_local(path).ok();
    let available = resolved.as_ref().is_some_and(|p| p.is_dir());
    let metadata = resolved.as_ref().and_then(|p| fs::metadata(p).ok());
    let writable = !matches!(source, "plugin" | "system")
        && metadata.is_none_or(|m| !m.permissions().readonly());
    let record = DiscoveryRootRecord {
        id: id.clone(),
        agent_id: agent_id.into(),
        scope: scope.into(),
        configured_path: configured,
        canonical_path: resolved.as_ref().map(|p| display(p)),
        enabled: previous.as_ref().is_none_or(|r| r.enabled),
        is_default: scope == "user" && source != "custom",
        last_warning: None,
    };
    db.upsert_discovery_root(&record, now())?;
    let prior: Option<RootInfo> = get(db, "root", &id)?;
    put(
        db,
        "root",
        &id,
        &RootInfo {
            id: id.clone(),
            source: source.into(),
            status: if available {
                prior
                    .as_ref()
                    .map(|p| p.status.as_str())
                    .unwrap_or("pending")
            } else {
                "absent"
            }
            .into(),
            writable,
            area_id,
            scanned_at: prior.as_ref().and_then(|p| p.scanned_at),
            diagnostics: prior.map(|p| p.diagnostics).unwrap_or_default(),
        },
    )?;
    Ok(record)
}
pub fn is_network(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.starts_with("\\\\?\\UNC\\")
        || (s.starts_with("\\\\") && !s.starts_with("\\\\?\\"))
        || s.starts_with("//")
}
pub fn resolve_local(path: &Path) -> Result<PathBuf, AppError> {
    if is_network(path) {
        return Err(AppError::State("默认跳过网络目录".into()));
    }
    // Inspect link endpoints before canonicalization, which could otherwise contact a network share.
    let mut next = path.to_path_buf();
    let mut seen = HashSet::new();
    for _ in 0..32 {
        if !seen.insert(path_key(&next)) {
            return Err(AppError::State("目录链接存在循环".into()));
        }
        if is_network(&next) {
            return Err(AppError::State("默认跳过网络目录".into()));
        }
        match fs::read_link(&next) {
            Ok(target) => {
                next = if target.is_absolute() {
                    target
                } else {
                    next.parent().unwrap_or(Path::new(".")).join(target)
                }
            }
            Err(_) => {
                let resolved = dunce::canonicalize(&next)?;
                if is_network(&resolved) {
                    return Err(AppError::State("默认跳过网络目录".into()));
                }
                return Ok(resolved);
            }
        }
    }
    Err(AppError::State("目录链接层数超过上限".into()))
}
fn expand_path(value: &str, home: &Path, base: &Path) -> PathBuf {
    if let Some(s) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        home.join(s)
    } else {
        let p = PathBuf::from(value);
        if p.is_absolute() {
            p
        } else {
            base.join(p)
        }
    }
}
fn read_json(path: &Path) -> Option<serde_json::Value> {
    bounded_text(path, 2 * 1024 * 1024)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}
pub fn bounded_text(path: &Path, limit: u64) -> Result<String, AppError> {
    let path = resolve_local(path)?;
    let file = fs::File::open(&path)?;
    if !file.metadata()?.is_file() {
        return Err(AppError::State("不是普通文件".into()));
    }
    let mut buffer = Vec::new();
    file.take(limit + 1).read_to_end(&mut buffer)?;
    if buffer.len() as u64 > limit {
        return Err(AppError::State("文件超过读取上限".into()));
    }
    String::from_utf8(buffer).map_err(|_| AppError::State("文件不是有效 UTF-8".into()))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct InstalledApp {
    display_name: Option<String>,
    display_version: Option<String>,
    install_location: Option<String>,
}
fn installed_apps() -> Vec<InstalledApp> {
    #[cfg(windows)]
    {
        use winreg::{
            enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
            RegKey,
        };
        let mut apps = Vec::new();
        for (hive, path) in [
            (
                HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
            ),
            (
                HKEY_LOCAL_MACHINE,
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
            ),
            (
                HKEY_LOCAL_MACHINE,
                r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            ),
        ] {
            if let Ok(parent) = RegKey::predef(hive).open_subkey(path) {
                for name in parent.enum_keys().flatten() {
                    if let Ok(app) = parent.open_subkey(name) {
                        apps.push(InstalledApp {
                            display_name: app.get_value("DisplayName").ok(),
                            display_version: app.get_value("DisplayVersion").ok(),
                            install_location: app.get_value("InstallLocation").ok(),
                        });
                    }
                }
            }
        }
        apps
    }
    #[cfg(not(windows))]
    Vec::new()
}
fn discover_install(
    agent: &AgentDefinition,
    home: &Path,
    apps: &[InstalledApp],
) -> (Detection, Option<String>, Option<String>) {
    let mut evidence = Vec::new();
    let mut executable = None;
    let mut version = None;
    for app in apps {
        if let Some(name) = &app.display_name {
            let name_lower = name.to_lowercase();
            if agent.app_names.iter().any(|alias| {
                name_lower == alias.to_lowercase()
                    || name_lower.starts_with(&format!("{} ", alias.to_lowercase()))
            }) && !(agent.id == "trae"
                && (name_lower.contains("cn") || name_lower.contains("国内")))
            {
                if let Some(location) = &app.install_location {
                    if Path::new(location).is_dir() {
                        evidence.push(format!("已安装应用：{name} ({location})"));
                        version = app.display_version.clone();
                    }
                }
            }
        }
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        for command in agent.commands {
            for suffix in if cfg!(windows) {
                vec![".exe", ".cmd", ".bat", ""]
            } else {
                vec![""]
            } {
                let candidate = dir.join(format!("{command}{suffix}"));
                if !is_network(&candidate) && candidate.is_file() {
                    executable = Some(display(&candidate));
                    evidence.push(format!("命令：{}", display(&candidate)));
                    break;
                }
            }
            if executable.is_some() {
                break;
            }
        }
        if executable.is_some() {
            break;
        }
    }
    let mut app_bases = Vec::new();
    for env in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(p) = std::env::var_os(env) {
            app_bases.push(PathBuf::from(&p));
            app_bases.push(PathBuf::from(p).join("Programs"));
        }
    }
    app_bases.extend([PathBuf::from("/Applications"), home.join("Applications")]);
    for base in &app_bases {
        for name in agent.app_names {
            for candidate in [
                base.join(name).join(format!("{name}.exe")),
                base.join(format!("{name}.app"))
                    .join("Contents/MacOS")
                    .join(name),
            ] {
                if !is_network(&candidate) && candidate.is_file() {
                    evidence.push(format!("应用：{}", display(&candidate)));
                    executable.get_or_insert(display(&candidate));
                    if let Some(json) = read_json(
                        &candidate
                            .parent()
                            .unwrap()
                            .join("resources/app/package.json"),
                    ) {
                        version = json
                            .get("version")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                    }
                }
            }
        }
    }
    for base in [
        ".vscode/extensions",
        ".vscode-insiders/extensions",
        ".cursor/extensions",
        ".windsurf/extensions",
    ] {
        if let Ok(entries) = fs::read_dir(home.join(base)) {
            for entry in entries.flatten().take(1000) {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if agent
                    .extensions
                    .iter()
                    .any(|id| name.starts_with(&format!("{id}-")))
                {
                    if let Some(json) = read_json(&entry.path().join("package.json")) {
                        evidence.push(format!("扩展：{}", display(&entry.path())));
                        version = version.or_else(|| {
                            json.get("version")
                                .and_then(|v| v.as_str())
                                .map(str::to_owned)
                        });
                    }
                }
            }
        }
    }
    (
        Detection {
            status: if evidence.is_empty() {
                "not-found"
            } else {
                "installed"
            }
            .into(),
            evidence,
            diagnostics: vec![],
        },
        executable,
        version,
    )
}

fn register_user_roots(
    db: &Database,
    agent: &AgentDefinition,
    home: &Path,
    installed: bool,
) -> Result<(), AppError> {
    for (index, relative) in agent.user_roots.iter().enumerate() {
        let path = home.join(relative);
        // A shared folder is evidence of skills, never evidence that a consuming product is installed.
        let native = !relative.starts_with(".agents/")
            && (!matches!(agent.id, "cursor" | "opencode")
                || !(relative.starts_with(".claude/") || relative.starts_with(".codex/")));
        if agent.id == "openclaw"
            && relative.starts_with(".agents/")
            && std::env::var_os("OPENCLAW_STATE_DIR")
                .is_some_and(|p| path_key(Path::new(&p)) != path_key(&home.join(".openclaw")))
        {
            continue;
        }
        if path.is_dir() && (native || installed) || (index == 0 && installed) {
            register_root(
                db,
                agent.id,
                &path,
                "user",
                if relative.starts_with(".agents/") {
                    "shared"
                } else {
                    "native"
                },
                None,
            )?;
        }
    }
    let env_root = match agent.id {
        "codex" => Some(("CODEX_HOME", ".codex")),
        "claude-code" => Some(("CLAUDE_CONFIG_DIR", ".claude")),
        "kimi-code" => Some(("KIMI_CODE_HOME", ".kimi-code")),
        "openclaw" => Some(("OPENCLAW_STATE_DIR", ".openclaw")),
        "opencode" => Some(("XDG_CONFIG_HOME", ".config")),
        _ => None,
    };
    if let Some((variable, _)) = env_root {
        if let Some(value) = std::env::var_os(variable) {
            let base = PathBuf::from(value);
            let path = if agent.id == "opencode" {
                base.join("opencode/skills")
            } else {
                base.join("skills")
            };
            register_root(db, agent.id, &path, "user", "config", None)?;
        }
    }
    if agent.id == "codex" {
        let base = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        let system = base.join("skills/.system");
        if system.is_dir() {
            register_root(db, agent.id, &system, "user", "system", None)?;
        }
        discover_plugin_roots(db, agent.id, &base.join("plugins"), 0)?;
    }
    if agent.id == "claude-code" {
        discover_plugin_roots(db, agent.id, &home.join(".claude/plugins/cache"), 0)?;
    }
    if agent.id == "gemini-cli" {
        discover_plugin_roots(db, agent.id, &home.join(".gemini/extensions"), 0)?;
    }
    if agent.id == "qwen-code" {
        discover_plugin_roots(db, agent.id, &home.join(".qwen/extensions"), 0)?;
    }
    if agent.id == "windsurf" {
        if let Some(base) = std::env::var_os("ProgramData") {
            let path = PathBuf::from(base).join("Windsurf/skills");
            if path.is_dir() {
                register_root(db, agent.id, &path, "user", "system", None)?;
            }
        }
    }
    if agent.id == "kimi-code" {
        let base = std::env::var_os("KIMI_CODE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".kimi-code"));
        if let Ok(raw) = bounded_text(&base.join("config.toml"), 1024 * 1024) {
            {
                let config = toml::from_str::<toml::Value>(&raw)
                    .map_err(|_| AppError::State("Kimi 配置格式无效，额外目录未扫描".into()))?;
                if let Some(paths) = config.get("extra_skill_dirs").and_then(|v| v.as_array()) {
                    for p in paths.iter().filter_map(|v| v.as_str()) {
                        register_root(
                            db,
                            agent.id,
                            &expand_path(p, home, &base),
                            "user",
                            "config",
                            None,
                        )?;
                    }
                }
            }
        }
    }
    if agent.id == "openclaw" {
        let base = std::env::var_os("OPENCLAW_STATE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".openclaw"));
        if let Ok(raw) = bounded_text(&base.join("openclaw.json"), 2 * 1024 * 1024) {
            {
                let config = json5::from_str::<serde_json::Value>(&raw)
                    .map_err(|_| AppError::State("OpenClaw 配置格式无效，额外目录未扫描".into()))?;
                let mut workspaces = Vec::new();
                if let Some(p) = config
                    .pointer("/agents/defaults/workspace")
                    .and_then(|v| v.as_str())
                {
                    workspaces.push(p.to_string());
                }
                for field in ["list", "entries"] {
                    if let Some(items) = config.pointer(&format!("/agents/{field}")) {
                        let values: Vec<_> = if let Some(a) = items.as_array() {
                            a.iter().collect()
                        } else if let Some(m) = items.as_object() {
                            m.values().collect()
                        } else {
                            vec![]
                        };
                        for item in values {
                            if let Some(p) = item.get("workspace").and_then(|v| v.as_str()) {
                                workspaces.push(p.into());
                            }
                        }
                    }
                }
                if workspaces.is_empty() {
                    workspaces.push(display(&base.join("workspace")));
                }
                for workspace in workspaces {
                    let p = expand_path(&workspace, home, &base);
                    for relative in ["skills", ".agents/skills"] {
                        let root = p.join(relative);
                        if root.is_dir() {
                            register_root(db, agent.id, &root, "project", "config", None)?;
                        }
                    }
                }
                if let Some(paths) = config
                    .pointer("/skills/load/extraDirs")
                    .and_then(|v| v.as_array())
                {
                    for p in paths.iter().filter_map(|v| v.as_str()) {
                        register_root(
                            db,
                            agent.id,
                            &expand_path(p, home, &base),
                            "user",
                            "config",
                            None,
                        )?;
                    }
                }
            }
        }
    }
    Ok(())
}
fn discover_plugin_roots(
    db: &Database,
    agent_id: &str,
    path: &Path,
    depth: u32,
) -> Result<(), AppError> {
    if depth > 5 || is_network(path) {
        return Ok(());
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten().take(200) {
            let p = entry.path();
            let kind = entry.file_type()?;
            if kind.is_symlink() || !kind.is_dir() {
                continue;
            }
            if entry.file_name() == "skills" {
                register_root(db, agent_id, &p, "user", "plugin", None)?;
            } else if entry.file_name() != "node_modules" && entry.file_name() != ".git" {
                discover_plugin_roots(db, agent_id, &p, depth + 1)?;
            }
        }
    }
    Ok(())
}

fn discover_projects(
    db: &Database,
    controller: &ScanController,
    selected: Option<&str>,
) -> Result<(), AppError> {
    for area in list::<ProjectArea>(db, "project")?
        .into_iter()
        .filter(|a| a.enabled)
    {
        let mut queue = vec![(PathBuf::from(&area.path), 0)];
        let mut count = 0;
        let started = Instant::now();
        let mut diagnostics = Vec::new();
        while let Some((path, depth)) = queue.pop() {
            if controller.cancel.load(Ordering::Relaxed) {
                break;
            }
            count += 1;
            if count > 20000 || started.elapsed() > Duration::from_secs(20) {
                diagnostics.push(issue(
                    "scan_limit",
                    &path,
                    "项目区扫描达到上限，结果未完整更新",
                ));
                break;
            }
            for agent in AGENTS
                .iter()
                .filter(|a| selected.is_none_or(|id| id == a.id))
            {
                for relative in agent.project_roots {
                    let root = path.join(relative);
                    if root.is_dir() {
                        register_root(
                            db,
                            agent.id,
                            &root,
                            "project",
                            if relative.starts_with(".agents/") {
                                "shared"
                            } else {
                                "native"
                            },
                            Some(area.id.clone()),
                        )?;
                    }
                }
            }
            match fs::read_dir(&path) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if name.starts_with('.')
                            || ["node_modules", "target", "dist", "build", "vendor", "out"]
                                .contains(&name.as_str())
                        {
                            continue;
                        }
                        if entry
                            .file_type()
                            .is_ok_and(|t| t.is_dir() && !t.is_symlink())
                        {
                            if depth < area.max_depth {
                                queue.push((entry.path(), depth + 1));
                            } else if !diagnostics
                                .iter()
                                .any(|d: &Diagnostic| d.code == "scan_limit")
                            {
                                diagnostics.push(issue(
                                    "scan_limit",
                                    &path,
                                    "已达到项目区扫描深度",
                                ));
                            }
                        }
                    }
                }
                Err(error) => diagnostics.push(issue("unreadable", &path, error.to_string())),
            }
        }
        put(db, "project_diagnostics", &area.id, &diagnostics)?;
    }
    Ok(())
}

#[derive(Clone)]
struct Document {
    relative: PathBuf,
    resolved: PathBuf,
    name: Option<String>,
    description: Option<String>,
    linked: bool,
    modified: Option<i64>,
    diagnostics: Vec<Diagnostic>,
}
#[derive(Clone, Default)]
struct ScanResult {
    documents: Vec<Document>,
    diagnostics: Vec<Diagnostic>,
    complete: bool,
}
fn parse_document(path: &Path, relative: PathBuf, linked: bool) -> Document {
    let mut document = Document {
        relative,
        resolved: resolve_local(path).unwrap_or_else(|_| path.into()),
        name: None,
        description: None,
        linked,
        modified: None,
        diagnostics: Vec::new(),
    };
    let manifest = path.join("SKILL.md");
    document.modified = fs::metadata(&manifest)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    let result = (|| {
        let raw = bounded_text(&manifest, 1024 * 1024)?;
        let mut lines = raw.trim_start_matches('\u{feff}').lines();
        if lines.next().map(str::trim) != Some("---") {
            return Err(AppError::State("SKILL.md 缺少 YAML 头部".into()));
        }
        let mut yaml = Vec::new();
        let mut closed = false;
        for line in lines {
            if line.trim() == "---" {
                closed = true;
                break;
            }
            yaml.push(line);
        }
        if !closed {
            return Err(AppError::State("YAML 头部缺少结束分隔符".into()));
        }
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml.join("\n"))?;
        if !value.is_mapping() {
            return Err(AppError::State("YAML 头部应为字段映射".into()));
        }
        document.name = value
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned);
        document.description = value
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        Ok::<_, AppError>(())
    })();
    if let Err(error) = result {
        document
            .diagnostics
            .push(issue("invalid_metadata", &manifest, error.to_string()));
    }
    document
}
fn read_root(path: &Path, controller: &ScanController) -> ScanResult {
    let mut result = ScanResult {
        complete: true,
        ..Default::default()
    };
    let mut queue = vec![(path.to_path_buf(), 0, HashSet::new())];
    let started = Instant::now();
    let mut count = 0;
    while let Some((current, depth, mut ancestors)) = queue.pop() {
        if controller.cancel.load(Ordering::Relaxed) {
            result.complete = false;
            break;
        }
        count += 1;
        if count > 10000 || started.elapsed() > Duration::from_secs(8) {
            result.complete = false;
            result
                .diagnostics
                .push(issue("scan_limit", path, "技能目录扫描达到上限"));
            break;
        }
        let relative = current
            .strip_prefix(path)
            .unwrap_or(Path::new(""))
            .to_path_buf();
        let resolved = match resolve_local(&current) {
            Ok(p) => p,
            Err(e) => {
                result.complete = false;
                let linked =
                    fs::symlink_metadata(&current).is_ok_and(|m| m.file_type().is_symlink());
                let diagnostic = issue(
                    if linked { "broken_link" } else { "unreadable" },
                    &current,
                    if linked {
                        "目录链接的目标不可访问或已不存在".into()
                    } else {
                        e.to_string()
                    },
                );
                if linked {
                    result.documents.push(Document {
                        relative,
                        resolved: current.clone(),
                        name: current
                            .file_name()
                            .map(|s| s.to_string_lossy().into_owned()),
                        description: None,
                        linked: true,
                        modified: None,
                        diagnostics: vec![diagnostic],
                    });
                } else {
                    result.diagnostics.push(diagnostic);
                }
                continue;
            }
        };
        if !ancestors.insert(path_key(&resolved)) {
            result.complete = false;
            result
                .diagnostics
                .push(issue("link_cycle", &current, "检测到循环目录链接"));
            continue;
        }
        let linked = path_key(&current) != path_key(&resolved);
        if fs::symlink_metadata(current.join("SKILL.md")).is_ok() {
            result
                .documents
                .push(parse_document(&current, relative, linked));
            continue;
        }
        if depth >= 6 {
            result.complete = false;
            result
                .diagnostics
                .push(issue("scan_limit", &current, "技能嵌套层数超过 6"));
            continue;
        }
        match fs::read_dir(&resolved) {
            Ok(entries) => {
                for entry in entries {
                    let entry = match entry {
                        Ok(e) => e,
                        Err(e) => {
                            result.complete = false;
                            result
                                .diagnostics
                                .push(issue("unreadable", &current, e.to_string()));
                            continue;
                        }
                    };
                    let name = entry.file_name();
                    let text = name.to_string_lossy();
                    if text.starts_with('.')
                        || [
                            "node_modules",
                            "target",
                            "dist",
                            "build",
                            "scripts",
                            "references",
                            "assets",
                        ]
                        .contains(&text.as_ref())
                    {
                        continue;
                    }
                    match entry.file_type() {
                        Ok(kind) if kind.is_dir() || kind.is_symlink() => {
                            queue.push((current.join(name), depth + 1, ancestors.clone()))
                        }
                        Ok(_) => {}
                        Err(e) => {
                            result.complete = false;
                            result.diagnostics.push(issue(
                                "unreadable",
                                &entry.path(),
                                e.to_string(),
                            ));
                        }
                    }
                }
            }
            Err(e) => {
                result.complete = false;
                result
                    .diagnostics
                    .push(issue("unreadable", &current, e.to_string()));
            }
        }
    }
    result
}

pub fn scan(
    db: &Database,
    library: &Path,
    controller: &ScanController,
    selected: Option<&str>,
    selected_root: Option<&str>,
) -> Result<(), AppError> {
    let home =
        claude_code::current_home().ok_or_else(|| AppError::State("无法获取用户目录".into()))?;
    if selected_root.is_none() {
        let apps = installed_apps();
        for agent in AGENTS
            .iter()
            .filter(|a| selected.is_none_or(|id| id == a.id))
        {
            if controller.cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let (mut detection, executable, version) = discover_install(agent, &home, &apps);
            if let Err(e) = register_user_roots(db, agent, &home, detection.status == "installed") {
                detection
                    .diagnostics
                    .push(issue("config_error", &home, e.to_string()));
            }
            let has_config = agent
                .user_roots
                .iter()
                .any(|r| !r.starts_with(".agents/") && home.join(r).is_dir());
            if detection.status != "installed" && has_config {
                detection.status = "configured".into();
            }
            db.upsert_agent_target(
                &AgentTargetRecord {
                    id: agent.id.into(),
                    name: agent.name.into(),
                    provider: agent.provider.into(),
                    capabilities: vec!["detect".into(), "read-skills".into(), "safe-apply".into()],
                    detected: detection.status == "installed",
                    executable_path: executable,
                    version,
                    last_warning: None,
                    last_scanned_at: Some(now()),
                },
                now(),
            )?;
            put(db, "detection", agent.id, &detection)?;
        }
        discover_projects(db, controller, selected)?;
    }
    let projects = list::<ProjectArea>(db, "project")?;
    let roots: Vec<_> = db
        .list_discovery_roots()?
        .into_iter()
        .filter(|r| {
            r.enabled
                && selected.is_none_or(|id| r.agent_id == id)
                && selected_root.is_none_or(|id| r.id == id)
        })
        .collect();
    if let Ok(mut state) = controller.status.lock() {
        state.total = roots.len();
    }
    let mut cache: HashMap<String, ScanResult> = HashMap::new();
    for root in roots {
        if controller.cancel.load(Ordering::Relaxed) {
            break;
        }
        let mut info: RootInfo = get(db, "root", &root.id)?.unwrap_or(RootInfo {
            id: root.id.clone(),
            source: "custom".into(),
            status: "pending".into(),
            writable: true,
            area_id: None,
            scanned_at: None,
            diagnostics: vec![],
        });
        if info
            .area_id
            .as_ref()
            .is_some_and(|id| !projects.iter().any(|a| a.id == *id && a.enabled))
        {
            continue;
        }
        if let Ok(mut state) = controller.status.lock() {
            state.current = format!(
                "{} · {}",
                agent_catalog::definition(&root.agent_id)
                    .map(|a| a.name)
                    .unwrap_or(&root.agent_id),
                root.configured_path
            );
        }
        let configured = Path::new(&root.configured_path);
        let mut updated = root.clone();
        let result = match resolve_local(configured) {
            Ok(real) if real.starts_with(dunce::simplified(library)) => ScanResult {
                diagnostics: vec![issue(
                    "managed_library",
                    configured,
                    "技能库不能作为 Agent 扫描目录",
                )],
                ..Default::default()
            },
            Ok(real) => {
                updated.canonical_path = Some(display(&real));
                cache
                    .entry(path_key(&real))
                    .or_insert_with(|| read_root(&real, controller))
                    .clone()
            }
            Err(e) => {
                updated.canonical_path = None;
                let missing = matches!(&e,AppError::Io(io) if io.kind()==std::io::ErrorKind::NotFound)
                    && fs::symlink_metadata(configured).is_err();
                info.status = if missing { "absent" } else { "unavailable" }.into();
                ScanResult {
                    diagnostics: if missing {
                        vec![]
                    } else {
                        vec![issue("unreadable", configured, e.to_string())]
                    },
                    ..Default::default()
                }
            }
        };
        let mut found = Vec::new();
        for document in &result.documents {
            let path = configured.join(&document.relative);
            let id = key(&format!(
                "{}\0{}\0{}",
                root.agent_id,
                root.id,
                path_key(&path)
            ));
            let mut diagnostics = document.diagnostics.clone();
            if document.diagnostics.is_empty() {
                if document.name.is_none()
                    && !["claude-code", "openclaw"].contains(&root.agent_id.as_str())
                {
                    diagnostics.push(issue(
                        "invalid_metadata",
                        &path.join("SKILL.md"),
                        "缺少 name，当前以目录名展示",
                    ));
                }
                if document
                    .description
                    .as_ref()
                    .is_none_or(|d| d.trim().is_empty())
                    && root.agent_id != "claude-code"
                {
                    diagnostics.push(issue(
                        "invalid_metadata",
                        &path.join("SKILL.md"),
                        "缺少 description",
                    ));
                }
            }
            let skill = DiscoveredSkill {
                id: id.clone(),
                agent_id: root.agent_id.clone(),
                root_id: root.id.clone(),
                path: display(&path),
                resolved_path: display(&document.resolved),
                name: document.name.clone().unwrap_or_else(|| {
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                }),
                description: document.description.clone().unwrap_or_default(),
                status: if diagnostics.is_empty() {
                    "present"
                } else {
                    "invalid"
                }
                .into(),
                linked: document.linked
                    || path_key(configured)
                        != updated
                            .canonical_path
                            .as_deref()
                            .map(Path::new)
                            .map(path_key)
                            .unwrap_or_default(),
                diagnostics,
                modified_at: document.modified,
            };
            put(db, "skill", &id, &skill)?;
            found.push(skill);
        }
        let mut previous = list::<DiscoveredSkill>(db, "skill")?
            .into_iter()
            .filter(|s| s.root_id == root.id)
            .collect::<Vec<_>>();
        for skill in &mut previous {
            if !found.iter().any(|s| s.id == skill.id) {
                if result.complete && Path::new(&skill.path).is_dir() {
                    skill.status = "invalid".into();
                    skill.diagnostics = vec![issue(
                        "missing_manifest",
                        &Path::new(&skill.path).join("SKILL.md"),
                        "原技能目录缺少 SKILL.md",
                    )];
                } else {
                    skill.status = if result.complete { "missing" } else { "stale" }.into();
                }
                put(db, "skill", &skill.id, skill)?;
            }
        }
        let drafts: Vec<_> = previous
            .iter()
            .filter(|s| s.status != "missing")
            .map(|s| SkillInstanceDraft {
                id: s.id.clone(),
                agent_id: s.agent_id.clone(),
                root_id: s.root_id.clone(),
                scope: root.scope.clone(),
                path: s.path.clone(),
                name: s.name.clone(),
                description: s.description.clone(),
                content_hash: String::new(),
                script_count: 0,
            })
            .collect();
        db.reconcile_root_instances(&root.id, &drafts, now())?;
        if updated.canonical_path.is_some() {
            info.status = if result.complete && result.diagnostics.is_empty() {
                "ready"
            } else {
                "partial"
            }
            .into();
        }
        info.diagnostics = result.diagnostics;
        info.scanned_at = Some(now());
        updated.last_warning = None;
        db.connect()?.execute("UPDATE discovery_roots SET canonical_path=?2,last_warning=NULL,updated_at=?3 WHERE id=?1",params![updated.id,updated.canonical_path,now()])?;
        put(db, "root", &root.id, &info)?;
        if let Ok(mut state) = controller.status.lock() {
            state.completed += 1;
        }
    }
    Ok(())
}

pub fn skill_content(db: &Database, id: &str) -> Result<String, AppError> {
    let skill: DiscoveredSkill =
        get(db, "skill", id)?.ok_or_else(|| AppError::State("技能不存在，请重新扫描".into()))?;
    bounded_text(&Path::new(&skill.path).join("SKILL.md"), 1024 * 1024)
}

pub fn assert_writable_root(db: &Database, path: &Path) -> Result<(), AppError> {
    let library = db.path().parent().unwrap_or(Path::new(".")).join("library");
    if resolve_local(&library).is_ok_and(|p| path.starts_with(p)) {
        return Err(AppError::State("不能将技能库本身作为安装目标".into()));
    }
    let roots = db.list_discovery_roots()?;
    // Protect aliases of plugin/system roots as well as their original registered path.
    {
        let details = list::<RootInfo>(db, "root")?;
        for info in details
            .into_iter()
            .filter(|r| matches!(r.source.as_str(), "plugin" | "system"))
        {
            if let Some(root) = roots.iter().find(|r| r.id == info.id) {
                if resolve_local(Path::new(&root.configured_path))
                    .is_ok_and(|real| path.starts_with(real))
                {
                    return Err(AppError::State(
                        "插件和系统目录仅供查看，请选择用户或项目目录".into(),
                    ));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "agent-center-{label}-{}-{}",
            std::process::id(),
            key(&format!("{:?}", Instant::now()))
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn metadata_discovery_accepts_missing_name_without_hashing_scripts() {
        let p = fixture("metadata");
        fs::write(
            p.join("SKILL.md"),
            "\u{feff}---\ndescription: 中文描述\n---\n# Body",
        )
        .unwrap();
        let d = parse_document(&p, PathBuf::new(), false);
        assert!(d.diagnostics.is_empty());
        assert!(d.name.is_none());
        assert_eq!(d.description.as_deref(), Some("中文描述"));
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn malformed_skill_does_not_hide_siblings_and_scan_can_cancel() {
        let p = fixture("invalid");
        for name in ["good", "bad"] {
            fs::create_dir(p.join(name)).unwrap();
        }
        fs::write(
            p.join("good/SKILL.md"),
            "---\nname: good\ndescription: valid\n---",
        )
        .unwrap();
        fs::write(p.join("bad/SKILL.md"), "---\nname: [\n---").unwrap();
        let controller = ScanController::default();
        let scan = read_root(&p, &controller);
        assert_eq!(scan.documents.len(), 2);
        assert_eq!(
            scan.documents
                .iter()
                .filter(|d| !d.diagnostics.is_empty())
                .count(),
            1
        );
        controller.cancel.store(true, Ordering::Relaxed);
        assert!(!read_root(&p, &controller).complete);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn shared_paths_keep_agent_associations_and_disabled_roots_survive() {
        let p = fixture("shared");
        let db = Database::initialize(p.join("db.sqlite")).unwrap();
        initialize(&db).unwrap();
        let a = register_root(&db, "claude-code", &p, "user", "native", None).unwrap();
        let b = register_root(&db, "codex", &p, "user", "native", None).unwrap();
        assert_ne!(a.id, b.id);
        set_root_enabled(&db, &a.id, false).unwrap();
        assert!(
            !register_root(&db, "claude-code", &p, "user", "native", None)
                .unwrap()
                .enabled
        );
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    #[ignore = "read-only inventory of the current Windows user's Agent directories"]
    fn inventory_current_user() {
        let output = PathBuf::from(
            std::env::var_os("AGENT_CENTER_QA_DIR").expect("set AGENT_CENTER_QA_DIR"),
        );
        fs::create_dir_all(&output).unwrap();
        let db = Database::initialize(output.join("inventory.sqlite3")).unwrap();
        initialize(&db).unwrap();
        let library = output.join("library");
        fs::create_dir_all(&library).unwrap();
        let controller = ScanController::default();
        scan(&db, &library, &controller, None, None).unwrap();
        let result = snapshot(&db, &controller).unwrap();
        fs::write(
            output.join("snapshot.json"),
            serde_json::to_string_pretty(&result).unwrap(),
        )
        .unwrap();
        println!(
            "products={} installed={} roots={} skill_instances={}",
            result.agents.len(),
            result.agents.iter().filter(|a| a.detected).count(),
            result.roots.len(),
            result.skills.len()
        );
        assert_eq!(result.agents.len(), 15);
        let claude = result
            .skills
            .iter()
            .filter(|s| s.agent_id == "claude-code")
            .collect::<Vec<_>>();
        println!(
            "claude_skills={} linked={}",
            claude.len(),
            claude.iter().filter(|s| s.linked).count()
        );
        assert!(!result.skills.iter().any(|s| s
            .diagnostics
            .iter()
            .any(|d| d.message.contains("symbolic links are not supported"))));
    }

    #[test]
    fn shared_instances_keep_identity_and_unavailable_roots_keep_last_results() {
        let p = fixture("identity");
        let root = p.join("shared");
        let library = p.join("library");
        fs::create_dir_all(root.join("demo")).unwrap();
        fs::create_dir_all(&library).unwrap();
        fs::write(
            root.join("demo/SKILL.md"),
            "---\nname: demo\ndescription: fixture\n---",
        )
        .unwrap();
        let db = Database::initialize(p.join("db.sqlite")).unwrap();
        initialize(&db).unwrap();
        let ctl = ScanController::default();
        let a = register_root(&db, "claude-code", &root, "user", "shared", None).unwrap();
        let b = register_root(&db, "codex", &root, "user", "shared", None).unwrap();
        scan(&db, &library, &ctl, None, Some(&a.id)).unwrap();
        scan(&db, &library, &ctl, None, Some(&b.id)).unwrap();
        let items = list::<DiscoveredSkill>(&db, "skill").unwrap();
        assert_eq!(items.len(), 2);
        assert_ne!(items[0].id, items[1].id);
        assert_eq!(items[0].resolved_path, items[1].resolved_path);
        assert!(items.iter().all(|s| !s.linked));
        fs::rename(&root, p.join("offline")).unwrap();
        scan(&db, &library, &ctl, None, Some(&a.id)).unwrap();
        assert_eq!(
            list::<DiscoveredSkill>(&db, "skill")
                .unwrap()
                .iter()
                .find(|s| s.root_id == a.id)
                .unwrap()
                .status,
            "stale"
        );
        assert_eq!(
            get::<RootInfo>(&db, "root", &a.id).unwrap().unwrap().status,
            "absent"
        );
        fs::rename(p.join("offline"), &root).unwrap();
        fs::remove_dir_all(root.join("demo")).unwrap();
        scan(&db, &library, &ctl, None, Some(&a.id)).unwrap();
        assert_eq!(
            list::<DiscoveredSkill>(&db, "skill")
                .unwrap()
                .iter()
                .find(|s| s.root_id == a.id)
                .unwrap()
                .status,
            "missing"
        );
        fs::remove_dir_all(p).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn junction_discovery_handles_valid_broken_and_circular_links() {
        use std::os::windows::process::CommandExt;
        let p = fixture("junction");
        let root = p.join("skills");
        let external = p.join("external/demo");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::write(
            external.join("SKILL.md"),
            "---\ndescription: valid Claude metadata\n---",
        )
        .unwrap();
        for (name, target) in [
            ("linked", external.clone()),
            ("broken", p.join("absent")),
            ("cycle", root.clone()),
        ] {
            let result = std::process::Command::new("cmd.exe")
                .raw_arg(format!(
                    "/d /c mklink /J \"{}\" \"{}\"",
                    root.join(name).display(),
                    target.display()
                ))
                .output()
                .unwrap();
            assert!(result.status.success());
        }
        let result = read_root(&root, &ScanController::default());
        assert!(!result.complete);
        assert!(result
            .documents
            .iter()
            .any(|s| s.linked && s.diagnostics.is_empty()));
        assert!(result
            .documents
            .iter()
            .any(|s| s.diagnostics.iter().any(|d| d.code == "broken_link")));
        assert!(result.diagnostics.iter().any(|d| d.code == "link_cycle"));
        for name in ["linked", "broken", "cycle"] {
            crate::skills::remove_if_exists(&root.join(name)).unwrap();
        }
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn project_discovery_respects_depth_exclusions_and_disabled_areas() {
        let p = fixture("projects");
        fs::create_dir_all(p.join("app/.qwen/skills/demo")).unwrap();
        fs::create_dir_all(p.join("node_modules/ignored/.qwen/skills")).unwrap();
        let db = Database::initialize(p.join("db.sqlite")).unwrap();
        initialize(&db).unwrap();
        let area = save_project(&db, &p, 1, true).unwrap();
        discover_projects(&db, &ScanController::default(), Some("qwen-code")).unwrap();
        let roots = db.list_discovery_roots().unwrap();
        assert_eq!(roots.len(), 1);
        assert!(roots[0].configured_path.contains("app"));
        remove_project(&db, &area.id).unwrap();
        assert!(!db.list_discovery_roots().unwrap()[0].enabled);
        assert!(save_project(&db, &p, 20, true).is_err());
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn native_codex_directory_is_discovered_without_a_cli_installation() {
        let p = fixture("codex-config-only");
        let native = p.join(".codex/skills");
        fs::create_dir_all(&native).unwrap();
        let db = Database::initialize(p.join("db.sqlite")).unwrap();
        initialize(&db).unwrap();
        register_user_roots(&db, agent_catalog::definition("codex").unwrap(), &p, false).unwrap();
        assert!(db
            .list_discovery_roots()
            .unwrap()
            .iter()
            .any(|r| path_key(Path::new(&r.configured_path)) == path_key(&native)));
        assert!(
            !db.list_agent_targets()
                .unwrap()
                .iter()
                .find(|a| a.id == "codex")
                .unwrap()
                .detected
        );
        fs::remove_dir_all(p).unwrap();
    }
}
