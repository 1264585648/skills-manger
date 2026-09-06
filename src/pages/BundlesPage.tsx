import { useEffect, useState } from "react";
import { Button, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Bundle, Skill } from "../types/domain";

export function BundlesPage() {
  const [bundles, setBundles] = useState<Bundle[]>([]); const [skills, setSkills] = useState<Skill[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { void Promise.all([workspaceService.getBundles(), workspaceService.getSkills()]).then(([nextBundles, nextSkills]) => { setBundles(nextBundles); setSkills(nextSkills); setSelectedId(nextBundles[0]?.id ?? null); }); }, []);
  const selected = bundles.find((item) => item.id === selectedId) ?? bundles[0];
  const selectedSkills = selected ? selected.skillIds.map((id) => skills.find((skill) => skill.id === id)).filter((skill): skill is Skill => Boolean(skill)) : [];

  return <section className="page">
    <PageHeader title="Bundles" subtitle="把经常一起使用的 Skills 组织成可部署组合。" actions={<Button variant="primary">＋ 新建 Bundle</Button>} />
    <div className="workbench bundle-workbench">
      <aside className="panel-surface bundle-list"><div className="panel-title">我的 Bundles</div>{bundles.map((bundle) => <button className={selected?.id === bundle.id ? "bundle-item active" : "bundle-item"} key={bundle.id} onClick={() => setSelectedId(bundle.id)} type="button"><span><strong>{bundle.name}</strong><small>{bundle.skillIds.length} Skills</small></span><span>›</span></button>)}</aside>
      <section className="panel-surface bundle-editor">{selected ? <><div className="bundle-heading"><div><span className="eyebrow">Selected Bundle</span><h2>{selected.name}</h2><p>{selected.description}</p></div><StatusPill tone={selected.conflict ? "amber" : "green"}>{selected.conflict ? "1 个问题" : "Ready"}</StatusPill></div><div className="bundle-meta-strip"><span>{selectedSkills.length} Skills</span><span>{selected.targets.length} Targets</span><span>更新于 {selected.updatedAt}</span></div><div className="bundle-skill-list"><span className="section-label">Included Skills</span>{selectedSkills.map((skill, index) => <div className="bundle-skill-row" key={skill.id}><span className="order-index">{String(index + 1).padStart(2, "0")}</span><i className="skill-glyph">✦</i><span><strong>{skill.name}</strong><small>{index < 2 ? "Required" : "Optional"}</small></span><StatusPill tone={index < 2 ? "blue" : "gray"}>{index < 2 ? "Required" : "Optional"}</StatusPill></div>)}</div>{selected.conflict ? <div className="inline-alert"><span>!</span><div><strong>发现潜在冲突</strong><p>{selected.conflict}</p></div><Button variant="ghost">查看</Button></div> : null}</> : null}</section>
      <aside className="panel-surface inspector">{selected ? <><div className="inspector-title simple"><div><h2>Bundle 概览</h2><p>部署前先生成可解释的 Sync Plan。</p></div></div><dl className="detail-list spacious"><div><dt>名称</dt><dd>{selected.name}</dd></div><div><dt>目标</dt><dd>{selected.targets.join(" · ")}</dd></div><div><dt>兼容性</dt><dd>Claude Code ✓ · Codex △</dd></div><div><dt>更新</dt><dd>{selected.updatedAt}</dd></div></dl><div className="inspector-actions"><Button variant="primary">预览部署</Button><Button>保存 Bundle</Button></div></> : null}</aside>
    </div>
  </section>;
}
