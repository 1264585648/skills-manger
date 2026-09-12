import { useCallback, useEffect, useMemo, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Button, EmptyState, ErrorNotice, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Bundle, Skill } from "../types/domain";

export function BundlesPage({ onNavigateToSync,onAddToAgent }: { onNavigateToSync: (bundleId: string) => void;onAddToAgent?:(bundleId:string)=>void }) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [nextBundles, nextSkills] = await Promise.all([
        workspaceService.getBundles(),
        workspaceService.getSkills(),
      ]);
      setBundles(nextBundles);
      setSkills(nextSkills.filter((skill) => !skill.id.startsWith("instance:")));
      setSelectedId((current) => current && nextBundles.some((item) => item.id === current) ? current : nextBundles[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError : new Error("读取 Bundle 失败"));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selected = bundles.find((item) => item.id === selectedId) ?? bundles[0];
  const selectedSkills = useMemo(
    () => selected ? selected.skillIds.map((id) => skills.find((skill) => skill.id === id)).filter((skill): skill is Skill => Boolean(skill)) : [],
    [selected, skills],
  );

  const beginCreate = () => {
    setSelectedId(null);
    setName("");
    setDescription("");
    setSkillIds([]);
    setEditing(true);
  };
  const beginEdit = () => {
    if (!selected) return;
    setName(selected.name);
    setDescription(selected.description);
    setSkillIds(selected.skillIds);
    setEditing(true);
  };
  const toggleSkill = (id: string) => setSkillIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const record = await workspaceService.saveBundle({
        id: selectedId,
        name,
        description,
        items: skillIds.map((skillId) => ({ skillId, mode: "required" })),
      });
      setEditing(false);
      await load();
      setSelectedId(record.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError : new Error("保存 Bundle 失败"));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!selected || !(await confirm(`删除 Bundle“${selected.name}”？不会删除任何 Skill 或 Agent 文件。`))) return;
    setBusy(true);
    try {
      await workspaceService.deleteBundle(selected.id);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError : new Error("删除 Bundle 失败"));
    } finally {
      setBusy(false);
    }
  };

  return <section className="page">
    <PageHeader title="Bundles" subtitle="把 Canonical Library Skills 组织成可部署组合。" actions={<>{selected&&!editing&&onAddToAgent?<Button onClick={()=>onAddToAgent(selected.id)}>添加到 Agent</Button>:null}<Button variant="primary" onClick={beginCreate}>＋ 新建 Bundle</Button></>} />
    {error ? <ErrorNotice error={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
    <div className="workbench bundle-workbench">
      <aside className="panel-surface bundle-list"><div className="panel-title">我的 Bundles</div>{bundles.length === 0 ? <p className="muted-help bundle-empty-help">尚无 Bundle</p> : bundles.map((bundle) => <button className={selected?.id === bundle.id ? "bundle-item active" : "bundle-item"} key={bundle.id} onClick={() => { setSelectedId(bundle.id); setEditing(false); }} type="button"><span><strong>{bundle.name}</strong><small>{bundle.skillIds.length} Skills</small></span><span>›</span></button>)}</aside>
      <section className="panel-surface bundle-editor">
        {editing ? <>
          <div className="bundle-heading"><div><span className="eyebrow">Bundle Editor</span><h2>{selectedId ? "编辑 Bundle" : "新建 Bundle"}</h2><p>仅保存组合定义，不写入 Agent。</p></div></div>
          <label className="bundle-field"><span>名称</span><input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
          <label className="bundle-field"><span>描述</span><textarea value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="bundle-skill-picker"><span className="section-label">Canonical Library Skills</span>{skills.length === 0 ? <EmptyState title="Library 为空" body="请先导入至少一个 Skill。" /> : skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={skillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} /><span><strong>{skill.name}</strong><small>{skill.description}</small></span></label>)}</div>
          <div className="bundle-editor-actions"><Button disabled={busy} onClick={() => setEditing(false)}>取消</Button><Button variant="primary" disabled={busy || !name.trim() || skillIds.length === 0} onClick={() => void save()}>{busy ? "保存中…" : "保存 Bundle"}</Button></div>
        </> : selected ? <>
          <div className="bundle-heading"><div><span className="eyebrow">Selected Bundle</span><h2>{selected.name}</h2><p>{selected.description}</p></div><StatusPill tone="green">Ready</StatusPill></div>
          <div className="bundle-meta-strip"><span>{selectedSkills.length} Skills</span><span>只读 Planner</span><span>更新于 {selected.updatedAt}</span></div>
          <div className="bundle-skill-list"><span className="section-label">Included Skills</span>{selectedSkills.map((skill, index) => <div className="bundle-skill-row" key={skill.id}><span className="order-index">{String(index + 1).padStart(2, "0")}</span><i className="skill-glyph">✦</i><span><strong>{skill.name}</strong><small>Required</small></span><StatusPill tone="blue">Required</StatusPill></div>)}</div>
        </> : <EmptyState title="选择或新建 Bundle" body="Bundle 只引用 Canonical Library 中的 Skill。" />}
      </section>
      <aside className="panel-surface inspector">{selected && !editing ? <><div className="inspector-title simple"><div><h2>Bundle 概览</h2><p>部署前先生成可解释的 Sync Plan。</p></div></div><dl className="detail-list spacious"><div><dt>名称</dt><dd>{selected.name}</dd></div><div><dt>目标</dt><dd>Claude Code</dd></div><div><dt>更新</dt><dd>{selected.updatedAt}</dd></div></dl><div className="inspector-actions"><Button variant="primary" disabled={!selected} onClick={() => onNavigateToSync(selected.id)}>前往 Sync 预览</Button><Button onClick={beginEdit}>编辑 Bundle</Button><Button disabled={busy} onClick={() => void remove()}>删除 Bundle</Button></div></> : null}</aside>
    </div>
  </section>;
}
