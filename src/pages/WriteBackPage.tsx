import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorNotice, PageHeader, SearchField, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import { displayPath } from "../types/domain";
import type {
  AgentTargetRecord,
  DiscoveryRootRecord,
  LinkRecord,
  SkillInstanceRecord,
} from "../types/discovery";

export function WriteBackPage() {
  const [instances, setInstances] = useState<SkillInstanceRecord[]>([]);
  const [roots, setRoots] = useState<DiscoveryRootRecord[]>([]);
  const [targets, setTargets] = useState<AgentTargetRecord[]>([]);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [instanceRows, rootRows, targetRows, linkRows] = await Promise.all([
        workspaceService.listSkillInstances(),
        workspaceService.listDiscoveryRoots(),
        workspaceService.listAgentTargets(),
        workspaceService.listLinks(),
      ]);
      const liveInstances = instanceRows.filter((instance) => instance.state !== "missing");
      const enabledRoots = rootRows.filter((root) => root.enabled);
      setInstances(liveInstances);
      setRoots(enabledRoots);
      setTargets(targetRows);
      setLinks(linkRows);
      setSelectedPath((current) => current ?? liveInstances[0]?.path ?? null);
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
    const map = new Map(targets.map((target) => [target.id, target.name]));
    return map;
  }, [targets]);

  const agentName = (id: string): string => agentNames.get(id) ?? id;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return instances;
    return instances.filter((instance) =>
      `${instance.name} ${instance.description} ${displayPath(instance.path)}`.toLowerCase().includes(normalized),
    );
  }, [instances, query]);

  const selected = useMemo(
    () => instances.find((instance) => instance.path === selectedPath) ?? null,
    [instances, selectedPath],
  );

  const rootsByAgent = useMemo(() => {
    const map = new Map<string, DiscoveryRootRecord[]>();
    for (const root of roots) {
      const current = map.get(root.agentId);
      if (current) current.push(root);
      else map.set(root.agentId, [root]);
    }
    return map;
  }, [roots]);

  const linkFor = (skillPath: string, rootId: string): LinkRecord | undefined =>
    links.find((link) => link.skillPath === skillPath && link.targetRootId === rootId);

  const withBusy = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const writeBack = (root: DiscoveryRootRecord): void =>
    void withBusy(async () => {
      if (!selected) return;
      await workspaceService.linkSkill(selected.path, root.id);
      await load();
    });

  const removeLink = (link: LinkRecord): void =>
    void withBusy(async () => {
      await workspaceService.unlinkSkill(link.id);
      await load();
    });

  const outgoingLinks = selected ? links.filter((link) => link.skillPath === selected.path) : [];

  return (
    <div className="page">
      <PageHeader
        title="写回"
        subtitle="把 Skill 以软连接（Windows 为目录联接）写入其他 Agent 的 skills 目录——源目录保持唯一事实来源，不复制文件"
        actions={
          <Button onClick={() => void load()} disabled={busy || loading}>
            {loading ? "刷新中…" : "刷新"}
          </Button>
        }
      />

      {error ? <ErrorNotice error={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}

      <div className="notice-banner">
        <span aria-hidden="true">↔</span>
        <div>
          <strong>写回语义</strong>
          <p>
            在目标 Agent 目录中创建指向 Skill 真实目录的软连接；同名真实目录永不被覆盖，只有本应用创建的连接才会被移除。
            Windows 上优先使用目录联接（junction），无需管理员权限。
          </p>
        </div>
      </div>

      <div className="writeback-layout">
        <section className="panel-surface writeback-list-panel">
          <div className="panel-toolbar">
            <SearchField value={query} onChange={setQuery} placeholder="搜索要写回的 Skill…" />
          </div>
          {loading ? (
            <EmptyState title="加载中" body="读取 Skill、目录与既有连接…" />
          ) : filtered.length === 0 ? (
            <EmptyState title="暂无可写回的 Skill" body="先到「发现」页扫描并确认目录下存在 Skill。" />
          ) : (
            <ul className="govern-skill-list">
              {filtered.map((instance) => {
                const count = links.filter((link) => link.skillPath === instance.path).length;
                return (
                  <li key={instance.id}>
                    <button
                      type="button"
                      className={
                        instance.path === selectedPath
                          ? "govern-skill-item govern-skill-item-active"
                          : "govern-skill-item"
                      }
                      onClick={() => setSelectedPath(instance.path)}
                    >
                      <span className="govern-skill-heading">
                        <strong>{instance.name}</strong>
                        {count > 0 ? <StatusPill tone="green">已写回 {count}</StatusPill> : null}
                      </span>
                      <small>{agentName(instance.agentId)}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selected ? (
          <section className="panel-surface writeback-detail">
            <div className="inspector-title">
              <div>
                <h2>{selected.name}</h2>
                <p className="mono-cell" title={displayPath(selected.path)}>{displayPath(selected.path)}</p>
              </div>
              <StatusPill tone="blue">{outgoingLinks.length} 个连接</StatusPill>
            </div>

            {roots.length === 0 ? (
              <EmptyState title="没有可用的目标目录" body="目标 Agent 的 skills 目录尚未登记，先到「发现」页添加项目目录。" />
            ) : (
              <div className="target-groups">
                {Array.from(rootsByAgent.entries()).map(([agentId, agentRoots]) => (
                  <div key={agentId} className="target-group">
                    <h3>{agentName(agentId)}</h3>
                    {agentRoots.map((root) => {
                      const existing = linkFor(selected.path, root.id);
                      return (
                        <div key={root.id} className="target-row">
                          <div className="target-main">
                            <code title={displayPath(root.configuredPath)}>{displayPath(root.configuredPath)}</code>
                            <StatusPill tone={root.scope === "user" ? "blue" : "green"}>
                              {root.scope === "user" ? "用户" : "项目"}
                            </StatusPill>
                          </div>
                          {existing ? (
                            <Button onClick={() => removeLink(existing)} disabled={busy}>
                              移除连接
                            </Button>
                          ) : (
                            <Button variant="primary" onClick={() => writeBack(root)} disabled={busy}>
                              写回
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {outgoingLinks.length > 0 ? (
              <div className="inspector-section">
                <span className="section-label">当前 Skill 的连接</span>
                <ul className="link-list">
                  {outgoingLinks.map((link) => (
                    <li key={link.id}>
                      <code title={displayPath(link.linkPath)}>{displayPath(link.linkPath)}</code>
                      <span className="muted-help">{agentName(link.targetAgentId)}</span>
                      <Button onClick={() => removeLink(link)} disabled={busy}>移除</Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <section className="panel-surface">
        <div className="panel-title">全部连接记录（{links.length}）</div>
        {links.length === 0 ? (
          <EmptyState title="还没有创建任何连接" body="选择左侧 Skill，在右侧目标目录上点击「写回」。" />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>目标 Agent</th>
                  <th>连接位置</th>
                  <th>创建时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id}>
                    <td>{link.skillName || link.skillPath}</td>
                    <td>{agentName(link.targetAgentId)}</td>
                    <td className="mono-cell" title={displayPath(link.linkPath)}>{displayPath(link.linkPath)}</td>
                    <td>{formatTimestamp(link.createdAt)}</td>
                    <td>
                      <Button onClick={() => removeLink(link)} disabled={busy}>移除</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const formatTimestamp = (seconds: number): string => {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
};
