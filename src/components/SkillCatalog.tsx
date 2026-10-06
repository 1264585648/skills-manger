import { Button, EmptyState, SearchField, StatusPill } from "./ui";
import { SkillCard } from "./SkillCard";
import { HighlightText } from "./HighlightText";
import { CatalogMetricBanner } from "./CatalogMetricBanner";
import {
  IconGrid,
  IconList,
  IconFolder,
  IconRefresh,
  IconCopy,
  IconDownload,
  IconKeyboard,
  IconTag,
  IconAgents,
  IconSort,
} from "./icons";
import type { FilterKey, SortKey, WorkspaceController } from "../hooks/useWorkspace";
import { type SkillEntry } from "../types/domain";

interface Props {
  controller: WorkspaceController;
  onOpenDirectoriesModal: () => void;
  onSelectSkill: (path: string) => void;
}

const FILTERS: Array<{
  key: FilterKey;
  countKey: keyof WorkspaceController["counts"];
  label: string;
  tone?: "amber" | "blue" | "red";
}> = [
  { key: "all", countKey: "all", label: "全部技能" },
  { key: "attention", countKey: "attention", label: "需处理", tone: "amber" },
  { key: "ungoverned", countKey: "ungoverned", label: "未治理", tone: "blue" },
  { key: "missing", countKey: "missing", label: "已失效", tone: "red" },
];

