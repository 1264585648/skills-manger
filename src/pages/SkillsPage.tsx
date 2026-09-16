import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { ImportWizard } from "../components/ImportWizard";
import { Button, EmptyState, PageHeader, SearchField, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Skill, SkillStatus } from "../types/domain";
import type { SkillImportPlan } from "../types/import";

const statusMeta: Record<SkillStatus, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  clean: { label: "无待处理项", tone: "green" },
  update: { label: "来源有更新", tone: "amber" },
  upstream_update: { label: "来源有更新", tone: "amber" },
  local_modified: { label: "技能库已修改", tone: "red" },
  target_drift: { label: "部署已修改", tone: "red" },
  unmanaged: { label: "未纳入管理", tone: "gray" },
  conflict: { label: "存在冲突", tone: "red" },
  missing: { label: "位置缺失", tone: "red" },
};

const statusDescription: Record<SkillStatus, string> = {
  clean: "当前记录没有需要处理的变化；未跟踪来源的 Skill 不代表已经检查上游。",
  update: "来源包含新内容。更新技能库前可以先检查变化，部署位置不会自动改动。",
  upstream_update: "来源包含新内容。更新技能库前可以先检查变化，部署位置不会自动改动。",
  local_modified: "技能库内容与跟踪来源不同，请在更新前确认要保留哪一份。",
  target_drift: "至少一个部署位置与技能库内容不同，请在 Sync 中审阅后再写入。",
  unmanaged: "此 Skill 来自已扫描的 Agent 目录，尚未复制到技能库。",
  conflict: "检测到无法自动处理的差异，相关写入操作会保持阻止。",
  missing: "上次记录的位置已经不存在或当前不可访问。",
};

const updateStatuses = new Set<SkillStatus>(["update", "upstream_update"]);
const issueStatuses = new Set<SkillStatus>(["local_modified", "target_drift", "conflict", "missing"]);

const isDiscoverySkill = (skill: Skill): boolean =>
  skill.id.startsWith("instance:") || skill.status === "unmanaged";

const formatError = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

