import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, EmptyState, ErrorNotice, PageHeader, SearchField, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import { displayPath, shortHash } from "../types/domain";
import type {
  AgentTargetRecord,
  DiscoveryRootRecord,
  ScanSnapshot,
  SkillInstanceRecord,
} from "../types/discovery";

/** Flattened view of the backend agent catalog (for project-root conventions). */
interface AgentCatalogEntry {
  id: string;
  name: string;
  provider: string;
  projectRoots: string[];
}

const matchesConvention = (path: string, patterns: string[]): boolean => {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return patterns.some((pattern) => normalized.endsWith(pattern.toLowerCase()));
};

const detectAgent = (path: string, catalog: AgentCatalogEntry[]): string | null => {
  const matched = catalog.filter((agent) => matchesConvention(path, agent.projectRoots));
  return matched.length > 0 ? matched[0].id : null;
};

export function DiscoverPage({ onGovern }: { onGovern: () => void }) {
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState("claude-code");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, entries] = await Promise.all([
        workspaceService.scan(),
        invoke<AgentCatalogEntry[]>("list_agent_catalog"),
      ]);
      setSnapshot(next);
      setCatalog(entries);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of snapshot?.targets ?? []) map.set(target.id, target.name);
    for (const agent of catalog) if (!map.has(agent.id)) map.set(agent.id, agent.name);
    return map;
  }, [snapshot, catalog]);

  const agentName = (id: string): string => agentNames.get(id) ?? id;

  const instances = snapshot?.instances ?? [];
  const roots = snapshot?.roots ?? [];
  const targets = snapshot?.targets ?? [];
  const warnings = snapshot?.warnings ?? [];

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = instances.filter((instance) => instance.state !== "missing");
    if (!normalized) return rows;
    return rows.filter((instance) =>
      `${instance.name} ${instance.description} ${displayPath(instance.path)} ${agentName(instance.agentId)}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [instances, query, agentName]);

  const missingCount = instances.length - filtered.length;
  const detectedCount = targets.filter((target) => target.detected).length;

  const pickDirectory = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const path = await workspaceService.pickSkillsDirectory();
      if (!path) return;
      setPickedPath(path);
      setPickedAgentId(detectAgent(path, catalog) ?? pickedAgentId);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const addRoot = async (): Promise<void> => {
    if (!pickedPath) return;
    setBusy(true);
    setNotice(null);
    try {
      await workspaceService.addProjectRoot(pickedAgentId, pickedPath);
      setPickedPath(null);
      setNotice(`已登记项目目录：${displayPath(pickedPath)}`);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const removeRoot = async (root: DiscoveryRootRecord): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await workspaceService.removeProjectRoot(root.id);
      setNotice(`已移除登记：${displayPath(root.configuredPath)}`);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="发现"
        subtitle="只读扫描已登记 Agent 的用户目录与项目目录，Skills 保留在原位，不做任何复制"
        actions={
          <>
            <Button onClick={() => void load()} disabled={busy || loading}>
              {loading ? "扫描中…" : "重新扫描"}
            </Button>
            <Button variant="primary" onClick={onGovern}>
              下一步：治理 →
            </Button>
          </>
        }
      />

      {error ? <ErrorNotice error={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="inline-notice notice-info"><span aria-hidden="true">✓</span><div className="notice-body"><strong>{notice}</strong></div></div> : null}

      <div className="summary-row summary-four">
        <article><span>已检测 Agent</span><strong>{detectedCount}/{targets.length || catalog.length}</strong></article>
        <article><span>已登记目录</span><strong>{roots.length}</strong></article>
        <article><span>发现的 Skill</span><strong>{filtered.length}</strong></article>
        <article><span>扫描告警</span><strong>{warnings.length}</strong></article>
      </div>

      <section className="panel-surface">
        <div className="panel-title">Skills 目录（root）</div>
        <div className="panel-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="按名称、描述或路径过滤 Skill…" />
        </div>
        {loading && !snapshot ? (
          <EmptyState title="正在扫描" body="读取各 Agent 的 skills 目录并解析 SKILL.md…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="没有发现 Skill" body="确认本机已安装对应 Agent，或手动添加项目 Skills 目录。" />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Agent</th>
                  <th>作用域</th>
                  <th>路径</th>
                  <th>内容哈希</th>
                  <th>scripts</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((instance) => (
                  <tr key={instance.id}>
                    <td>
                      <div className="cell-title">{instance.name}</div>
                      <div className="cell-sub">{instance.description || "—"}</div>
                    </td>
                    <td>{agentName(instance.agentId)}</td>
                    <td>
                      <StatusPill tone={instance.scope === "user" ? "blue" : "green"}>
                        {instance.scope === "user" ? "用户" : "项目"}
                      </StatusPill>
                    </td>
                    <td className="mono-cell" title={displayPath(instance.path)}>{displayPath(instance.path)}</td>
                    <td className="mono-cell">{shortHash(instance.contentHash)}</td>
                    <td>{instance.scriptCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {missingCount > 0 ? (
          <p className="table-footnote">另有 {missingCount} 个 Skill 已在磁盘上消失（上次扫描后未再找到）。</p>
        ) : null}
      </section>

      <section className="panel-surface">
        <div className="panel-title">登记的项目目录</div>
        <div className="root-panel-body">
          {roots.length === 0 ? (
            <EmptyState title="尚未登记任何目录" body="默认用户目录不存在时会静默跳过；可手动添加项目中的 skills 目录。" />
          ) : (
            <ul className="root-list">
              {roots.map((root) => (
                <li key={root.id}>
                  <div className="root-main">
                    <div className="root-heading">
                      <strong>{agentName(root.agentId)}</strong>
                      <StatusPill tone={root.scope === "user" ? "blue" : "green"}>
                        {root.scope === "user" ? "用户" : "项目"}
                      </StatusPill>
                      {root.isDefault ? <StatusPill tone="gray">默认</StatusPill> : null}
                    </div>
                    <code title={displayPath(root.configuredPath)}>{displayPath(root.configuredPath)}</code>
                    {root.lastWarning ? <span className="discovery-warning">{root.lastWarning}</span> : null}
                  </div>
                  {!root.isDefault ? (
                    <Button onClick={() => void removeRoot(root)} disabled={busy}>移除登记</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="root-add">
            <div className="root-add-heading">
              <h3>添加项目 Skills 目录</h3>
              <p className="muted-help">选择形如 &lt;仓库&gt;/.claude/skills 的目录，后端会按该 Agent 的约定校验。</p>
            </div>
            <div className="root-add-controls">
              <Button onClick={() => void pickDirectory()} disabled={busy}>
                {pickedPath ? "重新选择…" : "选择目录…"}
              </Button>
              <select
                aria-label="目标 Agent"
                value={pickedAgentId}
                onChange={(event) => setPickedAgentId(event.target.value)}
              >
                {catalog.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}（{agent.projectRoots.join(" / ")}）
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={() => void addRoot()} disabled={busy || !pickedPath}>
                登记并扫描
              </Button>
            </div>
            {pickedPath ? <p className="root-add-path mono-cell">已选：{displayPath(pickedPath)}</p> : null}
          </div>
        </div>
      </section>

      {warnings.length > 0 ? (
        <section className="panel-surface">
          <div className="panel-title">扫描告警（{warnings.length}）</div>
          <ul className="warning-list">
            {warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