export function SkillCatalog({
  controller,
  onOpenDirectoriesModal,
  onSelectSkill,
}: Props) {
  const {
    filtered,
    entries,
    counts,
    query,
    setQuery,
    filterKey,
    setFilterKey,
    projectOnly,
    setProjectOnly,
    groupFilter,
    setGroupFilter,
    tagFilter,
    setTagFilter,
    agentFilter,
    setAgentFilter,
    hasScriptsOnly,
    setHasScriptsOnly,
    sortKey,
    setSortKey,
    viewMode,
    setViewMode,
    hasActiveFilters,
    clearAllFilters,
    selectedPath,
    checked,
    selectedEntries,
    toggleChecked,
    clearChecked,
    loading,
    busy,
    refreshScan,
    agentName,
    snapshot,
    batchTagId,
    setBatchTagId,
    batchGroupId,
    setBatchGroupId,
    batchRootId,
    setBatchRootId,
    applyTagToSelection,
    applyGroupToSelection,
    writeBackSelection,
    showToast,
    setShortcutsModalOpen,
    searchRef,
  } = controller;

  const allChecked = filtered.length > 0 && filtered.every((entry) => checked.has(entry.path));
  const checkedInView = filtered.filter((entry) => checked.has(entry.path)).length;

  const toggleAll = (): void => {
    if (allChecked) clearChecked();
    else for (const entry of filtered) if (!checked.has(entry.path)) toggleChecked(entry.path);
  };

  // ---------------- 批量导出到剪贴板
  const handleExportMarkdown = async () => {
    if (selectedEntries.length === 0) return;
    const lines = [
      `# 技能资产清单 (共 ${selectedEntries.length} 项)`,
      ``,
      `| 技能名称 | 分组 | 标签 | 作用域 | 脚本数 | 本地路径 |`,
      `|---|---|---|---|---|---|`,
    ];
    for (const item of selectedEntries) {
      const scope = item.hasProjectScope ? "项目" : "用户全局";
      const grp = item.groupName || "-";
      const tags = item.tagNames.length ? item.tagNames.join(", ") : "-";
      lines.push(
        `| **${item.name}** | ${grp} | ${tags} | ${scope} | ${item.scriptCount} | \`${item.path}\` |`,
      );
    }
    const md = lines.join("\n");
    await navigator.clipboard.writeText(md);
    showToast(`已成功复制 ${selectedEntries.length} 个技能的 Markdown 清单`, "success");
  };

  const handleExportJSON = async () => {
    if (selectedEntries.length === 0) return;
    const jsonStr = JSON.stringify(
      selectedEntries.map((item) => ({
        name: item.name,
        path: item.path,
        contentHash: item.contentHash,
        group: item.groupName,
        tags: item.tagNames,
        note: item.note,
        description: item.description,
        scriptCount: item.scriptCount,
        hasProjectScope: item.hasProjectScope,
        hasUserScope: item.hasUserScope,
        installedRootIds: item.installedRootIds,
      })),
      null,
      2,
    );
    await navigator.clipboard.writeText(jsonStr);
    showToast(`已成功复制 ${selectedEntries.length} 个技能的 JSON 配置到剪贴板`, "success");
  };

  const renderRow = (entry: SkillEntry) => {
    const isSelected = entry.path === selectedPath;
    const scope =
      entry.hasUserScope && entry.hasProjectScope
        ? "用户 + 项目"
        : entry.hasProjectScope
          ? "项目"
          : "用户全局";

    const summary = [
      agentName(entry.agentIds[0]) +
        (entry.agentIds.length > 1 ? ` +${entry.agentIds.length - 1}` : ""),
      entry.refs.length > 1 ? `${entry.refs.length} 处登记` : null,
      scope,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <div
        key={entry.path}
        className={`skill-list-row ${isSelected ? "skill-list-row-active" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onSelectSkill(entry.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectSkill(entry.path);
          }
        }}
      >
        <input
          type="checkbox"
          className="row-check"
          checked={checked.has(entry.path)}
          aria-label={`选择 ${entry.name}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleChecked(entry.path, event.shiftKey);
          }}
          onChange={() => {}}
        />
        <div className="list-row-main">
          <div className="list-row-title-line">
            <strong className="list-row-name">
              <HighlightText text={entry.name} query={query} />
            </strong>
            {entry.groupName ? (
              <span className="card-group-pill">📁 {entry.groupName}</span>
            ) : null}
            {entry.tagNames.map((tag) => (
              <span key={tag} className="card-tag-pill">
                #{tag}
              </span>
            ))}
            {entry.scriptCount > 0 ? (
              <span className="filter-chip-count" title="包含可执行脚本">
                ⚡ 脚本 ({entry.scriptCount})
              </span>
            ) : null}
          </div>
          <span className="list-row-meta">
            {entry.note ? (
              <HighlightText text={entry.note} query={query} />
            ) : entry.description ? (
              <HighlightText text={entry.description} query={query} />
            ) : (
              summary
            )}
          </span>
        </div>
        <div className="list-row-side">
          {entry.nameConflict ? <StatusPill tone="amber">同名冲突</StatusPill> : null}
          {entry.missing ? <StatusPill tone="red">已失效</StatusPill> : null}
          <span className={entry.installedRootIds.length ? "installed-on" : "installed-off"}>
            {entry.installedRootIds.length ? `已分发 ${entry.installedRootIds.length} 处` : "未分发"}
          </span>
        </div>
      </div>
    );
  };

  return (
    <section className="skill-catalog">
      {/* 顶部主搜索与全局工具栏 */}
      <div className="catalog-topbar">
        <div className="catalog-search-wrap">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="搜索技能名称、描述、标签、本地路径... (按 / 聚焦，按 ? 查看快捷键)"
            inputRef={searchRef}
          />
        </div>

        <div className="catalog-actions">
          <Button
            variant="ghost"
            onClick={() => setShortcutsModalOpen(true)}
            title="快捷键速查指南 (?)"
          >
            <IconKeyboard style={{ marginRight: 6 }} />
            快捷键
          </Button>

          <Button
            variant="secondary"
            onClick={onOpenDirectoriesModal}
            title="登记本地项目 Skills 目录"
          >
            <IconFolder style={{ marginRight: 6 }} />
            登记项目目录
          </Button>

          <Button
            variant="primary"
            onClick={() => void refreshScan()}
            disabled={busy || loading}
            title="只读扫描已登记目录"
          >
            <IconRefresh
              className={loading ? "icon-spin" : ""}
              style={{ marginRight: 6 }}
            />
            {loading ? "扫描中…" : "刷新扫描"}
          </Button>
        </div>
      </div>

      {/* 资产度量概览条 (Metric Banner) */}
      <CatalogMetricBanner controller={controller} />

      {/* 复合过滤与排序控制栏 */}
      <div className="catalog-filter-strip">
        <div className="filter-chips-group">
          {FILTERS.map(({ key, countKey, label, tone }) => {
            const count = counts[countKey];
            const active = filterKey === key;
            return (
              <button
                key={key}
                type="button"
                className={`filter-chip ${active ? "filter-chip-active" : ""} ${
                  tone && count > 0 && !active ? `filter-chip-${tone}` : ""
                }`}
                onClick={() => setFilterKey(key)}
              >
                <span>{label}</span>
                <span className="filter-chip-count">{count}</span>
              </button>
            );
          })}

          <div className="filter-divider" />

          {/* 分组筛选下拉 */}
          <select
            className="filter-select-modern"
            aria-label="按分组筛选"
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
          >
            <option value="">全部分组</option>
            <option value="__none__">未分组</option>
            {snapshot.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.skillCount})
              </option>
            ))}
          </select>

          {/* 标签筛选下拉 */}
          <select
            className="filter-select-modern"
            aria-label="按标签筛选"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="">全部标签</option>
            {snapshot.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                #{tag.name} ({tag.skillCount})
              </option>
            ))}
          </select>

          {/* Agent 筛选下拉 */}
          <select
            className="filter-select-modern"
            aria-label="按 Agent 筛选"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
          >
            <option value="">全部 Agent</option>
            {snapshot.targets
              .filter((t) => t.id !== "skills-manager-vault")
              .map((target) => (
                <option key={target.id} value={target.id}>
                  {agentName(target.id)}
                </option>
              ))}
          </select>

          {/* 多维排序下拉 */}
          <select
            className="filter-select-modern"
            aria-label="多维排序"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
          >
            <option value="name-asc">名称 A → Z</option>
            <option value="name-desc">名称 Z → A</option>
            <option value="targets-desc">分发覆盖率最高</option>
            <option value="scripts-desc">脚本最多优先</option>
            <option value="governance-desc">治理度最高优先</option>
          </select>

          <label className="filter-check-modern" title="仅查看项目本地技能">
            <input
              type="checkbox"
              checked={projectOnly}
              onChange={(event) => setProjectOnly(event.target.checked)}
            />
            <span>仅项目</span>
          </label>

          <label className="filter-check-modern" title="仅查看包含可执行脚本的技能，便于安全审计">
            <input
              type="checkbox"
              checked={hasScriptsOnly}
              onChange={(event) => setHasScriptsOnly(event.target.checked)}
            />
            <span>含脚本安全</span>
          </label>
        </div>

        <div className="catalog-view-switch">
          <button
            type="button"
            className={`view-switch-btn ${viewMode === "grid" ? "view-switch-active" : ""}`}
            onClick={() => setViewMode("grid")}
            title="卡片网格视图"
            aria-label="网格视图"
          >
            <IconGrid />
          </button>
          <button
            type="button"
            className={`view-switch-btn ${viewMode === "list" ? "view-switch-active" : ""}`}
            onClick={() => setViewMode("list")}
            title="紧凑列表视图"
            aria-label="列表视图"
          >
            <IconList />
          </button>
        </div>
      </div>

      {/* 已启用筛选条 (Active Filters Bar) */}
      {hasActiveFilters ? (
        <div className="active-filters-bar" role="status">
          <span className="active-filters-label">
            <IconTag style={{ width: 13, height: 13 }} />
            当前已启用筛选：
          </span>
          {query.trim() ? (
            <span className="active-filter-badge">
              关键词: “{query.trim()}”
              <button
                type="button"
                className="active-filter-dismiss"
                onClick={() => setQuery("")}
                title="清除关键词"
              >
                ×
              </button>
            </span>
          ) : null}
          {filterKey !== "all" ? (
            <span className="active-filter-badge">
              视图: {FILTERS.find((f) => f.key === filterKey)?.label}
              <button
                type="button"
                className="active-filter-dismiss"
                onClick={() => setFilterKey("all")}
                title="重置视图"
              >
                ×
              </button>
            </span>
          ) : null}
          {groupFilter ? (
            <span className="active-filter-badge">
              分组:{" "}
              {groupFilter === "__none__"
                ? "未分组"
                : snapshot.groups.find((g) => g.id === groupFilter)?.name || groupFilter}
              <button
                type="button"
                className="active-filter-dismiss"
                onClick={() => setGroupFilter("")}
                title="清除分组筛选"
              >
                ×
              </button>
            </span>
          ) : null}
          {tagFilter ? (
            <span className="active-filter-badge">
              标签: #{snapshot.tags.find((t) => t.id === tagFilter)?.name || tagFilter}
              <button
                type="button"
                className="active-filter-dismiss"
                onClick={() => setTagFilter("")}
                title="清除标签筛选"
              >
                ×
              </button>
            </span>
          ) : null}
          {agentFilter ? (
            <span className="active-filter-badge">
              Agent: {agentName(agentFilter)}
              <button
                type="button"
                className="active-filter-dismiss"
                onClick={() => setAgentFilter("")}
                title="清除 Agent 筛选"
              >
                ×
              </button>
            </span>
          ) : null}
          {projectOnly ? (
            <span className="active-filter-badge">
              仅项目专属
              <button
                type="button"
                className="active-filter-dismiss"
                onClick={() => setProjectOnly(false)}
                title="取消仅项目"
              >
                ×
              </button>
            </span>
          ) : null}
          {hasScriptsOnly ? (
            <span className="active-filter-badge">
              仅含脚本
              <button
                type="button"
                className="active-filter-dismiss"
                onClick={() => setHasScriptsOnly(false)}
                title="取消仅脚本"
              >
                ×
              </button>
            </span>
          ) : null}

          <button
            type="button"
            className="clear-all-filters-btn"
            onClick={clearAllFilters}
          >
            一键清空筛选
          </button>
        </div>
      ) : null}

      {/* 全选状态横条 */}
      {filtered.length > 0 ? (
        <div className="catalog-selection-header">
          <label className="check-line">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            <span>
              {allChecked
                ? `已全选当前视图 ${filtered.length} 个技能`
                : `全选当前视图（${filtered.length} 个）`}
            </span>
          </label>
          <span className="catalog-stats-hint">
            共检出 {entries.length} 个本地技能 · {counts.links} 条活跃写回连接
          </span>
        </div>
      ) : null}

      {/* 技能主画布：网格或列表 */}
      <div className="catalog-content-canvas">
        {loading && !entries.length ? (
          <EmptyState
            title="正在扫描本地 Skill"
            body="只读探测已安装 Agent 与登记的项目目录中的 SKILL.md…"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={
              filterKey === "missing"
                ? "没有已失效的技能"
                : filterKey === "attention"
                  ? "暂无需要处理的技能"
                  : filterKey === "ungoverned"
                    ? "全部技能均已完成治理"
                    : query
                      ? "没有匹配的 Skill"
                      : "尚未发现任何 Skill"
            }
            body={
              filterKey === "missing"
                ? "所有已探测技能的本地源文件均正常就绪，没有检测到失效路径。"
                : filterKey === "attention"
                  ? "未发现版本冲突、异常脚本或丢失引用的技能，所有技能处于健康状态。"
                  : filterKey === "ungoverned"
                    ? "所有技能均已正确分配所属业务分组或自定义标签。"
                    : query
                      ? `未找到与 “${query}” 匹配的技能，建议尝试其他关键词或清空搜索。`
                      : "请确保本机已安装支持的 Agent，或点击顶部「登记项目目录」添加本地 skills 文件夹。"
            }
            action={
              hasActiveFilters ? (
                <Button variant="secondary" onClick={clearAllFilters}>
                  清空全部筛选条件
                </Button>
              ) : undefined
            }
          />
        ) : viewMode === "grid" ? (
          <div className="skill-card-grid">
            {filtered.map((entry) => (
              <SkillCard
                key={entry.path}
                entry={entry}
                isSelected={entry.path === selectedPath}
                isChecked={checked.has(entry.path)}
                onSelect={() => onSelectSkill(entry.path)}
                onToggleCheck={(shiftKey) => toggleChecked(entry.path, shiftKey)}
                controller={controller}
              />
            ))}
          </div>
        ) : (
          <div className="skill-rows-container">{filtered.map(renderRow)}</div>
        )}
      </div>

      {/* 悬浮批量操作栏 */}
      {checked.size > 0 ? (
        <div className="floating-batch-bar" role="toolbar" aria-label="批量操作">
          <div className="batch-info">
            <strong>
              已选 {checked.size} 项
              {checkedInView !== checked.size ? `（当前视图 ${checkedInView}）` : ""}
            </strong>
          </div>

          <div className="batch-actions">
            <div className="batch-control-group">
              <select
                className="select-custom"
                aria-label="批量打标签"
                value={batchTagId}
                onChange={(event) => setBatchTagId(event.target.value)}
              >
                <option value="">批量打标签…</option>
                <option value="__clear_tags__">清空所选标签</option>
                {snapshot.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    #{tag.name}
                  </option>
                ))}
              </select>
              <Button onClick={applyTagToSelection} disabled={busy}>
                打标
              </Button>
            </div>

            <div className="batch-control-group">
              <select
                className="select-custom"
                aria-label="批量归组"
                value={batchGroupId}
                onChange={(event) => setBatchGroupId(event.target.value)}
              >
                <option value="">批量归组…</option>
                <option value="__clear__">清除分组（移出分组）</option>
                {snapshot.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    📁 {group.name}
                  </option>
                ))}
              </select>
              <Button onClick={applyGroupToSelection} disabled={busy}>
                归组
              </Button>
            </div>

            <div className="batch-control-group">
              <select
                className="select-custom"
                aria-label="批量写回目标"
                value={batchRootId}
                onChange={(event) => setBatchRootId(event.target.value)}
              >
                <option value="">一键写回到 Agent…</option>
                {snapshot.roots
                  .filter((root) => root.enabled && root.agentId !== "skills-manager-vault")
                  .map((root) => (
                    <option key={root.id} value={root.id}>
                      {agentName(root.agentId)} ·{" "}
                      {root.configuredPath
                        .replace(/\\/g, "/")
                        .split("/")
                        .filter(Boolean)
                        .slice(-2)
                        .join("/")}
                    </option>
                  ))}
              </select>
              <Button
                variant="primary"
                onClick={writeBackSelection}
                disabled={busy}
              >
                写回
              </Button>
            </div>

            <div className="batch-control-group">
              <Button
                variant="secondary"
                onClick={() => void handleExportMarkdown()}
                title="复制选定技能的 Markdown 清单"
              >
                <IconCopy style={{ marginRight: 4 }} />
                导出 MD
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleExportJSON()}
                title="复制选定技能的 JSON 配置"
              >
                <IconDownload style={{ marginRight: 4 }} />
                导出 JSON
              </Button>
            </div>

            <Button variant="ghost" onClick={clearChecked}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
