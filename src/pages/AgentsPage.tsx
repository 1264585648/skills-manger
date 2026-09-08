import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, PageHeader, StatusPill } from "../components/ui";
import { formatTimestamp } from "../services/formatTimestamp";
import { workspaceService } from "../services/workspaceService";
import type { Agent, AgentStatus } from "../types/domain";

const statusMeta: Record<
  AgentStatus,
  { label: string; tone: "green" | "amber" | "red" | "gray" }
> = {
  ready: { label: "已检测", tone: "green" },
  limited: { label: "能力受限", tone: "amber" },
  setup: { label: "需配置", tone: "gray" },
  error: { label: "异常", tone: "red" },
};

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const items = await workspaceService.getAgents();
      setAgents(items);
      setSelectedId((current) =>
        current && items.some((item) => item.id === current)
          ? current
          : items[0]?.id ?? null,
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取 Agent 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      await workspaceService.scanClaudeCode();
      await loadAgents();
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "重新检测失败");
    } finally {
      setScanning(false);
    }
  };

  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const ready = agents.filter((agent) => agent.status === "ready").length;
  const limited = agents.filter((agent) => agent.status === "limited").length;

  return (
    <section className="page">
      <PageHeader
        title="Agents"
        subtitle="发现本机 Agent，并明确每个目标真正支持的只读能力。"
        actions={<Button variant="primary" disabled={scanning} onClick={() => void handleScan()}>{scanning ? "检测中…" : "重新检测"}</Button>}
      />
      {error ? <div className="inline-notice notice-error">{error}</div> : null}
      <div className="summary-row summary-three">
        <article><span>已登记</span><strong>{agents.length}</strong></article>
        <article><span>已检测</span><strong>{ready}</strong></article>
        <article><span>能力受限</span><strong>{limited}</strong></article>
      </div>
      <div className="workbench agents-workbench">
        <section className="panel-surface agent-list-panel">
          <div className="agent-list-header"><span>Agent</span><span>能力</span><span>状态</span></div>
          {loading ? (
            <EmptyState title="正在读取 Agent" body="从本地发现数据库加载目标。" />
          ) : agents.length === 0 ? (
            <EmptyState title="尚未登记 Agent" body="点击“重新检测”检查 Claude Code。" />
          ) : agents.map((agent) => {
            const meta = statusMeta[agent.status];
            return (
              <button className={selected?.id === agent.id ? "agent-row selected" : "agent-row"} key={agent.id} onClick={() => setSelectedId(agent.id)} type="button">
                <span className="agent-main"><i className="agent-icon">A</i><span><strong>{agent.name}</strong><small>{agent.type}</small></span></span>
                <span className="capability-preview">{agent.capabilities.slice(0, 3).join(" · ")}</span>
                <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
              </button>
            );
          })}
        </section>
        <aside className="panel-surface inspector agent-inspector">
          {selected ? <>
            <div className="inspector-title"><i className="agent-icon large">A</i><div><h2>{selected.name}</h2><p>{selected.type}</p></div></div>
            {selected.warning ? <div className="discovery-warning">{selected.warning}</div> : null}
            <dl className="detail-list">
              <div><dt>版本</dt><dd>{selected.version}</dd></div>
              <div><dt>路径</dt><dd className="path-value">{selected.path}</dd></div>
              <div><dt>Scope</dt><dd>{selected.scopes.join(" · ") || "待配置"}</dd></div>
              <div><dt>已发现 Skills</dt><dd>{selected.discoveredSkills}</dd></div>
              <div><dt>上次扫描</dt><dd>{selected.lastScannedAt ? formatTimestamp(selected.lastScannedAt) : "—"}</dd></div>
            </dl>
            <div className="inspector-section"><span className="section-label">Capabilities</span><div className="capability-cloud">{selected.capabilities.map((item) => <span key={item}>{item}</span>)}</div></div>
            <div className="inspector-actions"><Button variant="primary" disabled>查看 Skills</Button><Button disabled>测试目标</Button></div>
          </> : null}
        </aside>
      </div>
    </section>
  );
}
