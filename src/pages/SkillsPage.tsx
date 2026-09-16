import { useCallback, useEffect, useMemo, useState } from "react";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ChevronLeft, ChevronRight, Code2, FileText, ListChecks, Palette, Plus, Puzzle, RefreshCw, Search, ShieldCheck, Sparkles, Tags, Trash2, Pencil, Undo2 } from "lucide-react";
import { Drawer } from "../components/agents/Drawer";
import { ImportWizard } from "../components/ImportWizard";
import { Button, EmptyState, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import { filterSkills, isLibrarySkill, readViewPreferences, suggestTagNames, type SkillsViewMode, type SkillsViewPreferences } from "../services/skillTagState";
import type { Skill, SkillStatus, SkillTag } from "../types/domain";
import type { SkillImportPlan } from "../types/import";
import "../agents.css";
import "../skillTags.css";

const statusMeta: Record<SkillStatus, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  clean: { label: "Clean", tone: "green" }, update: { label: "Update", tone: "amber" }, upstream_update: { label: "Upstream Update", tone: "amber" },
  local_modified: { label: "Local Modified", tone: "red" }, target_drift: { label: "Target Drift", tone: "red" }, unmanaged: { label: "Unmanaged", tone: "gray" }, conflict: { label: "Conflict", tone: "red" }, missing: { label: "Missing", tone: "red" },
};
const quickTagNames = ["编码", "UI", "办公", "Review"];
const sortTags = (values: SkillTag[]): SkillTag[] => [...values].sort((a, b) => {
  const aIndex = quickTagNames.indexOf(a.name);
  const bIndex = quickTagNames.indexOf(b.name);
  if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
  if (aIndex >= 0) return -1;
  if (bIndex >= 0) return 1;
  return a.name.localeCompare(b.name, "zh-CN");
});
type Notice = { tone: "success" | "error"; text: string } | null;
type Assignment = { skillId: string; tagNames: string[] };

function SkillCard({ skill, selecting, selected, onSelect, onOpen, onAddToAgent }: { skill: Skill; selecting: boolean; selected: boolean; onSelect: () => void; onOpen: () => void; onAddToAgent?: (ids: string[]) => void }) {
  const category = skill.tags.find((tag) => quickTagNames.includes(tag));
  const Icon = category === "编码" ? Code2 : category === "UI" ? Palette : category === "办公" ? FileText : category === "Review" ? ShieldCheck : Puzzle;
  const tone = category === "编码" ? "blue" : category === "UI" ? "rose" : category === "办公" ? "green" : "neutral";
  return <article className={`skill-card${selected ? " selected" : ""}`}>
    <button className="skill-card-open" type="button" aria-label={`查看 ${skill.name}`} onClick={onOpen}>
      <span className="skill-card-heading"><span className={`skill-card-icon skill-icon-${tone}`} aria-hidden="true"><Icon size={23} strokeWidth={1.8} /></span><strong title={skill.name}>{skill.name}</strong></span>
      <span className="skill-card-description">{skill.description || "暂无描述"}</span>
    </button>
    {selecting ? <label className="skill-card-select"><input type="checkbox" checked={selected} disabled={!isLibrarySkill(skill)} aria-label={`选择 ${skill.name}`} onChange={onSelect} /></label> : isLibrarySkill(skill) && onAddToAgent ? <button className="skill-card-add skill-icon-button" type="button" aria-label={`添加 ${skill.name} 到 Agent`} title="添加到 Agent" onClick={() => onAddToAgent([skill.id])}><Plus size={21} /></button> : null}
  </article>;
}

