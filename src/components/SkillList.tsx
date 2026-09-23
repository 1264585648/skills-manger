import { useEffect, useRef } from "react";
import { Button, EmptyState, SearchField, StatusPill } from "./ui";
import { DirectoryPanel } from "./DirectoryPanel";
import type { FilterKey, WorkspaceController } from "../hooks/useWorkspace";
import { displayPath, type SkillEntry } from "../types/domain";

const FILTERS: Array<[FilterKey, keyof WorkspaceController["counts"]]> = [
  ["all", "all"],
  ["attention", "attention"],
  ["ungoverned", "ungoverned"],
  ["missing", "missing"],
];

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "全部",
  attention: "需处理",
  ungoverned: "未治理",
  missing: "已失效",
};

/** 异常摘要：顶部可一眼看到问题、点击直达对应集合的入口（与下方视图筛选 chip 解耦）。 */
const EXCEPTION_SUMMARY: Array<{
  key: FilterKey;
  countKey: keyof WorkspaceController["counts"];
  label: string;
  tone: "amber" | "blue" | "red";
}> = [
  { key: "attention", countKey: "attention", label: "需处理", tone: "amber" },
  { key: "ungoverned", countKey: "ungoverned", label: "未治理", tone: "blue" },
  { key: "missing", countKey: "missing", label: "已失效", tone: "red" },
];

interface Props {
  controller: WorkspaceController;
}

