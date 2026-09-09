import { useCallback, useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Button, PageHeader, StatusPill, Toggle } from "../components/ui";
import { diagnosticsService, type HealthSnapshot } from "../services/diagnosticsService";
import { workspaceService } from "../services/workspaceService";
import type { SourceConfig } from "../types/domain";
import type { DiscoveryRootRecord } from "../types/discovery";
import type { SkillUpdateRecord } from "../types/gitSources";

const sections = ["Sources", "发现目录", "更新策略", "安全"] as const;

type SettingsSection = (typeof sections)[number];

const sectionCopy: Record<SettingsSection, { title: string; body: string }> = {
  Sources: {
    title: "Source & Adapter Registry",
    body: "只访问明确配置的 Git 仓库和 Agent Root，不做全盘扫描。",
  },
  "发现目录": {
    title: "Agent Discovery Roots",
    body: "Claude Code 使用 .claude/skills；Codex 使用 .agents/skills 或 .codex/skills。",
  },
  "更新策略": {
    title: "Update Policy",
    body: "更新只 fetch 到应用 checkout，不会自动 promote 或写入 Agent 目录。",
  },
  安全: {
    title: "Safety Boundary",
    body: "扫描、导入、同步三个阶段都不会执行 Skill 内的 scripts。",
  },
};