function SkillRow({ skill, mode, selected, selectable, tagList, onSelect, onOpen, onQuickTag }: { skill: Skill; mode: SkillsViewMode; selected: boolean; selectable: boolean; tagList: SkillTag[]; onSelect: () => void; onOpen: () => void; onQuickTag: (name: string) => void }) {
  const meta = statusMeta[skill.status];
  return <div className={selected ? "skill-row selected" : "skill-row"} onClick={onOpen}>
    <span className="skill-select"><input type="checkbox" checked={selected} disabled={!selectable} aria-label={`选择 ${skill.name}`} onChange={onSelect} onClick={(event) => event.stopPropagation()} /></span>
    <span className="skill-name-cell"><i className="skill-glyph">S</i><span><button className="skill-row-open" type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }}>{skill.name}</button><small>{skill.description}</small></span></span>
    <span className="skill-tags-cell">{skill.tags.length ? skill.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>) : <span className="muted-cell">未分组</span>}</span>
    <span className="muted-cell" title={skill.sourcePath}>{skill.source}</span><span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></span><span className="mono-cell">{skill.version}</span>
    {mode === "organize" ? <span className="quick-tag-actions">{quickTagNames.map((name) => tagList.find((tag) => tag.name === name) ? <button key={name} type="button" onClick={(event) => { event.stopPropagation(); onQuickTag(name); }}>{name}</button> : null)}</span> : null}
  </div>;
}

function SkillDetail({ skill, tags, busy, onClose, onToggleTag, onClear, onAddToAgent, onCheckSource, onPromoteSource }: { skill: Skill; tags: SkillTag[]; busy: boolean; onClose: () => void; onToggleTag: (name: string) => void; onClear: () => void; onAddToAgent?: (ids: string[]) => void; onCheckSource: (sourceId: string) => void; onPromoteSource: (sourceId: string) => void }) {
  const discovery = !isLibrarySkill(skill);
  return <Drawer title={skill.name} subtitle={skill.description} onClose={onClose}>
    <StatusPill tone={statusMeta[skill.status].tone}>{statusMeta[skill.status].label}</StatusPill>
    <div className="inspector-section"><span className="section-label">{discovery ? "Discovery" : "Library"}</span><dl className="detail-list"><div><dt>来源</dt><dd title={skill.sourcePath}>{skill.source}</dd></div><div><dt>版本</dt><dd>{skill.version}</dd></div><div><dt>标签</dt><dd className="detail-tags">{skill.tags.length ? skill.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>) : "未分组"}</dd></div><div><dt>Content Hash</dt><dd className="hash-value" title={skill.contentHash}>{skill.contentHash?.slice(0, 12) ?? "—"}</dd></div><div><dt>License</dt><dd>{skill.license ?? "—"}</dd></div><div><dt>Compatibility</dt><dd>{skill.compatibility ?? "—"}</dd></div><div><dt>安全</dt><dd>{skill.security}</dd></div><div><dt>更新</dt><dd>{skill.lastUpdated}</dd></div></dl></div>
    {!discovery ? <div className="detail-tag-editor"><span className="section-label">编辑标签</span><div className="tag-choice-list">{tags.map((tag) => <button className={skill.tags.includes(tag.name) ? "tag-choice active" : "tag-choice"} key={tag.id} type="button" onClick={() => onToggleTag(tag.name)}>{skill.tags.includes(tag.name) ? "✓ " : ""}{tag.name}</button>)}</div><Button onClick={onClear}>清除标签</Button></div> : <p className="readonly-discovery-note">只读发现，尚未纳入 Library；不会写入或执行 Agent 目录内容。</p>}
    <div className="inspector-actions">{!discovery && onAddToAgent ? <Button variant="primary" onClick={() => onAddToAgent([skill.id])}>添加到 Agent</Button> : null}{skill.trackedSourceId ? <Button disabled={busy} onClick={() => onCheckSource(skill.trackedSourceId!)}>{busy ? "检查中…" : "检查 Git 更新"}</Button> : null}{skill.trackedSourceId && skill.canPromote ? <Button variant="primary" disabled={busy} onClick={() => onPromoteSource(skill.trackedSourceId!)}>提升 Upstream</Button> : null}</div>
  </Drawer>;
}

