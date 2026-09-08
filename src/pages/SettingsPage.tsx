import { useCallback, useEffect, useState } from "react";
import { Button, PageHeader, StatusPill, Toggle } from "../components/ui";
import { diagnosticsService, type HealthSnapshot } from "../services/diagnosticsService";
import { workspaceService } from "../services/workspaceService";
import type { SourceConfig } from "../types/domain";
import type { DiscoveryRootRecord } from "../types/discovery";

export function SettingsPage() {
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [roots, setRoots] = useState<DiscoveryRootRecord[]>([]);
  const [activeSection, setActiveSection] = useState("Sources");
  const [scanOnStart, setScanOnStart] = useState(true);
  const [autoCheck, setAutoCheck] = useState(true);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [rootBusy, setRootBusy] = useState(false);

  const loadRoots = useCallback(async () => {
    try {
      setRoots(await workspaceService.getDiscoveryRoots());
      setRootError(null);
    } catch (error) {
      setRootError(error instanceof Error ? error.message : "读取发现目录失败");
    }
  }, []);

  useEffect(() => {
    void workspaceService.getSources().then(setSources);
    void diagnosticsService.getHealth().then(setHealth).catch((error: unknown) =>
      setHealthError(diagnosticsService.formatError(error)),
    );
    void loadRoots();
  }, [loadRoots]);

  const handleAddRoot = async () => {
    setRootBusy(true);
    setRootError(null);
    try {
      const path = await workspaceService.pickDiscoveryRoot();
      if (path) {
        await workspaceService.addDiscoveryRoot(path);
        await loadRoots();
      }
    } catch (error) {
      setRootError(error instanceof Error ? error.message : "添加发现目录失败");
    } finally {
      setRootBusy(false);
    }
  };

  const handleRemoveRoot = async (root: DiscoveryRootRecord) => {
    if (!window.confirm(`仅移除发现配置，不会改动 Agent 文件：\n${root.configuredPath}`)) return;
    setRootBusy(true);
    try {
      await workspaceService.removeDiscoveryRoot(root.id);
      await loadRoots();
    } catch (error) {
      setRootError(error instanceof Error ? error.message : "移除发现目录失败");
    } finally {
      setRootBusy(false);
    }
  };

  return (
    <section className="page">
      <PageHeader title="Settings" subtitle="配置 Sources、发现目录与本地安全边界。" actions={<Button variant="primary" disabled>保存设置</Button>} />
      <div className="workbench settings-workbench">
        <aside className="panel-surface settings-nav">
          {["通用", "Sources", "发现目录", "更新策略", "安全"].map((item) => (
            <button className={activeSection === item ? "subnav-item active" : "subnav-item"} key={item} onClick={() => setActiveSection(item)} type="button"><span>{item}</span></button>
          ))}
        </aside>
        <section className="panel-surface settings-main">
          <div className="bundle-heading compact"><div><span className="eyebrow">{activeSection}</span><h2>Skill Sources</h2><p>只从明确配置的来源发现 Skill，不做全盘扫描。</p></div></div>
          <div className="source-list">{sources.map((source) => (
            <div className="source-card" key={source.id}><i className="source-icon">↗</i><span><strong>{source.name}</strong><small>{source.description}</small></span><span className="source-detail">{source.detail}</span><StatusPill tone={source.enabled ? "green" : "gray"}>{source.enabled ? "已启用" : "已关闭"}</StatusPill></div>
          ))}</div>

          <div className="discovery-roots-section">
            <div className="discovery-roots-heading"><div><span className="eyebrow">Claude Code</span><h3>发现目录</h3><p>读取目录并记录 Skill，不复制、不执行、不修改 Agent 文件。</p></div><Button disabled={rootBusy} onClick={() => void handleAddRoot()}>{rootBusy ? "处理中…" : "＋ 添加项目 Skill Root"}</Button></div>
            {rootError ? <div className="inline-notice notice-error">{rootError}</div> : null}
            <div className="discovery-root-list">
              {roots.length === 0 ? <p className="muted-help">桌面端启动后会登记默认用户目录。</p> : roots.map((root) => (
                <article className="discovery-root-card" key={root.id}>
                  <div><strong>{root.scope === "user" ? "User" : "Project"} Scope {root.isDefault ? "· 默认" : ""}</strong><code title={root.configuredPath}>{root.configuredPath}</code>{root.lastWarning ? <small className="discovery-warning">{root.lastWarning}</small> : null}</div>
                  <div className="discovery-root-actions"><StatusPill tone={root.enabled ? "green" : "gray"}>{root.enabled ? "已启用" : "已关闭"}</StatusPill>{!root.isDefault ? <Button disabled={rootBusy} onClick={() => void handleRemoveRoot(root)}>移除</Button> : null}</div>
                </article>
              ))}
            </div>
          </div>

          <div className="settings-options"><div><span><strong>启动时扫描</strong><small>M3 暂不自动扫描；使用 Agents 页“重新检测”。</small></span><Toggle checked={scanOnStart} onChange={setScanOnStart} /></div><div><span><strong>自动检查更新</strong><small>只检查，不自动覆盖 Library 或 Agent。</small></span><Toggle checked={autoCheck} onChange={setAutoCheck} /></div></div>
        </section>
        <aside className="panel-surface inspector settings-inspector">
          <div className="inspector-title simple"><div><h2>当前环境</h2><p>Desktop Bridge 与 SQLite 诊断。</p></div></div>
          {health ? <><div className="diagnostic-status"><span><i className="health-dot" />Desktop Bridge</span><strong>Connected</strong></div><div className="diagnostic-status"><span><i className="health-dot" />SQLite</span><strong>{health.databaseOk ? "Ready" : "Error"}</strong></div><dl className="detail-list compact-list"><div><dt>App</dt><dd>v{health.appVersion}</dd></div><div><dt>DB Write Test</dt><dd>{health.counter}</dd></div></dl><div className="path-card"><span>Database</span><code title={health.databasePath}>{health.databasePath}</code></div><div className="path-card"><span>Local Log</span><code title={health.logPath}>{health.logPath}</code></div></> : <div className="diagnostic-offline"><StatusPill tone="gray">Desktop only</StatusPill><p>{healthError ? "浏览器预览无法调用 Tauri Bridge。" : "正在读取本地诊断信息…"}</p></div>}
          <div className="safety-note"><span>✦</span><p><strong>安全边界</strong><br />发现和导入 Skill 时不会执行 scripts。</p></div>
        </aside>
      </div>
    </section>
  );
}
