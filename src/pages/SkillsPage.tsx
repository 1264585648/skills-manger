import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, PageHeader, SearchField, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Skill, SkillStatus } from "../types/domain";

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
  const [importing, setImporting] = useState(false);
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

  const handleImport = async () => {
    setNotice(null);
    setImporting(true);
    try {
      const result = await workspaceService.importSkillFromPicker();
      if (!result) return;

      const label =
        result.outcome === "created"
          ? "已纳入 Library"
          : result.outcome === "updated"
            ? "已更新 Library 副本"
            : "内容未变化";

      setNotice({ tone: "success", text: `${result.skill.name}：${label}` });
      await loadSkills();
      setSelectedId(result.skill.id);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "导入失败",
      });
    } finally {
      setImporting(false);
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
  const cleanCount = skills.filter((skill) => skill.status === "clean").length;
  const attentionCount = skills.filter((skill) => skill.status !== "clean").length;

  return <section className="page">
    <PageHeader
      title="Skills"
      subtitle="统一管理本地 Skills 资产、来源与状态。"
      actions={
        <Button variant="primary" disabled={importing} onClick={() => void handleImport()}>
          {importing ? "导入中…" : "＋ 导入 Skill"}
        </Button>
      }
    />

    {notice ? (
      <div className={`inline-notice notice-${notice.tone}`}>{notice.text}</div>
    ) : null}

    <div className="summary-row summary-three">
      <article><span>Library Skills</span><strong>{skills.length}</strong></article>
      <article><span>状态正常</span><strong>{cleanCount}</strong></article>
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
              title={skills.length === 0 ? "Library 还是空的" : "没有匹配的 Skill"}
              body={
                skills.length === 0
                  ? "点击右上角“导入 Skill”，选择一个包含 SKILL.md 的目录。"
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
            <span className="section-label">Library</span>
            <dl className="detail-list">
              <div><dt>来源</dt><dd title={selected.sourcePath}>{selected.source}</dd></div>
              <div><dt>版本</dt><dd>{selected.version}</dd></div>
              <div><dt>Content Hash</dt><dd className="hash-value" title={selected.contentHash}>{selected.contentHash?.slice(0, 12) ?? "—"}</dd></div>
              <div><dt>安全</dt><dd>{selected.security}</dd></div>
              <div><dt>License</dt><dd>{selected.license ?? "—"}</dd></div>
              <div><dt>更新</dt><dd>{selected.lastUpdated}</dd></div>
            </dl>
          </div>
          <div className="inspector-actions">
            <Button variant="primary" disabled>部署到 Agent</Button>
            <Button onClick={() => void loadSkills()}>重新读取</Button>
          </div>
        </> : null}
      </aside>
    </div>
  </section>;
}
