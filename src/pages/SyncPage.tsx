import { useEffect, useState } from "react";
import { Button, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { SyncAction, SyncItem } from "../types/domain";

const actionMeta: Record<SyncAction, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = { add: { label: "新增", tone: "blue" }, update: { label: "更新", tone: "amber" }, unchanged: { label: "无变化", tone: "gray" }, conflict: { label: "冲突", tone: "red" } };

export function SyncPage() {
  const [items, setItems] = useState<SyncItem[]>([]); const [resolution, setResolution] = useState("review");
  useEffect(() => { void workspaceService.getSyncItems().then(setItems); }, []);
  const conflict = items.find((item) => item.action === "conflict");
  return <section className="page"><PageHeader title="Sync" subtitle="同步前先看清会改什么，再执行可恢复的写入。" />
    <div className="sync-context panel-surface"><label><span>目标 Agent</span><button type="button">Claude Code · User <b>⌄</b></button></label><label><span>Bundle</span><button type="button">研发通用工具包 <b>⌄</b></button></label><div className="sync-context-spacer" /><StatusPill tone={conflict ? "amber" : "green"}>{conflict ? "1 个冲突待处理" : "Ready"}</StatusPill><Button variant="primary" disabled={Boolean(conflict)}>执行同步</Button></div>
    <div className="workbench sync-workbench"><section className="panel-surface sync-plan"><div className="bundle-heading compact"><div><span className="eyebrow">Sync Plan</span><h2>这次将修改 {items.filter((item) => item.action !== "unchanged").length} 个 Skill</h2></div><span className="plan-hash">plan · a7d3</span></div><div className="sync-list">{items.map((item) => { const meta = actionMeta[item.action]; return <div className="sync-row" key={item.id}><span className="sync-skill"><i className="skill-glyph">✦</i><span><strong>{item.skillName}</strong><small>{item.reason}</small></span></span><span className="version-flow"><small>{item.current}</small><b>→</b><small>{item.target}</small></span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></div>; })}</div>
    {conflict ? <div className="conflict-card"><div className="conflict-head"><span>!</span><div><strong>{conflict.skillName} 需要决策</strong><p>目标副本已经被直接修改，管理器不会静默覆盖。</p></div></div><div className="resolution-options">{[{ id: "review", label: "先查看 Diff" }, { id: "library", label: "使用 Library 版本" }, { id: "target", label: "保留目标版本" }].map((option) => <button className={resolution === option.id ? "resolution active" : "resolution"} key={option.id} onClick={() => setResolution(option.id)} type="button"><i />{option.label}</button>)}</div></div> : null}
    <div className="sync-steps"><span className="done">Resolve</span><b>→</b><span className="current">Drift Check</span><b>→</b><span>Snapshot</span><b>→</b><span>Apply</span><b>→</b><span>Verify</span></div></section>
    <aside className="panel-surface inspector"><div className="inspector-title simple"><div><h2>同步摘要</h2><p>所有写入都由 Planner 生成并记录。</p></div></div><dl className="detail-list spacious"><div><dt>目标</dt><dd>Claude Code · User</dd></div><div><dt>Bundle</dt><dd>研发通用工具包</dd></div><div><dt>风险</dt><dd>{conflict ? "需要处理冲突" : "低"}</dd></div><div><dt>Snapshot</dt><dd>执行前自动创建</dd></div></dl><div className="verify-box"><span className="section-label">执行前检查</span><p>✓ 目标目录可写</p><p>✓ Ownership 已确认</p><p>{conflict ? "○ 冲突尚未处理" : "✓ 无阻断冲突"}</p></div><div className="inspector-actions"><Button variant="primary">查看 Diff</Button><Button>创建快照</Button></div></aside></div>
  </section>;
}
