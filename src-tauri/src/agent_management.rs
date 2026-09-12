use crate::{
    agent_catalog,
    agent_center::{self, Diagnostic, DiscoveredSkill, RootInfo},
    agent_discovery::DiscoveryRootRecord,
    db::Database,
    error::AppError,
    safe_apply, skills,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreferences {
    #[serde(default)]
    pub last_agent_id: Option<String>,
    #[serde(default)]
    pub scopes: BTreeMap<String, String>,
    #[serde(default)]
    pub targets: BTreeMap<String, String>,
    #[serde(default)]
    pub sorts: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBinding {
    pub library_id: String,
    pub fingerprint: Option<String>,
    pub library_hash: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeOption {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub root_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetOption {
    pub id: String,
    pub path: String,
    pub source: String,
    pub recommended: bool,
    pub affected_agents: Vec<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub state: String,
    pub reason: Option<String>,
    pub instance_ids: Vec<String>,
    pub root_ids: Vec<String>,
    pub paths: Vec<String>,
    pub resolved_path: String,
    pub library_id: Option<String>,
    pub readonly: bool,
    pub linked: bool,
    pub can_update: bool,
    pub can_import: bool,
    pub local_modified: bool,
    pub diagnostics: Vec<Diagnostic>,
    pub modified_at: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementView {
    pub agent_id: String,
    pub scope_id: String,
    pub scope_available: bool,
    pub scopes: Vec<ScopeOption>,
    pub targets: Vec<TargetOption>,
    pub target_id: Option<String>,
    pub skills: Vec<ManagedSkill>,
    pub checked_at: i64,
}

pub fn preferences(db: &Database) -> Result<AgentPreferences, AppError> {
    Ok(agent_center::get(db, "preferences", "agents-v1")?.unwrap_or_default())
}
pub fn save_preferences(db: &Database, value: &AgentPreferences) -> Result<(), AppError> {
    if value
        .last_agent_id
        .as_deref()
        .is_some_and(|id| agent_catalog::definition(id).is_none())
    {
        return Err(AppError::State("Agent 不存在".into()));
    }
    agent_center::put(db, "preferences", "agents-v1", value)
}
fn binding_key(path: &Path) -> String {
    agent_center::key(&agent_center::path_key(path))
}
pub fn project_path(root: &DiscoveryRootRecord) -> PathBuf {
    let path = Path::new(&root.configured_path);
    let mut suffixes = agent_catalog::definition(&root.agent_id)
        .map(|a| a.project_roots.to_vec())
        .unwrap_or_default();
    suffixes.extend([".agents/skills", "skills"]);
    suffixes.sort_by_key(|s| std::cmp::Reverse(s.len()));
    for suffix in suffixes {
        let suffix = Path::new(suffix);
        if path.ends_with(suffix) {
            let mut parent = path;
            for _ in suffix.components() {
                parent = parent.parent().unwrap_or(parent);
            }
            return parent.to_path_buf();
        }
    }
    path.to_path_buf()
}
pub fn scope_options(roots: &[DiscoveryRootRecord], agent_id: &str) -> Vec<ScopeOption> {
    let mut scopes = BTreeMap::new();
    scopes.insert(
        "user".to_string(),
        ScopeOption {
            id: "user".into(),
            name: "所有项目".into(),
            path: None,
            root_ids: vec![],
        },
    );
    for root in roots.iter().filter(|r| r.agent_id == agent_id) {
        let path = project_path(root);
        let id = if root.scope == "user" {
            "user".into()
        } else {
            agent_center::key(&agent_center::path_key(&path))
        };
        let entry = scopes.entry(id.clone()).or_insert_with(|| ScopeOption {
            id,
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: Some(agent_center::display(&path)),
            root_ids: vec![],
        });
        entry.root_ids.push(root.id.clone());
    }
    let mut values: Vec<_> = scopes.into_values().collect();
    values.sort_by_key(|s| (s.id != "user", s.name.to_lowercase()));
    values
}
fn preferred_path(agent_id: &str, scope: &ScopeOption) -> Option<PathBuf> {
    let agent = agent_catalog::definition(agent_id)?;
    if let Some(project) = &scope.path {
        return agent
            .preferred_project_root
            .map(|s| Path::new(project).join(s));
    }
    let home = crate::claude_code::current_home()?;
    let variable = match agent_id {
        "claude-code" => Some("CLAUDE_CONFIG_DIR"),
        "codex" => Some("CODEX_HOME"),
        "kimi-code" => Some("KIMI_CODE_HOME"),
        "openclaw" => Some("OPENCLAW_STATE_DIR"),
        _ => None,
    };
    if let Some(base) = variable.and_then(std::env::var_os) {
        return Some(PathBuf::from(base).join("skills"));
    }
    if agent_id == "opencode" {
        if let Some(base) = std::env::var_os("XDG_CONFIG_HOME") {
            return Some(PathBuf::from(base).join("opencode/skills"));
        }
    }
    Some(home.join(agent.preferred_user_root))
}
pub fn target_options(
    db: &Database,
    agent_id: &str,
    scope: &ScopeOption,
    roots: &[DiscoveryRootRecord],
) -> Result<Vec<TargetOption>, AppError> {
    let preferred = preferred_path(agent_id, scope).map(|p| agent_center::path_key(&p));
    let mut seen = BTreeSet::new();
    let mut result = vec![];
    let remembered = preferences(db)?
        .targets
        .get(&format!("{agent_id}:{}", scope.id))
        .cloned();
    let mut candidates = roots
        .iter()
        .filter(|r| r.agent_id == agent_id && r.enabled && scope.root_ids.contains(&r.id))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|r| {
        (
            remembered.as_deref() != Some(r.id.as_str()),
            preferred.as_ref() != Some(&agent_center::path_key(Path::new(&r.configured_path))),
            r.configured_path.clone(),
        )
    });
    for root in candidates {
        let detail: Option<RootInfo> = agent_center::get(db, "root", &root.id)?;
        if detail.as_ref().is_some_and(|r| !r.writable) {
            continue;
        }
        let real = match safe_apply::prospective_root(Path::new(&root.configured_path)) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if agent_center::assert_writable_root(db, &real).is_err() {
            continue;
        }
        if !seen.insert(agent_center::path_key(&real)) {
            continue;
        }
        let affected_agents = roots
            .iter()
            .filter(|r| {
                safe_apply::prospective_root(Path::new(&r.configured_path))
                    .is_ok_and(|p| agent_center::path_key(&p) == agent_center::path_key(&real))
            })
            .map(|r| r.agent_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        result.push(TargetOption {
            id: root.id.clone(),
            path: agent_center::display(Path::new(&root.configured_path)),
            source: detail.map(|d| d.source).unwrap_or_else(|| "custom".into()),
            recommended: preferred.as_ref()
                == Some(&agent_center::path_key(Path::new(&root.configured_path))),
            affected_agents,
        });
    }
    result.sort_by_key(|r| (!r.recommended, r.path.to_lowercase()));
    Ok(result)
}
pub fn management_view(
    db: &Database,
    agent_id: &str,
    scope_id: &str,
) -> Result<ManagementView, AppError> {
    if agent_catalog::definition(agent_id).is_none() {
        return Err(AppError::State("Agent 不存在".into()));
    }
    let roots = db.list_discovery_roots()?;
    let scopes = scope_options(&roots, agent_id);
    let scope = scopes.iter().find(|s| s.id == scope_id);
    let scope_available =
        scope.is_some_and(|s| s.path.as_ref().is_none_or(|p| Path::new(p).is_dir()));
    let targets = scope
        .filter(|_| scope_available)
        .map(|s| target_options(db, agent_id, s, &roots))
        .transpose()?
        .unwrap_or_default();
    let remembered = preferences(db)?
        .targets
        .get(&format!("{agent_id}:{scope_id}"))
        .cloned();
    let target_id = if remembered
        .as_ref()
        .is_some_and(|id| targets.iter().any(|t| t.id == *id))
    {
        remembered
    } else {
        let recommended: Vec<_> = targets.iter().filter(|r| r.recommended).collect();
        if recommended.len() == 1 {
            Some(recommended[0].id.clone())
        } else {
            None
        }
    };
    let library = db.list_skills()?;
    let deployments = safe_apply::list_deployments(db)?;
    let instances = agent_center::list::<DiscoveredSkill>(db, "skill")?;
    let mut grouped: BTreeMap<String, Vec<DiscoveredSkill>> = BTreeMap::new();
    for skill in instances.into_iter().filter(|s| {
        s.agent_id == agent_id
            && s.status != "missing"
            && scope.is_some_and(|scope| scope.root_ids.contains(&s.root_id))
    }) {
        grouped
            .entry(agent_center::path_key(Path::new(&skill.resolved_path)))
            .or_default()
            .push(skill);
    }
    let mut values = Vec::new();
    for (physical, items) in grouped {
        let first = &items[0];
        let binding: Option<SkillBinding> =
            agent_center::get(db, "binding", &binding_key(Path::new(&first.resolved_path)))?;
        let owners: Vec<_> = deployments
            .iter()
            .filter(|d| {
                agent_center::path_key(Path::new(&d.destination_path)) == physical
                    || items.iter().any(|s| {
                        agent_center::path_key(Path::new(&d.destination_path))
                            == agent_center::path_key(Path::new(&s.path))
                    })
            })
            .collect();
        let mut candidates: BTreeSet<String> = owners.iter().map(|d| d.skill_id.clone()).collect();
        if let Some(b) = &binding {
            candidates.insert(b.library_id.clone());
        }
        if candidates.is_empty() {
            for record in &library {
                if agent_center::resolve_local(Path::new(&record.library_path))
                    .is_ok_and(|p| agent_center::path_key(&p) == physical)
                    || record.source_kind == "local"
                        && agent_center::resolve_local(Path::new(&record.source_locator))
                            .is_ok_and(|p| agent_center::path_key(&p) == physical)
                {
                    candidates.insert(record.id.clone());
                }
            }
        }
        let linked_library = if candidates.len() == 1 {
            library.iter().find(|s| Some(&s.id) == candidates.first())
        } else {
            None
        };
        let readonly = !items.iter().any(|s| {
            agent_center::get::<RootInfo>(db, "root", &s.root_id)
                .ok()
                .flatten()
                .is_none_or(|r| r.writable)
        });
        let write_enabled = items.iter().any(|s| {
            roots.iter().any(|r| r.id == s.root_id && r.enabled)
                && agent_center::get::<RootInfo>(db, "root", &s.root_id)
                    .ok()
                    .flatten()
                    .is_none_or(|r| r.writable)
        });
        let mut diagnostics: Vec<_> = items.iter().flat_map(|s| s.diagnostics.clone()).collect();
        diagnostics.sort_by_key(|d| (d.code.clone(), d.path.clone()));
        diagnostics.dedup_by(|a, b| a.code == b.code && a.path == b.path);
        let mut state = if !scope_available {
            "unverified"
        } else if items.iter().any(|s| s.status == "invalid") {
            "issue"
        } else if items.iter().any(|s| s.status == "stale") {
            "unverified"
        } else {
            "added"
        };
        let mut reason = diagnostics.first().map(|d| d.message.clone());
        if !scope_available {
            reason = Some("项目路径当前不可用，显示上次结果".into());
        }
        let mut local_modified = false;
        let mut can_update = false;
        if state == "added" {
            if let Some(record) = linked_library {
                let current = skills::inspect_portable_skill(Path::new(&first.resolved_path))
                    .ok()
                    .map(|s| s.content_hash);
                let baseline = owners.first().map(|d| d.deployed_hash.as_str());
                if current.as_deref() == Some(record.content_hash.as_str()) {
                    state = "added";
                } else if let Some(base) = baseline {
                    local_modified = current.is_some() && current.as_deref() != Some(base);
                    can_update = !readonly && current.is_some();
                    state = if current.is_none() {
                        "unverified"
                    } else if local_modified {
                        "issue"
                    } else {
                        "update"
                    };
                    reason = if current.is_none() {
                        Some("当前内容暂时无法核验，请重新检查".into())
                    } else {
                        local_modified.then(|| "本地内容已修改，更新将覆盖这些修改".into())
                    };
                } else if let Some(b) = &binding {
                    let fingerprint =
                        safe_apply::target_fingerprint(Path::new(&first.resolved_path))
                            .ok()
                            .flatten();
                    if fingerprint.is_none() {
                        diagnostics.push(Diagnostic {
                            code: "check_failed".into(),
                            severity: "warning".into(),
                            path: first.resolved_path.clone(),
                            message: "该技能暂时无法完成内容检查".into(),
                            suggestion: "检查访问权限后重新检查".into(),
                        });
                    }
                    local_modified = fingerprint != b.fingerprint;
                    can_update = !readonly
                        && (local_modified
                            || b.library_hash.as_deref() != Some(record.content_hash.as_str()));
                    state = if local_modified {
                        "issue"
                    } else if can_update {
                        "update"
                    } else {
                        "added"
                    };
                    reason =
                        local_modified.then(|| "导入后的原内容已变化，更新前需确认覆盖".into());
                } else {
                    state = if current.is_some() {
                        "update"
                    } else {
                        "unverified"
                    };
                    can_update = !readonly && current.is_some();
                    reason = Some(
                        if current.is_some() {
                            "技能库与当前文件内容不同"
                        } else {
                            "当前内容暂时无法核验，请重新检查"
                        }
                        .into(),
                    );
                }
            }
        }
        if candidates.len() > 1 {
            state = "issue";
            reason = Some("同一位置存在多个技能库关联，请明确选择来源".into());
        }
        if readonly {
            can_update = false;
        }
        if can_update && !write_enabled {
            can_update = false;
            state = "issue";
            reason = Some("保存位置已关闭，请先在管理目录中启用".into());
        }
        values.push(ManagedSkill {
            id: agent_center::key(&format!("{agent_id}:{scope_id}:{physical}")),
            name: first.name.clone(),
            description: first.description.clone(),
            state: state.into(),
            reason,
            instance_ids: items.iter().map(|s| s.id.clone()).collect(),
            root_ids: items.iter().map(|s| s.root_id.clone()).collect(),
            paths: items.iter().map(|s| s.path.clone()).collect(),
            resolved_path: first.resolved_path.clone(),
            library_id: linked_library.map(|s| s.id.clone()),
            readonly,
            linked: items.iter().any(|s| s.linked),
            can_update,
            can_import: linked_library.is_none() && Path::new(&first.resolved_path).is_dir(),
            local_modified,
            diagnostics,
            modified_at: first.modified_at,
        });
    }
    values.sort_by_key(|s| s.name.to_lowercase());
    Ok(ManagementView {
        agent_id: agent_id.into(),
        scope_id: scope_id.into(),
        scope_available,
        scopes,
        targets,
        target_id,
        skills: values,
        checked_at: agent_center::now(),
    })
}
pub fn bind_skill(db: &Database, instance_id: &str, library_id: &str) -> Result<(), AppError> {
    let instance: DiscoveredSkill = agent_center::get(db, "skill", instance_id)?
        .ok_or_else(|| AppError::State("技能已不存在".into()))?;
    let record = db
        .list_skills()?
        .into_iter()
        .find(|s| s.id == library_id)
        .ok_or_else(|| AppError::State("技能库记录不存在".into()))?;
    let hash = skills::inspect_portable_skill(Path::new(&instance.resolved_path))
        .ok()
        .map(|s| s.content_hash);
    let binding = SkillBinding {
        library_id: record.id,
        fingerprint: safe_apply::target_fingerprint(Path::new(&instance.resolved_path))?,
        library_hash: hash.filter(|h| h == &record.content_hash),
    };
    agent_center::put(
        db,
        "binding",
        &binding_key(Path::new(&instance.resolved_path)),
        &binding,
    )
}
pub fn preview_updates(
    db: &Database,
    agent_id: &str,
    scope_id: &str,
    ids: &[String],
) -> Result<Vec<crate::bundle_planner::SyncPlanRecord>, AppError> {
    let view = management_view(db, agent_id, scope_id)?;
    let roots = db.list_discovery_roots()?;
    let mut selections: BTreeMap<String, Vec<(String, Option<String>)>> = BTreeMap::new();
    for id in ids {
        let skill = view
            .skills
            .iter()
            .find(|s| &s.id == id)
            .filter(|s| s.can_update)
            .ok_or_else(|| AppError::State("所选技能状态已变化，请重新检查".into()))?;
        let library_id = skill
            .library_id
            .as_ref()
            .ok_or_else(|| AppError::State("技能尚未关联技能库".into()))?;
        let root = roots
            .iter()
            .find(|r| {
                skill.root_ids.contains(&r.id)
                    && r.enabled
                    && agent_center::get::<RootInfo>(db, "root", &r.id)
                        .ok()
                        .flatten()
                        .is_none_or(|i| i.writable)
            })
            .ok_or_else(|| AppError::State("原位置不可写".into()))?;
        let original = skill
            .paths
            .iter()
            .find(|p| Path::new(p).starts_with(Path::new(&root.configured_path)))
            .ok_or_else(|| AppError::State("原技能位置已变化".into()))?;
        let relative = Path::new(original)
            .strip_prefix(&root.configured_path)
            .map_err(|_| AppError::State("技能位置不在目标目录内".into()))?;
        selections.entry(root.id.clone()).or_default().push((
            library_id.clone(),
            Some(relative.to_string_lossy().into_owned()),
        ));
    }
    selections
        .into_iter()
        .map(|(root, paths)| crate::bundle_planner::generate_selection_targets(db, &root, &paths))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub id: String,
    pub path: String,
    pub name: String,
    pub description: String,
    pub fingerprint: String,
    pub changes: Vec<String>,
}
fn manifest_parts(raw: &str) -> Result<(serde_yaml::Mapping, String), AppError> {
    let normalized = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Ok((serde_yaml::Mapping::new(), normalized));
    }
    let mut yaml = vec![];
    let mut closed = false;
    for line in &mut lines {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        yaml.push(line);
    }
    if !closed {
        return Err(AppError::State(
            "元数据头部未闭合，请先修复 SKILL.md".into(),
        ));
    }
    let mapping = serde_yaml::from_str::<serde_yaml::Mapping>(&yaml.join("\n"))
        .map_err(|_| AppError::State("YAML 格式无效，请先修复 SKILL.md".into()))?;
    Ok((mapping, lines.collect::<Vec<_>>().join("\n")))
}
pub fn prepare_import(
    db: &Database,
    path: Option<&str>,
    instance_id: Option<&str>,
) -> Result<ImportPreview, AppError> {
    let source = if let Some(id) = instance_id {
        agent_center::get::<DiscoveredSkill>(db, "skill", id)?
            .ok_or_else(|| AppError::State("技能已不存在".into()))?
            .resolved_path
    } else {
        path.ok_or_else(|| AppError::State("请选择技能目录".into()))?
            .to_string()
    };
    let real = agent_center::resolve_local(Path::new(&source))?;
    let raw = agent_center::bounded_text(&real.join("SKILL.md"), 1024 * 1024)?;
    let (metadata, _) = manifest_parts(&raw)?;
    let name = metadata
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| real.file_name().and_then(|p| p.to_str()).unwrap_or(""))
        .to_string();
    let description = metadata
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let fingerprint = safe_apply::target_fingerprint(&real)?
        .ok_or_else(|| AppError::State("源目录不存在".into()))?;
    let changes = if metadata.contains_key("name") && metadata.contains_key("description") {
        vec![]
    } else {
        vec!["将在技能库副本中补全名称和简介".into()]
    };
    let id = agent_center::key(&format!("{}:{fingerprint}", agent_center::path_key(&real)));
    let preview = ImportPreview {
        id: id.clone(),
        path: agent_center::display(&real),
        name,
        description,
        fingerprint,
        changes,
    };
    agent_center::put(db, "import-preview", &id, &preview)?;
    Ok(preview)
}
pub fn import_prepared(
    db: &Database,
    library: &Path,
    id: &str,
    name: &str,
    description: &str,
) -> Result<skills::ImportSkillResult, AppError> {
    let preview: ImportPreview = agent_center::get(db, "import-preview", id)?
        .ok_or_else(|| AppError::State("导入预览已失效".into()))?;
    let source = agent_center::resolve_local(Path::new(&preview.path))?;
    if safe_apply::target_fingerprint(&source)?.as_deref() != Some(preview.fingerprint.as_str()) {
        return Err(AppError::State("源文件已变化，请重新预览导入".into()));
    }
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
    {
        return Err(AppError::State(
            "名称应为 1–64 位小写字母、数字或连字符".into(),
        ));
    }
    if description.trim().is_empty() || description.chars().count() > 1024 {
        return Err(AppError::State("请填写 1–1024 字的技能简介".into()));
    }
    let staging = db
        .path()
        .parent()
        .unwrap()
        .join("import-previews")
        .join(format!(
            "{}-{}",
            id,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| AppError::State("系统时间不可用".into()))?
                .as_nanos()
        ))
        .join(name);
    let result = (|| {
        skills::copy_tree(&source, &staging)?;
        let raw = agent_center::bounded_text(&staging.join("SKILL.md"), 1024 * 1024)?;
        let (mut metadata, body) = manifest_parts(&raw)?;
        metadata.insert("name".into(), name.into());
        metadata.insert("description".into(), description.into());
        fs::write(
            staging.join("SKILL.md"),
            format!("---\n{}---\n{}", serde_yaml::to_string(&metadata)?, body),
        )?;
        if safe_apply::target_fingerprint(&source)?.as_deref() != Some(preview.fingerprint.as_str())
        {
            return Err(AppError::State("导入期间源内容发生变化，请重试".into()));
        }
        let result = skills::import_skill_directory_with_origin(db, library, &staging, &source)?;
        agent_center::put(
            db,
            "binding",
            &binding_key(&source),
            &SkillBinding {
                library_id: result.skill.id.clone(),
                fingerprint: Some(preview.fingerprint),
                library_hash: Some(result.skill.content_hash.clone()),
            },
        )?;
        Ok(result)
    })();
    let _ = skills::remove_if_exists(staging.parent().unwrap());
    result
}

pub fn relocate_root(
    db: &Database,
    id: &str,
    path: &Path,
) -> Result<DiscoveryRootRecord, AppError> {
    let old = db
        .list_discovery_roots()?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| AppError::State("原目录不存在".into()))?;
    let real = agent_center::resolve_local(path)?;
    agent_center::assert_writable_root(db, &real)?;
    let mut new =
        agent_center::register_root(db, &old.agent_id, &real, &old.scope, "custom", None)?;
    agent_center::set_root_enabled(db, &new.id, true)?;
    new.enabled = true;
    if new.id != old.id {
        agent_center::set_root_enabled(db, &old.id, false)?;
    }
    Ok(new)
}

pub fn register_preferred_root(
    db: &Database,
    agent_id: &str,
    project: Option<&str>,
) -> Result<DiscoveryRootRecord, AppError> {
    let scope = ScopeOption {
        id: "user".into(),
        name: String::new(),
        path: project.map(str::to_owned),
        root_ids: vec![],
    };
    if let Some(p) = project {
        if !agent_center::resolve_local(Path::new(p))?.is_dir() {
            return Err(AppError::State("请选择有效项目目录".into()));
        }
    }
    let path = preferred_path(agent_id, &scope)
        .ok_or_else(|| AppError::State("该 Agent 需要手动选择保存位置".into()))?;
    let real = safe_apply::prospective_root(&path)?;
    agent_center::assert_writable_root(db, &real)?;
    let mut root = agent_center::register_root(
        db,
        agent_id,
        &path,
        if project.is_some() { "project" } else { "user" },
        "native",
        None,
    )?;
    agent_center::set_root_enabled(db, &root.id, true)?;
    root.enabled = true;
    Ok(root)
}
