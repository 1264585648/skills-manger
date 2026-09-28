import { useState } from "react";
import { Button, EmptyState, SearchField, StatusPill } from "./ui";
import { SkillCard } from "./SkillCard";
import { IconGrid, IconList, IconFolder, IconRefresh } from "./icons";
import type { FilterKey, WorkspaceController } from "../hooks/useWorkspace";
import { displayPath, type SkillEntry } from "../types/domain";

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
    selectedPath,
    checked,
    toggleChecked,
    clearChecked,
    loading,
    busy,
    reload,
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
    searchRef,
  } = controller;

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const allChecked = filtered.length > 0 && filtered.every((entry) => checked.has(entry.path));
  const checkedInView = filtered.filter((entry) => checked.has(entry.path)).length;

  const toggleAll = (): void => {
    if (allChecked) clearChecked();
    else for (const entry of filtered) if (!checked.has(entry.path)) toggleChecked(entry.path);
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
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleChecked(entry.path)}
        />
        <div className="list-row-main">
          <div className="list-row-title-line">
            <strong className="list-row-name">{entry.name}</strong>
            {entry.groupName ? (
              <span className="card-group-pill">📁 {entry.groupName}</span>
            ) : null}
            {entry.tagNames.map((tag) => (
              <span key={tag} className="card-tag-pill">
                #{tag}
              </span>
            ))}
          </div>
          <span className="list-row-meta">
            {entry.note || entry.description || summary}
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
      {/* 顶部主搜索与工具栏 */}
      <div className="catalog-topbar">
        <div className="catalog-search-wrap">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="搜索技能名称、描述、标签、本地路径... (按 / 聚焦)"
            inputRef={searchRef}
          />
        </div>

        <div className="catalog-actions">
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
            onClick={() => void reload(true)}
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

      {/* 过滤切换栏：视图档位、分组、项目过滤与 Grid/List 模式切换 */}
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
                disabled={key !== "all" && count === 0}
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

          <label className="filter-check-modern">
            <input
              type="checkbox"
              checked={projectOnly}
              onChange={(event) => setProjectOnly(event.target.checked)}
            />
            <span>仅项目作用域</span>
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
            title={entries.length ? "没有匹配的 Skill" : "尚未发现任何 Skill"}
            body={
              entries.length
                ? "建议清空搜索关键词或重置筛选条件。"
                : "请确保本机已安装支持的 Agent，或点击顶部「登记项目目录」添加本地 skills 文件夹。"
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
                onToggleCheck={() => toggleChecked(entry.path)}
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
                aria-label="批量加标签"
                value={batchTagId}
                onChange={(event) => setBatchTagId(event.target.value)}
              >
                <option value="">批量打标签…</option>
                {snapshot.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <Button onClick={applyTagToSelection} disabled={busy || !batchTagId}>
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
                {snapshot.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
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
                  .filter((root) => root.enabled)
                  .map((root) => (
                    <option key={root.id} value={root.id}>
                      {agentName(root.agentId)} ·{" "}
                      {displayPath(root.configuredPath)
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
                disabled={busy || !batchRootId}
              >
                写回
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
