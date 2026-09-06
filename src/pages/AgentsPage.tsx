import { useEffect, useState } from "react";
import { Button, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Agent, AgentStatus } from "../types/domain";

const statusMeta: Record<AgentStatus, { label: string; tone: "green" | "amber" | "red" | "gray" }> = { ready: { label: "已检测", tone: "green" }, limited: { label: "能力受限", tone: "amber" }, setup: { label: "需配置", tone: "gray" }, error: { label: "异常", tone: "red" } };

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { void workspaceService.getAgents().then((items) => { setAgents(items); setSelectedId(items[0]?.id ?? null); }); }, []);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0]; const ready = agents.filter((agent) => agent.status === "ready").length; const limited = agents.filter((agent) => agent.status === "limited").length;

  return <section className="page"><PageHeader title="Agents" subtitle="发现本机 Agent，并明确每个目标真正支持的同步能力。" actions={<Button variant="primary">重新检测</Button>} />
    <div className="summary-row summary-three"><article><span>已发现</span><strong>{agents.length}</strong></article><article><span>可直接同步</span><strong>{ready}</strong></article><article><span>受限 / 导出</span><strong>{limited}</strong></article></div>
    <div className="workbench agents-workbench"><section className="panel-surface agent-list-panel"><div className="agent-list-header"><span>Agent</span><span>能力</span><span>状态</span></div>{agents.map((agent) => { const meta = statusMeta[agent.status]; return <button className={selected?.id === agent.id ? "agent-row selected" : "agent-row"} key={agent.id} onClick={() => setSelectedId(agent.id)} type="button"><span className="agent-main"><i className="agent-icon">A</i><span><strong>{agent.name}</strong><small>{agent.type}</small></span></span><span className="capability-preview">{agent.capabilities.slice(0, 3).join(" · ")}</span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></button>; })}</section>
    <aside className="panel-surface inspector agent-inspector">{selected ? <><div className="inspector-title"><i className="agent-icon large">A</i><div><h2>{selected.name}</h2><p>{selected.type}</p></div></div><dl className="detail-list"><div><dt>版本</dt><dd>{selected.version}</dd></div><div><dt>路径</dt><dd className="path-value">{selected.path}</dd></div><div><dt>Scope</dt><dd>{selected.scopes.join(" · ") || "待配置"}</dd></div><div><dt>已发现 Skills</dt><dd>{selected.discoveredSkills}</dd></div></dl><div className="inspector-section"><span className="section-label">Capabilities</span><div className="capability-cloud">{selected.capabilities.map((item) => <span key={item}>{item}</span>)}</div></div><div className="inspector-actions"><Button variant="primary">查看 Skills</Button><Button>测试目标</Button></div></> : null}</aside></div>
  </section>;
}