type Notice = { tone: "success" | "error"; text: string } | null;
type SkillsView = "library" | "discovery";
type StatusFilter = "all" | "updates" | "issues";
type DetailTab = "overview" | "deployments" | "technical";

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("全部");
  const [view, setView] = useState<SkillsView>("library");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [preparingImport, setPreparingImport] = useState(false);
  const [executingImport, setExecutingImport] = useState(false);
  const [importPlan, setImportPlan] = useState<SkillImportPlan | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sourceBusy, setSourceBusy] = useState(false);

  const loadSkills = useCallback(async (): Promise<Skill[]> => {
    setLoading(true);
    try {
      const items = await workspaceService.getSkills();
      setSkills(items);
      return items;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills().catch((error) => {
      setNotice({ tone: "error", text: formatError(error, "读取 Skills 失败") });
    });
  }, [loadSkills]);

  const handleRefresh = async (): Promise<void> => {
    setNotice(null);
    try {
      await loadSkills();
      setNotice({ tone: "success", text: "技能列表已重新读取。" });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error, "重新读取失败") });
    }
  };

  const handleScanAgents = async (): Promise<void> => {
    setNotice(null);
    setScanning(true);
    try {
      await workspaceService.scanAgents();
      await loadSkills();
      setNotice({ tone: "success", text: "本机 Agent 目录扫描完成，发现结果已更新。" });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error, "扫描本机 Agent 失败") });
    } finally {
      setScanning(false);
    }
  };

  const handlePrepareImport = async (path?: string): Promise<void> => {
    setNotice(null);
    setPreparingImport(true);
    try {
      const plan = path
        ? await workspaceService.previewSkillDirectory(path)
        : await workspaceService.previewSkillFromPicker();
      if (plan) setImportPlan(plan);
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error, "扫描 Skill 失败") });
    } finally {
      setPreparingImport(false);
    }
  };

  const handleConfirmImport = async (): Promise<void> => {
    if (!importPlan) return;
    const mutationCount = importPlan.summary.add + importPlan.summary.update;
    if (mutationCount === 0) {
      setImportPlan(null);
      setNotice({ tone: "success", text: "来源内容与技能库一致，无需更新。" });
      return;
    }

    setExecutingImport(true);
    try {
      const results = await workspaceService.executeImportPlan(importPlan);
      await loadSkills();
      const last = results.at(-1);
      setView("library");
      setStatusFilter("all");
      setGroup("全部");
      setQuery("");
      if (last) setSelectedId(last.skill.id);
      setImportPlan(null);
      setNotice({
        tone: "success",
        text: `已写入技能库：新增 ${importPlan.summary.add}，更新 ${importPlan.summary.update}。部署位置未自动修改。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error, "导入失败") });
    } finally {
      setExecutingImport(false);
    }
  };

  const handleCheckSource = async (sourceId: string): Promise<void> => {
    setSourceBusy(true);
    setNotice(null);
    try {
      const update = await workspaceService.checkGitSource(sourceId);
      await loadSkills();
      setNotice({ tone: "success", text: `来源检查完成：${update.skillName} · ${update.status}` });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error, "检查 Git 来源失败") });
    } finally {
      setSourceBusy(false);
    }
  };

  const handlePromoteSource = async (sourceId: string): Promise<void> => {
    const accepted = await confirm(
      "将已检查的来源版本写入技能库。此步骤不会修改任何 Agent 部署位置，是否继续？",
    );
    if (!accepted) return;

    setSourceBusy(true);
    setNotice(null);
    try {
      const result = await workspaceService.promoteGitSource(sourceId);
      await loadSkills();
      setSelectedId(result.skill.id);
      setNotice({
        tone: "success",
        text: `${result.skill.name} 已更新到技能库。请在 Sync 中审阅受影响的部署计划。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error, "更新技能库失败") });
    } finally {
      setSourceBusy(false);
    }
  };

  const librarySkills = useMemo(
    () => skills.filter((skill) => !isDiscoverySkill(skill)),
    [skills],
  );
  const discoverySkills = useMemo(
    () => skills.filter(isDiscoverySkill),
    [skills],
  );

  const groups = useMemo(
    () => ["全部", ...Array.from(new Set(librarySkills.flatMap((item) => item.groups)))],
    [librarySkills],
  );

  const activeItems = view === "library" ? librarySkills : discoverySkills;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return activeItems.filter((skill) => {
      const matchesGroup = view === "discovery" || group === "全部" || skill.groups.includes(group);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "updates" && updateStatuses.has(skill.status)) ||
        (statusFilter === "issues" && issueStatuses.has(skill.status));
      const matchesQuery =
        !normalized ||
        [
          skill.name,
          skill.description,
          skill.source,
          skill.sourcePath ?? "",
          ...skill.groups,
          ...skill.bundles,
          ...skill.targets,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return matchesGroup && matchesStatus && matchesQuery;
    });
  }, [activeItems, group, query, statusFilter, view]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && filtered.some((skill) => skill.id === current)) return current;
      return filtered[0]?.id ?? null;
    });
  }, [filtered]);

  useEffect(() => {
    setDetailTab("overview");
  }, [selectedId]);

  const selected = filtered.find((skill) => skill.id === selectedId) ?? null;
  const selectedIsDiscovery = selected ? isDiscoverySkill(selected) : false;
  const updateCount = librarySkills.filter((skill) => updateStatuses.has(skill.status)).length;
  const issueCount = librarySkills.filter((skill) => issueStatuses.has(skill.status)).length;

  const changeView = (next: SkillsView): void => {
    setView(next);
    setStatusFilter("all");
    setGroup("全部");
  };

  return <section className="page skills-page">
    <PageHeader
      title="Skills"
      subtitle="管理技能内容、来源与部署关系；发现、导入和部署始终分步执行。"
      actions={
        <>
          <Button disabled={scanning || loading} onClick={() => void handleScanAgents()}>
            {scanning ? "扫描中…" : "扫描本机"}
          </Button>
          <Button
            variant="primary"
            disabled={preparingImport || executingImport}
            onClick={() => void handlePrepareImport()}
          >
            {preparingImport ? "读取中…" : "＋ 添加 Skill"}
          </Button>
        </>
      }
    />

    {notice ? (
      <div className={`inline-notice notice-${notice.tone}`}>{notice.text}</div>
    ) : null}

    <div className="skills-viewbar panel-surface">
      <div className="skills-view-tabs" role="tablist" aria-label="Skills 视图">
        <button
          className={view === "library" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={view === "library"}
          onClick={() => changeView("library")}
        >
          <span>我的技能库</span>
          <strong>{librarySkills.length}</strong>
        </button>
        <button
          className={view === "discovery" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={view === "discovery"}
          onClick={() => changeView("discovery")}
        >
          <span>本机发现</span>
          <strong>{discoverySkills.length}</strong>
        </button>
      </div>
      <p>
        {view === "library"
          ? "技能库保存受管资产；加入组合或同步时才会影响部署。"
          : "发现结果保持只读；导入会复制到技能库，不会修改原目录。"}
      </p>
    </div>

    <div className="workbench skills-workbench">
      <section className="panel-surface skill-list-panel">
        <div className="skills-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={view === "library" ? "搜索名称、用途、来源或部署位置…" : "搜索发现的 Skill 或目录…"}
          />
          {view === "library" ? (
            <label className="skills-select">
              <span>分组</span>
              <select
                value={group}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => setGroup(event.target.value)}
              >
                {groups.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          ) : null}
          <Button variant="ghost" disabled={loading} onClick={() => void handleRefresh()}>
            {loading ? "读取中…" : "刷新列表"}
          </Button>
        </div>

        {view === "library" ? (
          <div className="skills-filter-row" aria-label="状态筛选">
            <button
              className={statusFilter === "all" ? "active" : ""}
              type="button"
              onClick={() => setStatusFilter("all")}
            >
              全部 <strong>{librarySkills.length}</strong>
            </button>
            <button
              className={statusFilter === "updates" ? "active" : ""}
              type="button"
              onClick={() => setStatusFilter("updates")}
            >
              有更新 <strong>{updateCount}</strong>
            </button>
            <button
              className={statusFilter === "issues" ? "active" : ""}
              type="button"
              onClick={() => setStatusFilter("issues")}
            >
              需处理 <strong>{issueCount}</strong>
            </button>
            <span>{filtered.length} 个结果</span>
          </div>
        ) : (
          <div className="skills-filter-row discovery-filter-row">
            <span>共发现 {filtered.length} 个未纳入技能库的实例</span>
          </div>
        )}

        <div className="skill-table-head">
          <span>Skill / 用途</span>
          <span>来源</span>
          <span>{view === "library" ? "部署" : "发现位置"}</span>
          <span>状态</span>
        </div>

        <div className="skill-list">
          {loading ? (
            <EmptyState title="正在读取 Skills" body="从本地技能库与 Agent 发现记录加载数据。" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={activeItems.length === 0
                ? view === "library" ? "技能库还是空的" : "还没有发现本机 Skill"
                : "没有匹配的 Skill"}
              body={activeItems.length === 0
                ? view === "library"
                  ? "从本地目录添加一个 Skill，或切换到本机发现查看现有实例。"
                  : "扫描已配置的 Claude Code 与 Codex 目录后，发现结果会显示在这里。"
                : "调整搜索词、分组或状态筛选后再试。"}
            />
          ) : filtered.map((skill) => {
            const meta = statusMeta[skill.status];
            const discovery = isDiscoverySkill(skill);
            const placement = discovery
              ? skill.targets[0] ?? skill.source
              : skill.targets.length > 0 ? `${skill.targets.length} 个位置` : "暂无记录";
            return (
              <button
                className={selected?.id === skill.id ? "skill-row selected" : "skill-row"}
                key={skill.id}
                onClick={() => setSelectedId(skill.id)}
                type="button"
                aria-pressed={selected?.id === skill.id}
              >
                <span className="skill-name-cell">
                  <i className="skill-glyph">✦</i>
                  <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
                </span>
                <span className="muted-cell" title={skill.sourcePath}>{skill.source}</span>
                <span className="skill-placement" title={skill.sourcePath}>{placement}</span>
                <span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="panel-surface inspector skill-inspector">
        {selected ? (() => {
          const meta = statusMeta[selected.status];
          return <>
            <div className="skill-inspector-title">
              <div className="skill-title-row">
                <i className="large-skill-glyph">✦</i>
                <div>
                  <span className="skill-kind">{selectedIsDiscovery ? "本机发现" : "技能库"}</span>
                  <h2>{selected.name}</h2>
                </div>
              </div>
              <p>{selected.description}</p>
              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            </div>

            <div className={`skill-health skill-health-${meta.tone}`}>
              <strong>{meta.label}</strong>
              <p>{statusDescription[selected.status]}</p>
            </div>

            <div className="skill-detail-tabs" role="tablist" aria-label="Skill 详情">
              <button
                className={detailTab === "overview" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "overview"}
                onClick={() => setDetailTab("overview")}
              >概览</button>
              <button
                className={detailTab === "deployments" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "deployments"}
                onClick={() => setDetailTab("deployments")}
              >部署</button>
              <button
                className={detailTab === "technical" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "technical"}
                onClick={() => setDetailTab("technical")}
              >技术信息</button>
            </div>

            {detailTab === "overview" ? (
              <div className="skill-tab-panel" role="tabpanel">
                <section className="inspector-section">
                  <span className="section-label">整理与关系</span>
                  <div className="skill-relation-block">
                    <span>分组</span>
                    <div className="skill-chip-list">
                      {selected.groups.length > 0
                        ? selected.groups.map((item) => <small key={item}>{item}</small>)
                        : <em>暂无记录</em>}
                    </div>
                  </div>
                  <div className="skill-relation-block">
                    <span>组合</span>
                    <div className="skill-chip-list">
                      {selected.bundles.length > 0
                        ? selected.bundles.map((item) => <small key={item}>{item}</small>)
                        : <em>暂无记录</em>}
                    </div>
                  </div>
                </section>
                <section className="inspector-section">
                  <span className="section-label">基础信息</span>
                  <dl className="detail-list">
                    <div><dt>来源</dt><dd title={selected.sourcePath}>{selected.source}</dd></div>
                    <div><dt>版本</dt><dd>{selected.version === "—" ? "未声明" : selected.version}</dd></div>
                    <div><dt>最近更新</dt><dd>{selected.lastUpdated}</dd></div>
                  </dl>
                </section>
                {selectedIsDiscovery ? (
                  <p className="readonly-discovery-note">
                    导入只会复制一份到技能库；原 Agent 目录保持不变，也不会自动建立部署所有权。
                  </p>
                ) : null}
              </div>
            ) : null}

            {detailTab === "deployments" ? (
              <div className="skill-tab-panel" role="tabpanel">
                <section className="inspector-section">
                  <span className="section-label">{selectedIsDiscovery ? "发现于" : "部署记录"}</span>
                  {selected.targets.length > 0 ? (
                    <div className="deployment-list">
                      {selected.targets.map((target) => (
                        <article key={target}>
                          <span className="deployment-mark">{target.slice(0, 1).toUpperCase()}</span>
                          <div><strong>{target}</strong><small>{selectedIsDiscovery ? "只读发现实例" : "已记录的部署位置"}</small></div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="compact-empty">
                      <strong>暂无部署记录</strong>
                      <p>当前数据没有可展示的位置；可在 Bundle 与 Sync 中查看组合及部署计划。</p>
                    </div>
                  )}
                  {selected.sourcePath ? <code className="skill-path" title={selected.sourcePath}>{selected.sourcePath}</code> : null}
                </section>
              </div>
            ) : null}

            {detailTab === "technical" ? (
              <div className="skill-tab-panel" role="tabpanel">
                <section className="inspector-section technical-details">
                  <span className="section-label">只读技术信息</span>
                  <dl className="detail-list">
                    <div><dt>Content Hash</dt><dd className="hash-value" title={selected.contentHash}>{selected.contentHash?.slice(0, 12) ?? "—"}</dd></div>
                    <div><dt>安全摘要</dt><dd>{selected.security}</dd></div>
                    <div><dt>License</dt><dd>{selected.license ?? "未声明"}</dd></div>
                    <div><dt>兼容性</dt><dd>{selected.compatibility ?? "未声明"}</dd></div>
                    <div><dt>Allowed Tools</dt><dd>{selected.allowedTools ?? "未声明"}</dd></div>
                    {selected.libraryPath ? <div><dt>Library Path</dt><dd className="path-value" title={selected.libraryPath}>{selected.libraryPath}</dd></div> : null}
                  </dl>
                  <p className="technical-note">安全摘要只描述文件结构与扫描结果，不代表已经完成内容审查。</p>
                </section>
              </div>
            ) : null}

            <div className="inspector-actions">
              {selectedIsDiscovery ? (
                <Button
                  variant="primary"
                  disabled={preparingImport || !selected.sourcePath}
                  onClick={() => void handlePrepareImport(selected.sourcePath)}
                >
                  {preparingImport ? "读取中…" : "导入技能库"}
                </Button>
              ) : null}
              {selected.trackedSourceId ? (
                <Button disabled={sourceBusy} onClick={() => void handleCheckSource(selected.trackedSourceId!)}>
                  {sourceBusy ? "检查中…" : "检查来源更新"}
                </Button>
              ) : null}
              {selected.trackedSourceId && selected.canPromote ? (
                <Button
                  variant="primary"
                  disabled={sourceBusy}
                  onClick={() => void handlePromoteSource(selected.trackedSourceId!)}
                >
                  更新技能库
                </Button>
              ) : null}
            </div>
          </>;
        })() : (
          <EmptyState title="选择一个 Skill" body="查看用途、关系、部署位置与技术信息。" />
        )}
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