export function SkillList({ controller }: Props) {
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
    selectedPath,
    setSelectedPath,
    checked,
    toggleChecked,
    clearChecked,
    loading,
    busy,
    reload,
    notice,
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

  // 行元素引用：选中项变化时直接滚动进可视区（D2）。
  const rowEls = useRef<Map<string, HTMLDivElement>>(new Map());

  const allChecked = filtered.length > 0 && filtered.every((entry) => checked.has(entry.path));

  const toggleAll = (): void => {
    if (allChecked) clearChecked();
    else for (const entry of filtered) if (!checked.has(entry.path)) toggleChecked(entry.path);
  };

  // 选中项变化后滚入可视区（D2）。
  useEffect(() => {
    if (!selectedPath) return;
    rowEls.current.get(selectedPath)?.scrollIntoView({ block: "nearest" });
  }, [selectedPath, filtered]);

  // ↑/↓ 在列表中移动选中项；焦点在搜索框时事件冒泡上来也可生效（D2）。
  const moveSelection = (direction: 1 | -1): void => {
    if (!filtered.length) return;
    const index = filtered.findIndex((entry) => entry.path === selectedPath);
    const next = index === -1 ? 0 : Math.min(filtered.length - 1, Math.max(0, index + direction));
    if (next !== index) setSelectedPath(filtered[next].path);
  };

  const renderRow = (entry: SkillEntry) => {
    const isSelected = entry.path === selectedPath;
    const scope =
      entry.hasUserScope && entry.hasProjectScope
        ? "用户 + 项目"
        : entry.hasProjectScope
          ? "项目"
          : "用户";
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
        ref={(element) => {
          if (element) rowEls.current.set(entry.path, element);
          else rowEls.current.delete(entry.path);
        }}
        data-path={entry.path}
        className={isSelected ? "skill-row skill-row-active" : "skill-row"}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => setSelectedPath(entry.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedPath(entry.path);
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
        <span className="skill-row-main">
          <span className="skill-row-name" title={entry.name}>
            {entry.name}
          </span>
          <span className="skill-row-meta">{summary}</span>
        </span>
        <span className="skill-row-side">
          {entry.nameConflict ? <StatusPill tone="amber">同名冲突</StatusPill> : null}
          {entry.missing ? <StatusPill tone="red">已失效</StatusPill> : null}
          {/* D5：不管是否失效都展示分发情况，不必点开详情就能扫读 */}
          <span className={entry.installedRootIds.length ? "installed-on" : "installed-off"}>
            {entry.installedRootIds.length ? `已装 ${entry.installedRootIds.length}` : "未分发"}
          </span>
        </span>
      </div>
    );
  };

  return (
    <section
      className="ws-list"
      onKeyDown={(event) => {
        // 下拉框自己用方向键选值，不要抢；搜索框里则照常移动选中项（D2）。
        if ((event.target as HTMLElement).tagName === "SELECT") return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveSelection(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveSelection(-1);
        }
      }}
    >
      <div className="ws-toolbar">
        {/* A7：顶部异常摘要，可点击直达对应集合 */}
        <span className="section-label">异常摘要</span>
        <div className="chip-row" role="group" aria-label="异常摘要">
          {EXCEPTION_SUMMARY.map(({ key, countKey, label, tone }) => {
            const count = counts[countKey];
            if (count === 0) {
              return (
                <span key={key} className="muted-help">
                  {label} 0
                </span>
              );
            }
            return (
              <button
                key={key}
                type="button"
                aria-pressed={filterKey === key}
                title={`只看${label}的 Skill`}
                className={`status-pill status-${tone}`}
                onClick={() => setFilterKey(key)}
              >
                {label} {count}
              </button>
            );
          })}
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="过滤 Skill（按 / 聚焦）"
          inputRef={searchRef}
        />

        {/* A6：视图筛选与「仅项目」正交，分两区明确区分 */}
        <div>
          <span className="section-label">视图（与「仅项目」可叠加）</span>
          <div className="chip-row" role="group" aria-label="视图筛选">
            {FILTERS.map(([key, countKey]) => {
              const count = counts[countKey];
              return (
                <button
                  key={key}
                  type="button"
                  className={filterKey === key ? "chip chip-active" : "chip"}
                  disabled={count === 0}
                  onClick={() => setFilterKey(key)}
                >
                  {FILTER_LABEL[key]} {count}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ws-toolbar-foot">
          <label className="check-line">
            <input
              type="checkbox"
              checked={projectOnly}
              onChange={(event) => setProjectOnly(event.target.checked)}
            />
            仅项目
          </label>
          <Button variant="ghost" onClick={() => void reload(true)} disabled={busy || loading}>
            {loading ? "扫描中…" : "重新扫描"}
          </Button>
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="ws-select-all">
          <label className="check-line">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            {allChecked ? "取消全选" : `全选当前 ${filtered.length} 个`}
          </label>
        </div>
      ) : null}

      <div className="ws-rows">
        {/* D6：重新扫描时保留旧列表（entries 未清空前仍渲染），顶部按钮显示「扫描中…」 */}
        {loading && !entries.length ? (
          <EmptyState title="正在扫描" body="只读遍历已登记 Agent 的用户目录与项目目录…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={entries.length ? "没有匹配的 Skill" : "还没有发现 Skill"}
            body={
              entries.length
                ? "放宽筛选或清空搜索关键词。"
                : "确认本机已安装对应 Agent，或在下方登记项目中的 skills 目录。"
            }
          />
        ) : (
          filtered.map(renderRow)
        )}
      </div>

      {checked.size > 0 ? (
        <div className="batch-bar">
          <strong>已选 {checked.size} 个</strong>
          <span className="section-label">加标签</span>
          <select
            aria-label="批量加标签"
            value={batchTagId}
            onChange={(event) => setBatchTagId(event.target.value)}
          >
            <option value="">加标签…</option>
            {snapshot.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <Button onClick={applyTagToSelection} disabled={busy || !batchTagId}>
            应用
          </Button>
          <span className="section-label">归组</span>
          <select
            aria-label="批量归组"
            value={batchGroupId}
            onChange={(event) => setBatchGroupId(event.target.value)}
          >
            <option value="">归到分组…（空 = 未分组）</option>
            {snapshot.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <Button onClick={applyGroupToSelection} disabled={busy}>
            应用
          </Button>
          <span className="section-label">写回目标</span>
          <select
            aria-label="批量写回目标"
            value={batchRootId}
            onChange={(event) => setBatchRootId(event.target.value)}
          >
            <option value="">写回到…</option>
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
          <Button variant="primary" onClick={writeBackSelection} disabled={busy || !batchRootId}>
            写回
          </Button>
          <Button variant="ghost" onClick={clearChecked}>
            清除
          </Button>
        </div>
      ) : null}

      {notice ? <div className="ws-notice">{notice}</div> : null}

      <DirectoryPanel controller={controller} />
    </section>
  );
}