export function SkillsPage({ onAddToAgent }: { onAddToAgent?: (ids: string[]) => void }) {
  const stored = useMemo(() => readViewPreferences(localStorage.getItem("skills.viewPreferences")), []);
  const [skills, setSkills] = useState<Skill[]>([]); const [tags, setTags] = useState<SkillTag[]>([]); const [preferences, setPreferences] = useState<SkillsViewPreferences>(stored ?? { mode: "browse", tagId: "all", query: "", page: 1 });
  const [selecting, setSelecting] = useState(false);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); const [selectedIds, setSelectedIds] = useState<string[]>([]); const [detailOpen, setDetailOpen] = useState(false); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState<Notice>(null); const [sourceBusy, setSourceBusy] = useState(false); const [undoBatch, setUndoBatch] = useState<Assignment[] | null>(null); const [tagEditorOpen, setTagEditorOpen] = useState(false); const [tagName, setTagName] = useState(""); const [editingTag, setEditingTag] = useState<SkillTag | null>(null); const [suggestionsOpen, setSuggestionsOpen] = useState(false); const [suggestionIds, setSuggestionIds] = useState<Record<string, string[]>>({}); const [preparingImport, setPreparingImport] = useState(false); const [executingImport, setExecutingImport] = useState(false); const [importPlan, setImportPlan] = useState<SkillImportPlan | null>(null);
  const { mode, tagId: activeTagId, query, page } = preferences;

  const loadData = useCallback(async () => { setLoading(true); try { const [items, nextTags] = await Promise.all([workspaceService.getSkills(), workspaceService.getTags()]); setSkills(items); setTags(sortTags(nextTags)); setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "读取 Skills 失败" }); } finally { setLoading(false); } }, []);
  useEffect(() => { void loadData(); }, [loadData]); useEffect(() => { localStorage.setItem("skills.viewPreferences", JSON.stringify(preferences)); }, [preferences]);
  const librarySkills = useMemo(() => skills.filter(isLibrarySkill), [skills]); const ungroupedCount = librarySkills.filter((skill) => skill.tags.length === 0).length; const selected = skills.find((skill) => skill.id === selectedId) ?? null; const tagByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag])), [tags]);
  const filtered = useMemo(() => filterSkills(skills, tags, preferences), [preferences, skills, tags]); const pageCount = Math.max(1, Math.ceil(filtered.length / 50)); const safePage = Math.min(page, pageCount); const pageItems = filtered.slice((safePage - 1) * 50, safePage * 50); const selectableItems = pageItems.filter(isLibrarySkill); const allSelected = selectableItems.length > 0 && selectableItems.every((skill) => selectedIds.includes(skill.id));
  useEffect(() => { if (page !== safePage) setPreferences((current) => ({ ...current, page: safePage })); }, [page, safePage]);
  const changePreferences = (patch: Partial<SkillsViewPreferences>) => { setPreferences((current) => ({ ...current, ...patch, page: patch.page ?? 1 })); setSelectedIds([]); };
  const assignmentsFromNames = (items: Assignment[]) => items.map((item) => ({ skillId: item.skillId, tagIds: item.tagNames.map((name) => tagByName.get(name)?.id).filter((id): id is string => Boolean(id)) }));
  const updateAssignments = async (items: Assignment[], text: string, recordUndo = true) => { const previous = items.map(({ skillId }) => ({ skillId, tagNames: skills.find((skill) => skill.id === skillId)?.tags ?? [] })); try { await workspaceService.updateSkillTagAssignments(assignmentsFromNames(items)); if (recordUndo) setUndoBatch(previous); await loadData(); setSelectedIds([]); setNotice({ tone: "success", text }); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "标签保存失败" }); } };
  const toggleTag = (skillId: string, name: string) => { const skill = skills.find((item) => item.id === skillId); if (!skill || !isLibrarySkill(skill)) return; const next = skill.tags.includes(name) ? skill.tags.filter((tag) => tag !== name) : [...skill.tags, name]; void updateAssignments([{ skillId, tagNames: next }], `已更新“${skill.name}”的标签`); };
  const addTag = (skillIds: string[], name: string, replace = false) => void updateAssignments(skillIds.map((skillId) => { const skill = skills.find((item) => item.id === skillId); return { skillId, tagNames: replace ? [name] : Array.from(new Set([...(skill?.tags ?? []), name])) }; }), `已为 ${skillIds.length} 个 Skill 添加“${name}”标签`);
  const undo = async () => { if (!undoBatch) return; const batch = undoBatch; setUndoBatch(null); await updateAssignments(batch, "已撤销上次标签调整", false); };
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return; const target = event.target as HTMLElement | null; if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return; if (event.key.toLowerCase() === "u") { event.preventDefault(); void undo(); return; } const name = quickTagNames[Number(event.key) - 1]; if (!name || mode !== "organize") return; const skillId = selectedIds[0] ?? pageItems[0]?.id; if (skillId) { event.preventDefault(); addTag([skillId], name, true); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [addTag, mode, pageItems, selectedIds, undo]);
  const openSuggestions = () => { const next: Record<string, string[]> = {}; pageItems.forEach((skill) => { next[skill.id] = suggestTagNames(skill, tags); }); setSuggestionIds(next); setSuggestionsOpen(true); };
  const applySuggestions = () => { const items = pageItems.map((skill) => ({ skillId: skill.id, tagNames: Array.from(new Set([...skill.tags, ...(suggestionIds[skill.id] ?? [])])) })).filter((item) => item.tagNames.length); void updateAssignments(items, `已应用 ${items.length} 条标签建议`); setSuggestionsOpen(false); };
  const handlePrepareImport = async () => { setPreparingImport(true); try { const plan = await workspaceService.previewSkillFromPicker(); if (plan) setImportPlan(plan); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "扫描 Skill 失败" }); } finally { setPreparingImport(false); } };
  const handleConfirmImport = async () => { if (!importPlan) return; if (!importPlan.summary.add && !importPlan.summary.update) { setImportPlan(null); return; } setExecutingImport(true); try { const results = await workspaceService.executeImportPlan(importPlan); await loadData(); setImportPlan(null); if (results.at(-1)) setSelectedId(results.at(-1)!.skill.id); setNotice({ tone: "success", text: `导入完成：新增 ${importPlan.summary.add}，更新 ${importPlan.summary.update}。` }); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "导入失败" }); } finally { setExecutingImport(false); } };
  const ask = async (message: string) => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? tauriConfirm(message) : window.confirm(message);
  const editTag = (tag: SkillTag | null) => { setGroupManagerOpen(false); setEditingTag(tag); setTagName(tag?.name ?? ""); setTagError(null); setTagEditorOpen(true); };
  const saveTag = async (event: React.FormEvent) => { event.preventDefault(); if (!tagName.trim()) return; try { await workspaceService.upsertTag(tagName, editingTag?.id); setTagEditorOpen(false); setTagName(""); setEditingTag(null); await loadData(); } catch (error) { setTagError(error instanceof Error ? error.message : "分组保存失败"); } };
  const removeTag = async (tag: SkillTag) => { if (tag.isSystem || !(await ask(`删除标签“${tag.name}”？Skill 不会被删除。`))) return; try { await workspaceService.deleteTag(tag.id); if (activeTagId === tag.id) changePreferences({ tagId: "all" }); setUndoBatch(null); await loadData(); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "标签删除失败" }); } };
  const checkSource = async (sourceId: string) => { setSourceBusy(true); try { const result = await workspaceService.checkGitSource(sourceId); await loadData(); setNotice({ tone: "success", text: `检查完成：${result.skillName} · ${result.status}` }); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "检查 Git 更新失败" }); } finally { setSourceBusy(false); } };
  const promoteSource = async (sourceId: string) => { if (!(await ask("将已检查的 upstream 版本提升为 Canonical Library，是否继续？"))) return; setSourceBusy(true); try { const result = await workspaceService.promoteGitSource(sourceId); await loadData(); setNotice({ tone: "success", text: `${result.skill.name} 已更新到 upstream` }); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "提升 upstream 失败" }); } finally { setSourceBusy(false); } };

  const toggleSelection = (skillId: string) => setSelectedIds((current) => current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId]);
  const openSkill = (skillId: string) => { setSelectedId(skillId); setDetailOpen(true); };
  const showSelection = selecting || mode === "organize";

  return <section className="page skills-page"><PageHeader title="Skills" subtitle={`${librarySkills.length} 个本地 Skill · ${ungroupedCount} 个未分组 · ${skills.filter((skill) => skill.status !== "clean").length} 个需要关注`} actions={<><Button onClick={() => changePreferences({ mode: mode === "organize" ? "browse" : "organize", tagId: mode === "organize" ? "all" : "unassigned" })}>{mode === "organize" ? <ArrowLeft size={15} /> : <Tags size={15} />}{mode === "organize" ? "返回浏览" : "快速整理"}</Button><Button variant="primary" disabled={preparingImport || executingImport} onClick={() => void handlePrepareImport()}><Plus size={16} /> 导入 Skill</Button></>} />
    {notice ? <div className={`inline-notice notice-${notice.tone}`} role="status">{notice.text}</div> : null}
    <div className="skills-toolbar">
      <label className="skills-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索 Skill" value={query} onChange={(event) => changePreferences({ query: event.target.value })} placeholder="搜索 Skill、来源…" /></label>
      {mode === "organize" ? <Button onClick={openSuggestions} disabled={!pageItems.length}><Sparkles size={15} /> 生成建议</Button> : <button className="skill-icon-button" type="button" aria-label="批量选择" title="批量选择" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelectedIds([]); }}><ListChecks size={19} /></button>}
      <button className="skill-icon-button" type="button" aria-label="刷新 Skills" title="刷新" disabled={loading} onClick={() => void loadData()}><RefreshCw size={17} /></button>
    </div>
    <div className="skill-group-bar">
      <nav className="skill-group-nav" aria-label="Skill 分组">
        <button className="skill-group" type="button" aria-pressed={activeTagId === "all"} onClick={() => changePreferences({ mode: "browse", tagId: "all" })}>全部</button>
        {tags.map((tag) => <button className="skill-group" key={tag.id} type="button" aria-pressed={activeTagId === tag.id} title={`${tag.name} · ${tag.skillCount} 个 Skill`} onClick={() => changePreferences({ mode: "browse", tagId: tag.id })}>{tag.name}</button>)}
        <button className="skill-group" type="button" aria-pressed={activeTagId === "unassigned"} onClick={() => changePreferences({ mode: "browse", tagId: "unassigned" })}>未分组</button>
      </nav>
      <button className="skill-icon-button" type="button" aria-label="管理分组" title="管理分组" onClick={() => setGroupManagerOpen(true)}><Tags size={18} /></button>
    </div>
    {selectedIds.length ? <div className="bulk-toolbar"><strong>已选择 {selectedIds.length} 项</strong>{tags.map((tag) => <Button key={tag.id} onClick={() => addTag(selectedIds, tag.name)}>{tag.name}</Button>)}<Button onClick={() => void updateAssignments(selectedIds.map((skillId) => ({ skillId, tagNames: [] })), "已清除所选 Skill 的标签")}>清除标签</Button></div> : null}
    {showSelection ? <div className="skill-list-caption"><span>{mode === "organize" ? `待整理 ${filtered.length} 项` : `共 ${filtered.length} 项`}</span><label><input type="checkbox" checked={allSelected} disabled={!selectableItems.length} onChange={() => setSelectedIds(allSelected ? [] : selectableItems.map((skill) => skill.id))} /> 全选</label></div> : null}
    <div className={mode === "browse" ? "skill-card-grid" : "skill-organize-list"} aria-busy={loading}>
      {loading ? <div className="skill-loading" role="status" aria-label="正在读取 Skills">{Array.from({ length: 6 }, (_, index) => <div className="skill-card-skeleton" key={index}><span /><span /><span /></div>)}</div> : pageItems.length === 0 ? <div className="skills-empty"><EmptyState title={mode === "organize" ? "没有待整理 Skill" : "没有匹配的 Skill"} body="" /><Button onClick={() => changePreferences({ mode: "browse", tagId: "all", query: "" })}>查看全部</Button></div> : mode === "browse" ? pageItems.map((skill) => <SkillCard key={skill.id} skill={skill} selecting={showSelection} selected={selectedIds.includes(skill.id)} onSelect={() => toggleSelection(skill.id)} onOpen={() => openSkill(skill.id)} onAddToAgent={onAddToAgent} />) : <><div className="skill-table-head"><span /><span>Skill</span><span>分组</span><span>来源</span><span>状态</span><span>版本</span></div>{pageItems.map((skill) => <SkillRow key={skill.id} skill={skill} mode={mode} selected={selectedIds.includes(skill.id)} selectable={isLibrarySkill(skill)} tagList={tags} onSelect={() => toggleSelection(skill.id)} onOpen={() => openSkill(skill.id)} onQuickTag={(name) => addTag([skill.id], name, true)} />)}</>}
    </div>
    <div className="skills-pagination"><span>共 {filtered.length} 项</span><span>第 {safePage} / {pageCount} 页</span><button className="skill-icon-button" type="button" aria-label="上一页" title="上一页" disabled={safePage <= 1} onClick={() => changePreferences({ page: safePage - 1 })}><ChevronLeft size={18} /></button><button className="skill-icon-button" type="button" aria-label="下一页" title="下一页" disabled={safePage >= pageCount} onClick={() => changePreferences({ page: safePage + 1 })}><ChevronRight size={18} /></button></div>
    {detailOpen && selected ? <SkillDetail skill={selected} tags={tags} busy={sourceBusy} onClose={() => setDetailOpen(false)} onToggleTag={(name) => toggleTag(selected.id, name)} onClear={() => void updateAssignments([{ skillId: selected.id, tagNames: [] }], "已清除标签")} onAddToAgent={onAddToAgent} onCheckSource={(sourceId) => void checkSource(sourceId)} onPromoteSource={(sourceId) => void promoteSource(sourceId)} /> : null}
    {undoBatch ? <div className="undo-bar"><Undo2 size={14} /> 已完成标签调整 <button type="button" onClick={() => void undo()}>撤销</button></div> : null}
    {groupManagerOpen ? <Drawer title="管理分组" onClose={() => setGroupManagerOpen(false)} footer={<Button variant="primary" onClick={() => editTag(null)}><Plus size={16} /> 新建分组</Button>}><div className="skill-group-manager">{tags.map((tag) => <div className="skill-group-manager-row" key={tag.id}><span><strong>{tag.name}</strong><small>{tag.skillCount} 个 Skill{tag.isSystem ? " · 内置" : ""}</small></span>{!tag.isSystem ? <><button className="skill-icon-button" type="button" aria-label={`编辑 ${tag.name}`} title="编辑分组" onClick={() => editTag(tag)}><Pencil size={16} /></button><button className="skill-icon-button" type="button" aria-label={`删除 ${tag.name}`} title="删除分组" onClick={() => void removeTag(tag)}><Trash2 size={16} /></button></> : null}</div>)}</div></Drawer> : null}
    {tagEditorOpen ? <Drawer title={editingTag ? "编辑分组" : "新建分组"} onClose={() => setTagEditorOpen(false)}><form className="tag-editor-form" onSubmit={(event) => void saveTag(event)}><label>分组名称<input autoFocus required value={tagName} maxLength={32} aria-invalid={Boolean(tagError)} aria-describedby={tagError ? "skill-tag-error" : undefined} onChange={(event) => { setTagName(event.target.value); setTagError(null); }} /></label>{tagError ? <p id="skill-tag-error" className="ux-error" role="alert">{tagError}</p> : null}<Button variant="primary" type="submit" disabled={!tagName.trim()}>保存</Button></form></Drawer> : null}
    {suggestionsOpen ? <Drawer title="标签建议" subtitle="确认后才会写入标签，已有标签会保留。" onClose={() => setSuggestionsOpen(false)} footer={<><Button onClick={() => setSuggestionsOpen(false)}>取消</Button><Button variant="primary" onClick={applySuggestions}>确认应用</Button></>}><div className="suggestion-list">{pageItems.map((skill) => <div className="suggestion-row" key={skill.id}><strong>{skill.name}</strong><div className="tag-choice-list">{tags.map((tag) => <button className={(suggestionIds[skill.id] ?? []).includes(tag.name) ? "tag-choice active" : "tag-choice"} key={tag.id} type="button" onClick={() => setSuggestionIds((current) => ({ ...current, [skill.id]: (current[skill.id] ?? []).includes(tag.name) ? (current[skill.id] ?? []).filter((name) => name !== tag.name) : [...(current[skill.id] ?? []), tag.name] }))}>{tag.name}</button>)}</div></div>)}</div></Drawer> : null}
    {importPlan ? <ImportWizard busy={executingImport} plan={importPlan} onCancel={() => setImportPlan(null)} onConfirm={() => void handleConfirmImport()} /> : null}
  </section>;
}