export function SettingsPage() {
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [roots, setRoots] = useState<DiscoveryRootRecord[]>([]);
  const [updates, setUpdates] = useState<SkillUpdateRecord[]>([]);
  const [activeSection, setActiveSection] = useState<SettingsSection>("Sources");
  const [scanOnStart, setScanOnStart] = useState(true);
  const [autoCheck, setAutoCheck] = useState(true);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState("claude-code");
  const [gitUrl, setGitUrl] = useState("");
  const [gitReference, setGitReference] = useState("main");
  const [gitSubpath, setGitSubpath] = useState("");

  const loadManagedSettings = useCallback(async () => {
    try {
      const [nextSources, nextRoots, nextUpdates] = await Promise.all([
        workspaceService.getSources(),
        workspaceService.getDiscoveryRoots(),
        workspaceService.getSkillUpdates(),
      ]);
      setSources(nextSources);
      setRoots(nextRoots);
      setUpdates(nextUpdates);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取设置失败");
    }
  }, []);

  useEffect(() => {
    void diagnosticsService.getHealth().then(setHealth).catch((healthFailure: unknown) => setHealthError(diagnosticsService.formatError(healthFailure)));
    void loadManagedSettings();
  }, [loadManagedSettings]);

  const handleAddRoot = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const path = await workspaceService.pickDiscoveryRoot();
      if (path) { await workspaceService.addDiscoveryRoot(path, agentId); await loadManagedSettings(); }
    } catch (rootError) {
      setError(rootError instanceof Error ? rootError.message : "添加发现目录失败");
    } finally { setBusy(false); }
  };

  const handleRemoveRoot = async (root: DiscoveryRootRecord): Promise<void> => {
    if (!(await confirm(`仅移除发现配置，不会改动 Agent 文件：\n${root.configuredPath}`))) return;
    setBusy(true);
    try { await workspaceService.removeDiscoveryRoot(root.id); await loadManagedSettings(); }
    catch (rootError) { setError(rootError instanceof Error ? rootError.message : "移除发现目录失败"); }
    finally { setBusy(false); }
  };

  const handleRegisterGit = async (): Promise<void> => {
    if (!gitUrl.trim()) return;
    setBusy(true); setError(null);
    try {
      await workspaceService.registerGitSource({ url: gitUrl, reference: gitReference, skillSubpath: gitSubpath });
      setGitUrl(""); setGitSubpath("");
      await loadManagedSettings();
    } catch (gitError) {
      setError(gitError instanceof Error ? gitError.message : "登记 Git Source 失败");
    } finally { setBusy(false); }
  };

  const handleCheckAllUpdates = async (): Promise<void> => {
    const sourceIds = Array.from(new Set(updates.map((update) => update.sourceId)));
    if (sourceIds.length === 0) return;
    setBusy(true); setError(null);
    try {
      const results = await Promise.allSettled(
        sourceIds.map((sourceId) => workspaceService.checkGitSource(sourceId)),
      );
      await loadManagedSettings();
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) setError(`${failed} / ${sourceIds.length} 个仓库检查失败，可到 Skills 页重试单个来源。`);
    } finally { setBusy(false); }
  };

  return <section className="page">
    <PageHeader title="Settings" subtitle="配置受限来源、Agent Roots 与本地安全边界。" />
    {error ? <div className="inline-notice notice-error" role="alert">{error}</div> : null}
    <div className="workbench settings-workbench">
      <aside className="panel-surface settings-nav">
        {sections.map((item) => (
          <button
            className={activeSection === item ? "subnav-item active" : "subnav-item"}
            key={item}
            onClick={() => setActiveSection(item)}
            type="button"
          >
            <span>{item}</span>
          </button>
        ))}
      </aside>

      <section className="panel-surface settings-main">
        <div className="bundle-heading compact">
          <div>
            <span className="eyebrow">{activeSection}</span>
            <h2>{sectionCopy[activeSection].title}</h2>
            <p>{sectionCopy[activeSection].body}</p>
          </div>
        </div>

        {activeSection === "Sources" ? <>
          <div className="source-list">
            {sources.length === 0 ? (
              <p className="muted-help">尚未登记任何来源。</p>
            ) : sources.map((source) => (
              <div className="source-card" key={source.id}>
                <i className="source-icon">↗</i>
                <span><strong>{source.name}</strong><small>{source.description}</small></span>
                <span className="source-detail">{source.detail}</span>
                <StatusPill tone={source.enabled ? "green" : "gray"}>{source.enabled ? "已启用" : "已关闭"}</StatusPill>
              </div>
            ))}
          </div>

          <div className="git-source-editor">
            <div><span className="eyebrow">Git Source</span><h3>登记 HTTPS Skill 仓库</h3><p>Clone/Fetched 内容仅落在应用数据目录；不会自动覆盖 Library。</p></div>
            <label><span>Repository URL</span><input value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} placeholder="https://github.com/org/repo.git" /></label>
            <div className="git-source-grid">
              <label><span>Reference</span><input value={gitReference} onChange={(event) => setGitReference(event.target.value)} placeholder="main" /></label>
              <label><span>Skill subpath</span><input value={gitSubpath} onChange={(event) => setGitSubpath(event.target.value)} placeholder="skills/demo-skill（根目录可留空）" /></label>
            </div>
            <Button variant="primary" disabled={busy || !gitUrl.trim()} onClick={() => void handleRegisterGit()}>{busy ? "处理中…" : "Clone 并纳入 Library"}</Button>
          </div>
        </> : null}

        {activeSection === "发现目录" ? (
          <div className="settings-section-flush">
            <div className="discovery-roots-heading">
              <div><span className="eyebrow">Agent adapters</span><h3>发现目录</h3><p>只读扫描直接子目录，不跟随 symlink，也不执行 scripts。</p></div>
              <div className="root-add-controls">
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  <option value="claude-code">Claude Code</option>
                  <option value="codex">Codex</option>
                </select>
                <Button disabled={busy} onClick={() => void handleAddRoot()}>＋ 添加项目 Root</Button>
              </div>
            </div>
            <div className="discovery-root-list">
              {roots.length === 0 ? <p className="muted-help">尚无可用发现目录。</p> : roots.map((root) => (
                <article className="discovery-root-card" key={root.id}>
                  <div>
                    <strong>{root.agentId === "codex" ? "Codex" : "Claude Code"} · {root.scope === "user" ? "User" : "Project"}{root.isDefault ? " · 默认" : ""}</strong>
                    <code title={root.configuredPath}>{root.configuredPath}</code>
                    {root.lastWarning ? <small className="discovery-warning">{root.lastWarning}</small> : null}
                  </div>
                  <div className="discovery-root-actions">
                    <StatusPill tone={root.enabled ? "green" : "gray"}>{root.enabled ? "已启用" : "已关闭"}</StatusPill>
                    {!root.isDefault ? <Button disabled={busy} onClick={() => void handleRemoveRoot(root)}>移除</Button> : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {activeSection === "更新策略" ? <>
          <div className="settings-options">
            <div><span><strong>启动时扫描</strong><small>保留为显式偏好；扫描本身始终只读。</small></span><Toggle checked={scanOnStart} onChange={setScanOnStart} /></div>
            <div><span><strong>自动检查更新</strong><small>只 fetch 到应用 checkout，不自动 Promote 或部署。</small></span><Toggle checked={autoCheck} onChange={setAutoCheck} /></div>
          </div>

          <div className="bundle-skill-list">
            <div className="discovery-roots-heading">
              <div><span className="section-label">已跟踪 Upstream</span><p className="muted-help">Git Source 三线状态：upstream / Library / 已部署目标。</p></div>
              <Button disabled={busy || updates.length === 0} onClick={() => void handleCheckAllUpdates()}>{busy ? "检查中…" : "检查全部更新"}</Button>
            </div>
            <div className="tracked-source-list">
              {updates.length === 0 ? <p className="muted-help">尚未登记 Git Source。</p> : updates.map((update) => (
                <div key={update.sourceId}>
                  <span><strong>{update.skillName}</strong><small>{update.reference} · {update.upstreamRevision.slice(0, 10)}</small></span>
                  <StatusPill tone={update.status === "clean" ? "green" : update.status === "upstream_update" ? "amber" : "red"}>{update.status}</StatusPill>
                </div>
              ))}
            </div>
          </div>
        </> : null}

        {activeSection === "安全" ? (
          <div className="settings-section-flush">
            <div className="verify-box">
              <span className="section-label">执行边界</span>
              <p>✓ 发现、导入、更新与同步阶段均不执行 Skill 内 scripts</p>
              <p>✓ Git 命令禁用 hooks，不保存 URL 内嵌凭据</p>
              <p>✓ 写入使用 staging + snapshot + 同盘原子替换，任一项失败按逆序回滚</p>
            </div>
            <div className="verify-box">
              <span className="section-label">路径边界</span>
              <p>✓ 拒绝 root、Skill 目录、manifest 与内容树中的 symlink，不访问链接目标</p>
              <p>✓ 所有读写限制在明确配置的目录和 App Data 内，不做全盘扫描</p>
              <p>✓ 单个 Skill 上限 2000 个文件 / 100 MB，.git 不进入 Library 与 content hash</p>
            </div>
            <div className="verify-box">
              <span className="section-label">写入边界</span>
              <p>✓ Discovery ≠ Adopt：发现到的 Skill 默认保持 Unmanaged</p>
              <p>✓ Sync ≠ Overwrite：unmanaged 内容、目标漂移、过期计划一律拒绝</p>
              <p>✓ 只有本应用拥有且无漂移的目标才允许自动更新</p>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="panel-surface inspector settings-inspector">
        <div className="inspector-title simple"><div><h2>当前环境</h2><p>Desktop Bridge 与 SQLite 诊断。</p></div></div>
        {health ? <>
          <div className="diagnostic-status"><span><i className="health-dot" />Desktop Bridge</span><strong>Connected</strong></div>
          <div className="diagnostic-status"><span><i className="health-dot" />SQLite</span><strong>{health.databaseOk ? "Ready" : "Error"}</strong></div>
          <dl className="detail-list compact-list">
            <div><dt>App</dt><dd>v{health.appVersion}</dd></div>
            <div><dt>DB Write Test</dt><dd>{health.counter}</dd></div>
          </dl>
          <div className="path-card"><span>Database</span><code title={health.databasePath}>{health.databasePath}</code></div>
          <div className="path-card"><span>Local Log</span><code title={health.logPath}>{health.logPath}</code></div>
        </> : <div className="diagnostic-offline"><StatusPill tone="gray">Desktop only</StatusPill><p>{healthError ? "浏览器预览无法调用 Tauri Bridge。" : "正在读取本地诊断信息…"}</p></div>}
        <div className="safety-note"><span>✓</span><p><strong>安全边界</strong><br />Git 禁用 hooks；发现、更新和同步均不执行 Skill scripts。</p></div>
      </aside>
    </div>
  </section>;
}
