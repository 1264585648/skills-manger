import { useCallback, useEffect, useMemo, useState } from "react";
import { ImportWizard } from "../components/ImportWizard";
import { Button, EmptyState, PageHeader, SearchField, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Skill, SkillStatus } from "../types/domain";
import type { SkillImportPlan } from "../types/import";

const statusMeta: Record<SkillStatus, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  clean: { label: "Clean", tone: "green" },
  update: { label: "Update", tone: "amber" },
  unmanaged: { label: "Unmanaged", tone: "gray" },
  conflict: { label: "Conflict", tone: "red" },
  missing: { label: "Missing", tone: "red" },
};

type Notice = { tone: "success" | "error"; text: string } | null;

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparingImport, setPreparingImport] = useState(false);
  const [executingImport, setExecutingImport] = useState(false);
  const [importPlan, setImportPlan] = useState<SkillImportPlan | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const items = await workspaceService.getSkills();
      setSkills(items);
      setSelectedId((current) =>
        current && items.some((item) => item.id === current)
          ? current
          : items[0]?.id ?? null,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const handlePrepareImport = async () => {
    setNotice(null);
    setPreparingImport(true);
    try {
      const plan = await workspaceService.previewSkillFromPicker();
      if (plan) setImportPlan(plan);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "扫描 Skill 失败",
      });
    } finally {
      setPreparingImport(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPlan) return;
    const mutationCount = importPlan.summary.add + importPlan.summary.update;
    if (mutationCount === 0) {
      setImportPlan(null);
      setNotice({ tone: "success", text: "来源内容与 Library 一致，无需更新。" });
      return;
    }

    setExecutingImport(true);
    try {
      const results = await workspaceService.executeImportPlan(importPlan);
      await loadSkills();
      const last = results.at(-1);
      if (last) setSelectedId(last.skill.id);
      setImportPlan(null);
      setNotice({
        tone: "success",
        text: `导入完成：新增 ${importPlan.summary.add}，更新 ${importPlan.summary.update}。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "导入失败",
      });
    } finally {
      setExecutingImport(false);
    }
  };

  const groups = useMemo(
    () => ["全部", ...Array.from(new Set(skills.flatMap((item) => item.groups)))],
    [skills],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const matchesGroup = group === "全部" || skill.groups.includes(group);
      const matchesQuery =
        !normalized ||
        `${skill.name} ${skill.description} ${skill.source} ${skill.sourcePath ?? ""}`
          .toLowerCase()
          .includes(normalized);
      return matchesGroup && matchesQuery;
    });
  }, [group, query, skills]);

  const selected = skills.find((skill) => skill.id === selectedId) ?? filtered[0];
  const libraryCount = skills.filter((skill) => !skill.id.startsWith("instance:")).length;
  const unmanagedCount = skills.filter((skill) => skill.status === "unmanaged").length;
  const attentionCount = skills.filter((skill) => skill.status !== "clean").length;
  const selectedIsDiscovery = selected?.status === "unmanaged" || selected?.status === "missing";

  return <section className="page">
    <PageHeader
      title="Skills"
      subtitle="统一管理本地 Skills 资产、来源与状态。"
      actions={
        <Button
          variant="primary"
          disabled={preparingImport || executingImport}
          onClick={() => void handlePrepareImport()}
        >
          {preparingImport ? "扫描中…" : "＋ 导入 Skill"}
        </Button>
      }
    />

    {notice ? (
      <div className={`inline-notice notice-${notice.tone}`}>{notice.text}</div>
    ) : null}

    <div className="summary-row summary-three">
      <article><span>Library Skills</span><strong>{libraryCount}</strong></article>
      <article><span>只读发现</span><strong>{unmanagedCount}</strong></article>
      <article><span>需要关注</span><strong>{attentionCount}</strong></article>
    </div>

    <div className="workbench skills-workbench">
      <aside className="workbench-nav panel-surface">
        <div className="panel-title">分组</div>
        {groups.slice(0, 6).map((item) => (
          <button
            className={group === item ? "subnav-item active" : "subnav-item"}
            key={item}
            onClick={() => setGroup(item)}
            type="button"
          >
            <span>{item}</span>
            <small>
              {item === "全部"
                ? skills.length
                : skills.filter((skill) => skill.groups.includes(item)).length}
            </small>
          </button>
        ))}
      </aside>

      <section className="panel-surface skill-list-panel">
        <div className="panel-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="搜索 Skill、来源…" />
          <Button variant="ghost" onClick={() => void loadSkills()}>刷新</Button>
        </div>

        <div className="skill-table-head">
          <span>Skill</span><span>来源</span><span>状态</span><span>版本</span>
        </div>

        <div className="skill-list">
          {loading ? (
            <EmptyState title="正在读取 Library" body="从本地 SQLite 加载已托管 Skill。" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={skills.length === 0 ? "还没有 Skill" : "没有匹配的 Skill"}
              body={
                skills.length === 0
                  ? "导入到 Library，或在 Settings 中添加 Claude Code 发现目录。"
                  : "调整搜索词或分组后再试。"
              }
            />
          ) : filtered.map((skill) => {
            const meta = statusMeta[skill.status];
            return (
              <button
                className={selected?.id === skill.id ? "skill-row selected" : "skill-row"}
                key={skill.id}
                onClick={() => setSelectedId(skill.id)}
                type="button"
              >
                <span className="skill-name-cell">
                  <i className="skill-glyph">✦</i>
                  <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
                </span>
                <span className="muted-cell" title={skill.sourcePath}>{skill.source}</span>
                <span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></span>
                <span className="mono-cell">{skill.version}</span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="panel-surface inspector">
        {selected ? <>
          <div className="inspector-title">
            <i className="large-skill-glyph">✦</i>
            <div><h2>{selected.name}</h2><p>{selected.description}</p></div>
          </div>
          <div className="inspector-section">
            <span className="section-label">{selectedIsDiscovery ? "Discovery" : "Library"}</span>
            <dl className="detail-list">
              <div><dt>来源</dt><dd title={selected.sourcePath}>{selected.source}</dd></div>
              <div><dt>版本</dt><dd>{selected.version}</dd></div>
              <div><dt>Content Hash</dt><dd className="hash-value" title={selected.contentHash}>{selected.contentHash?.slice(0, 12) ?? "—"}</dd></div>
              <div><dt>安全</dt><dd>{selected.security}</dd></div>
              <div><dt>License</dt><dd>{selected.license ?? "—"}</dd></div>
              <div><dt>更新</dt><dd>{selected.lastUpdated}</dd></div>
            </dl>
          </div>
          {selectedIsDiscovery ? <p className="readonly-discovery-note">只读发现，尚未纳入 Library；不会写入或执行 Agent 目录内容。</p> : null}
          <div className="inspector-actions">
            <Button variant="primary" disabled>部署到 Agent</Button>
            <Button onClick={() => void loadSkills()}>重新读取</Button>
          </div>
        </> : null}
      </aside>
    </div>

    {importPlan ? (
      <ImportWizard
        busy={executingImport}
        plan={importPlan}
        onCancel={() => setImportPlan(null)}
        onConfirm={() => void handleConfirmImport()}
      />
    ) : null}
  </section>;
}
