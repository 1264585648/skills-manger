import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, PageHeader, SearchField, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Skill, SkillStatus } from "../types/domain";

const statusMeta: Record<SkillStatus, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  clean: { label: "Clean", tone: "green" }, update: { label: "Update", tone: "amber" }, unmanaged: { label: "Unmanaged", tone: "gray" }, conflict: { label: "Conflict", tone: "red" }, missing: { label: "Missing", tone: "red" },
};

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]); const [query, setQuery] = useState(""); const [group, setGroup] = useState("全部"); const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { void workspaceService.getSkills().then((items) => { setSkills(items); setSelectedId(items[0]?.id ?? null); }); }, []);
  const groups = useMemo(() => ["全部", ...Array.from(new Set(skills.flatMap((item) => item.groups)))], [skills]);
  const filtered = useMemo(() => { const normalized = query.trim().toLowerCase(); return skills.filter((skill) => { const matchesGroup = group === "全部" || skill.groups.includes(group); const matchesQuery = !normalized || `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(normalized); return matchesGroup && matchesQuery; }); }, [group, query, skills]);
  const selected = skills.find((skill) => skill.id === selectedId) ?? filtered[0];
  const cleanCount = skills.filter((skill) => skill.status === "clean").length; const attentionCount = skills.filter((skill) => skill.status !== "clean").length;

  return <section className="page">
    <PageHeader title="Skills" subtitle="统一管理本地 Skills 资产、来源与状态。" actions={<Button variant="primary">＋ 导入 Skill</Button>} />
    <div className="summary-row summary-three"><article><span>全部 Skills</span><strong>{skills.length}</strong></article><article><span>状态正常</span><strong>{cleanCount}</strong></article><article><span>需要关注</span><strong>{attentionCount}</strong></article></div>
    <div className="workbench skills-workbench">
      <aside className="workbench-nav panel-surface"><div className="panel-title">分组</div>{groups.slice(0, 6).map((item) => <button className={group === item ? "subnav-item active" : "subnav-item"} key={item} onClick={() => setGroup(item)} type="button"><span>{item}</span><small>{item === "全部" ? skills.length : skills.filter((skill) => skill.groups.includes(item)).length}</small></button>)}</aside>
      <section className="panel-surface skill-list-panel">
        <div className="panel-toolbar"><SearchField value={query} onChange={setQuery} placeholder="搜索 Skill、来源…" /><Button variant="ghost">筛选</Button></div>
        <div className="skill-table-head"><span>Skill</span><span>来源</span><span>状态</span><span>版本</span></div>
        <div className="skill-list">{filtered.length === 0 ? <EmptyState title="没有匹配的 Skill" body="调整搜索词或分组后再试。" /> : filtered.map((skill) => { const meta = statusMeta[skill.status]; return <button className={selected?.id === skill.id ? "skill-row selected" : "skill-row"} key={skill.id} onClick={() => setSelectedId(skill.id)} type="button"><span className="skill-name-cell"><i className="skill-glyph">✦</i><span><strong>{skill.name}</strong><small>{skill.description}</small></span></span><span className="muted-cell">{skill.source}</span><span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></span><span className="mono-cell">{skill.version}</span></button>; })}</div>
      </section>
      <aside className="panel-surface inspector">{selected ? <><div className="inspector-title"><i className="large-skill-glyph">✦</i><div><h2>{selected.name}</h2><p>{selected.description}</p></div></div><div className="inspector-section"><span className="section-label">概览</span><dl className="detail-list"><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>版本</dt><dd>{selected.version}</dd></div><div><dt>分组</dt><dd>{selected.groups.join(" · ") || "—"}</dd></div><div><dt>部署</dt><dd>{selected.targets.join(" · ") || "尚未部署"}</dd></div><div><dt>安全</dt><dd>{selected.security}</dd></div><div><dt>更新</dt><dd>{selected.lastUpdated}</dd></div></dl></div><div className="inspector-actions"><Button variant="primary">部署到 Agent</Button><Button>查看详情</Button></div></> : null}</aside>
    </div>
  </section>;
}
