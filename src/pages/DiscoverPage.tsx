import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, EmptyState, ErrorNotice, PageHeader, SearchField, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import { displayPath, shortHash } from "../types/domain";
import type {
  DiscoveryRootRecord,
  ScanSnapshot,
  SkillInstanceRecord,
} from "../types/discovery";

/** Flattened view of the backend agent catalog (for project-root conventions). */
interface AgentCatalogEntry {
  id: string;
  name: string;
  provider: string;
  projectRoots: string[];
}

type ViewMode = "unique" | "all" | "missing";
type QuickFilter = "all" | "duplicate" | "conflict" | "scripts";
type SortKey = "conflict" | "refs" | "name" | "scripts";

/**
 * One discovered skill, collapsed across every Agent that references it.
 * Multiple rows per skill only differ by the Agent/registration that found it,
 * so the table defaults to this grouped shape and keeps the per-reference
 * detail one click away.
 */
interface SkillGroup {
  key: string;
  name: string;
  description: string;
  refs: SkillInstanceRecord[];
  agentIds: string[];
  hashes: string[];
  hasConflict: boolean;
  sameLocation: boolean;
  hasUserScope: boolean;
  hasProjectScope: boolean;
  scriptCount: number;
}

const ALL_AGENTS = "all";

const matchesConvention = (path: string, patterns: string[]): boolean => {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return patterns.some((pattern) => normalized.endsWith(pattern.toLowerCase()));
};

const detectAgent = (path: string, catalog: AgentCatalogEntry[]): string | null => {
  const matched = catalog.filter((agent) => matchesConvention(path, agent.projectRoots));
  return matched.length > 0 ? matched[0].id : null;
};

const groupKey = (name: string): string => name.trim().toLowerCase();

/** Keep the drive prefix and the trailing folder name visible when a path is too long. */
const middleEllipsis = (value: string, head = 20, tail = 34): string =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

const scopeLabel = (group: SkillGroup): { text: string; tone: "blue" | "green" | "gray" } => {
  if (group.hasUserScope && group.hasProjectScope) return { text: "用户 + 项目", tone: "gray" };
  return group.hasProjectScope ? { text: "项目", tone: "green" } : { text: "用户", tone: "blue" };
};

/** Rows stay expandable only when a click did not just select text to copy. */
const hasTextSelection = (): boolean => {
  const selection = window.getSelection();
  return selection ? selection.toString().trim().length > 0 : false;
};

export function DiscoverPage({ onGovern }: { onGovern: () => void }) {
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState("claude-code");

  const [view, setView] = useState<ViewMode>("unique");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [sort, setSort] = useState<SortKey>("conflict");
  const [projectOnly, setProjectOnly] = useState(false);
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, entries] = await Promise.all([
        workspaceService.scan(),
        invoke<AgentCatalogEntry[]>("list_agent_catalog"),
      ]);
      setSnapshot(next);
      setCatalog(entries);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copiedKey) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  /** `/` jumps into the filter box from anywhere; Escape clears it back out. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (event.key === "Escape") {
          setQuery("");
          (target as HTMLInputElement | HTMLSelectElement).blur();
        }
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of snapshot?.targets ?? []) map.set(target.id, target.name);
    for (const agent of catalog) if (!map.has(agent.id)) map.set(agent.id, agent.name);
    return map;
  }, [snapshot, catalog]);

  const agentName = useCallback((id: string): string => agentNames.get(id) ?? id, [agentNames]);

  const allInstances = snapshot?.instances ?? [];
  const roots = snapshot?.roots ?? [];
  const targets = snapshot?.targets ?? [];
  const warnings = snapshot?.warnings ?? [];

  /** Missing skills live in their own view — never mixed into the actionable table. */
  const instances = useMemo(
    () => allInstances.filter((instance) => instance.state !== "missing"),
    [allInstances],
  );
  const missingInstances = useMemo(
    () => allInstances.filter((instance) => instance.state === "missing"),
    [allInstances],
  );

  /** How many skills each Agent actually contributed, regardless of the current view. */
  const agentOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const instance of allInstances) {
      counts.set(instance.agentId, (counts.get(instance.agentId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, name: agentName(id) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [allInstances, agentName]);

  const groups = useMemo<SkillGroup[]>(() => {
    const buckets = new Map<string, SkillInstanceRecord[]>();
    for (const instance of instances) {
      const key = groupKey(instance.name);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(instance);
      else buckets.set(key, [instance]);
    }

    return [...buckets.entries()].map(([key, refs]) => {
      const hashes = [...new Set(refs.map((ref) => ref.contentHash))];
      const locations = [...new Set(refs.map((ref) => displayPath(ref.path).toLowerCase()))];
      const description = refs.reduce(
        (longest, ref) => (ref.description.length > longest.length ? ref.description : longest),
        "",
      );
      return {
        key,
        name: refs[0].name,
        description,
        refs,
        agentIds: [...new Set(refs.map((ref) => ref.agentId))],
        hashes,
        hasConflict: hashes.length > 1,
        sameLocation: locations.length === 1,
        hasUserScope: refs.some((ref) => ref.scope === "user"),
        hasProjectScope: refs.some((ref) => ref.scope === "project"),
        scriptCount: refs.reduce((max, ref) => Math.max(max, ref.scriptCount), 0),
      };
    });
  }, [instances]);

  const duplicateCount = groups.filter((group) => group.refs.length > 1).length;
  const conflictCount = groups.filter((group) => group.hasConflict).length;
  const scriptCount = groups.filter((group) => group.scriptCount > 0).length;

  const filterInstances = useCallback(
    (source: SkillInstanceRecord[]): SkillInstanceRecord[] => {
      const normalized = query.trim().toLowerCase();
      let rows = source;

      if (agentFilter !== ALL_AGENTS) rows = rows.filter((row) => row.agentId === agentFilter);
      if (projectOnly) rows = rows.filter((row) => row.scope === "project");
      if (normalized) {
        rows = rows.filter((row) =>
          `${row.name} ${row.description} ${displayPath(row.path)} ${agentName(row.agentId)}`
            .toLowerCase()
            .includes(normalized),
        );
      }
      return [...rows].sort((a, b) => a.name.localeCompare(b.name));
    },
    [agentFilter, projectOnly, query, agentName],
  );

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let rows = groups;

    if (agentFilter !== ALL_AGENTS) {
      rows = rows.filter((group) => group.refs.some((ref) => ref.agentId === agentFilter));
    }
    if (normalized) {
      rows = rows.filter((group) =>
        `${group.name} ${group.description} ${group.refs
          .map((ref) => `${displayPath(ref.path)} ${agentName(ref.agentId)}`)
          .join(" ")}`
          .toLowerCase()
          .includes(normalized),
      );
    }
    if (quick === "duplicate") rows = rows.filter((group) => group.refs.length > 1);
    if (quick === "conflict") rows = rows.filter((group) => group.hasConflict);
    if (quick === "scripts") rows = rows.filter((group) => group.scriptCount > 0);
    if (projectOnly) rows = rows.filter((group) => group.hasProjectScope);

    const ranked = [...rows];
    ranked.sort((a, b) => {
      if (sort === "refs") return b.refs.length - a.refs.length || a.name.localeCompare(b.name);
      if (sort === "scripts") return b.scriptCount - a.scriptCount || a.name.localeCompare(b.name);
      if (sort === "name") return a.name.localeCompare(b.name);
      // 冲突优先：先看同名不同内容，再看被引用次数最多的
      if (a.hasConflict !== b.hasConflict) return a.hasConflict ? -1 : 1;
      return b.refs.length - a.refs.length || a.name.localeCompare(b.name);
    });
    return ranked;
  }, [groups, query, quick, projectOnly, sort, agentFilter, agentName]);

  const filteredInstances = useMemo(() => filterInstances(instances), [filterInstances, instances]);
  const filteredMissing = useMemo(
    () => filterInstances(missingInstances),
    [filterInstances, missingInstances],
  );

  const visibleRows: ReadonlyArray<SkillGroup | SkillInstanceRecord> =
    view === "unique" ? filteredGroups : view === "all" ? filteredInstances : filteredMissing;
  const rowCount = visibleRows.length;
  const missingCount = missingInstances.length;
  const detectedCount = targets.filter((target) => target.detected).length;
  const agentTotal = targets.length || catalog.length;
  const undetected = targets.filter((target) => !target.detected).map((target) => target.name);

  const hasActiveFilters =
    query.trim().length > 0 ||
    quick !== "all" ||
    projectOnly ||
    agentFilter !== ALL_AGENTS ||
    view !== "unique";

  /** 重复登记 / 内容冲突 / 带脚本 只在「唯一 Skill」视图下才有意义，切走时自动复位。 */
  const switchView = (next: ViewMode): void => {
    setView(next);
    if (next !== "unique") setQuick("all");
  };

  const resetFilters = (): void => {
    setQuery("");
    setQuick("all");
    setProjectOnly(false);
    setAgentFilter(ALL_AGENTS);
    setView("unique");
  };

  const toggleExpand = (key: string): void => {
    if (hasTextSelection()) return;
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const scrollToPanel = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copyPaths = async (key: string, paths: string[]): Promise<void> => {
    try {
      await navigator.clipboard.writeText(paths.join("\n"));
      setCopiedKey(key);
    } catch {
      setError(new Error("剪贴板不可用，展开明细后可手动选中路径复制"));
    }
  };

  const pickDirectory = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const path = await workspaceService.pickSkillsDirectory();
      if (!path) return;
      setPickedPath(path);
      setPickedAgentId(detectAgent(path, catalog) ?? pickedAgentId);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const addRoot = async (): Promise<void> => {
    if (!pickedPath) return;
    setBusy(true);
    setNotice(null);
    try {
      await workspaceService.addProjectRoot(pickedAgentId, pickedPath);
      setPickedPath(null);
      setNotice(`已登记项目目录：${displayPath(pickedPath)}`);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const removeRoot = async (root: DiscoveryRootRecord): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await workspaceService.removeProjectRoot(root.id);
      setNotice(`已移除登记：${displayPath(root.configuredPath)}`);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const chipClass = (active: boolean): string =>
    active ? "filter-chip filter-chip-active" : "filter-chip";

  // ---------------------------------------------------------------- rows

  const renderUniqueRow = (group: SkillGroup) => {
    const open = expanded.has(group.key);
    const primary = group.refs[0];
    const scope = scopeLabel(group);
    const groupCopyKey = `group:${group.key}`;

    return (
      <Fragment key={group.key}>
        <tr
          className={[
            "row-clickable",
            group.hasConflict ? "row-conflict" : "",
            open ? "row-open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => toggleExpand(group.key)}
        >
          <td className="col-caret">
            <button
              type="button"
              className={open ? "row-caret row-caret-open" : "row-caret"}
              aria-expanded={open}
              aria-label={open ? "收起引用明细" : "展开引用明细"}
              onClick={(event) => {
                event.stopPropagation();
                toggleExpand(group.key);
              }}
            >
              ▶
            </button>
          </td>
          <td>
            <div className="cell-head">
              <span className="cell-title">{group.name}</span>
              {group.hasConflict ? (
                <StatusPill tone="amber">同名不同内容 · {group.hashes.length} 份</StatusPill>
              ) : group.refs.length > 1 ? (
                <StatusPill tone="green">
                  {group.refs.length} 处引用{group.sameLocation ? " · 同一目录" : ""}
                </StatusPill>
              ) : null}
            </div>
            <div className="ref-badges">
              {group.agentIds.map((id) => (
                <StatusPill key={id} tone="gray">
                  {agentName(id)}
                </StatusPill>
              ))}
              {group.refs.length > group.agentIds.length ? (
                <span className="ref-badges-note">共 {group.refs.length} 处登记</span>
              ) : null}
            </div>
            <div className="cell-sub" title={group.description || "—"}>
              {group.description || "—"}
            </div>
          </td>
          <td>
            <StatusPill tone={scope.tone}>{scope.text}</StatusPill>
          </td>
          <td className="mono-cell" title={displayPath(primary.path)}>
            {middleEllipsis(displayPath(primary.path))}
          </td>
          <td className="col-num">{group.scriptCount}</td>
          <td className="col-action">
            <button
              type="button"
              className="link-button"
              onClick={(event) => {
                event.stopPropagation();
                void copyPaths(groupCopyKey, group.refs.map((ref) => displayPath(ref.path)));
              }}
            >
              {copiedKey === groupCopyKey ? "已复制" : "复制路径"}
            </button>
          </td>
        </tr>
        {open ? (
          <tr className="row-detail">
            <td />
            <td colSpan={5}>
              <ul className="ref-list">
                {group.refs.map((ref) => {
                  const refCopyKey = `ref:${ref.id}`;
                  return (
                    <li key={ref.id}>
                      <StatusPill tone="gray">{agentName(ref.agentId)}</StatusPill>
                      <StatusPill tone={ref.scope === "user" ? "blue" : "green"}>
                        {ref.scope === "user" ? "用户" : "项目"}
                      </StatusPill>
                      <code className="ref-path" title={displayPath(ref.path)}>
                        {displayPath(ref.path)}
                      </code>
                      <code className="ref-hash" title={ref.contentHash}>
                        {shortHash(ref.contentHash)}
                      </code>
                      {ref.scriptCount > 0 ? <span className="ref-note">{ref.scriptCount} scripts</span> : null}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void copyPaths(refCopyKey, [displayPath(ref.path)])}
                      >
                        {copiedKey === refCopyKey ? "已复制" : "复制"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {group.sameLocation && group.refs.length > 1 ? (
                <p className="ref-hint">这些 Agent 登记的是同一个目录，回写时只需软连接一次，不需要复制文件。</p>
              ) : null}
              {group.hasConflict ? (
                <p className="ref-hint ref-hint-warn">同名但内容不同，建议先比对再决定保留哪一份。</p>
              ) : null}
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  const renderInstanceRow = (instance: SkillInstanceRecord, missing = false) => {
    const copyKey = `instance:${instance.id}`;
    return (
      <tr key={instance.id} className={missing ? "row-missing" : undefined}>
        <td className="col-caret" />
        <td>
          <div className="cell-head">
            <span className="cell-title">{instance.name}</span>
            {missing ? <StatusPill tone="red">磁盘已消失</StatusPill> : null}
            <StatusPill tone="gray">{agentName(instance.agentId)}</StatusPill>
          </div>
          <div className="cell-sub" title={instance.description || "—"}>
            {instance.description || "—"}
          </div>
        </td>
        <td>
          <StatusPill tone={instance.scope === "user" ? "blue" : "green"}>
            {instance.scope === "user" ? "用户" : "项目"}
          </StatusPill>
        </td>
        <td className="mono-cell" title={displayPath(instance.path)}>
          {middleEllipsis(displayPath(instance.path))}
        </td>
        <td className="mono-cell" title={instance.contentHash}>
          {shortHash(instance.contentHash)}
        </td>
        <td className="col-num">{instance.scriptCount}</td>
        <td className="col-action">
          {missing ? (
            <span className="action-muted">不可用</span>
          ) : (
            <button
              type="button"
              className="link-button"
              onClick={() => void copyPaths(copyKey, [displayPath(instance.path)])}
            >
              {copiedKey === copyKey ? "已复制" : "复制路径"}
            </button>
          )}
        </td>
      </tr>
    );
  };

  const isGroup = (row: SkillGroup | SkillInstanceRecord): row is SkillGroup =>
    (row as SkillGroup).refs !== undefined;

  const columnCount = view === "unique" ? 6 : 7;
  const tableHead = (
    <thead>
      <tr>
        <th className="col-caret" aria-label="展开" />
        <th>Skill</th>
        <th>作用域</th>
        <th>路径</th>
        {view === "unique" ? null : <th>内容哈希</th>}
        <th className="col-num">scripts</th>
        <th className="col-action">操作</th>
      </tr>
    </thead>
  );

  const totalInScope =
    view === "unique" ? groups.length : view === "all" ? instances.length : missingInstances.length;

  const renderBody = (): ReactElement => {
    if (loading && !snapshot) {
      return (
        <div className="table-scroll">
          <table className="data-table">
            {tableHead}
            <tbody>
              {Array.from({ length: 6 }, (_, row) => (
                <tr className="skeleton-row" key={row}>
                  {Array.from({ length: columnCount }, (_, cell) => (
                    <td key={cell}>
                      <span className="skeleton-bar" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (instances.length === 0 && missingInstances.length === 0) {
      return (
        <EmptyState
          title="没有发现 Skill"
          body="确认本机已安装对应 Agent，或到下方「登记的项目目录」手动添加项目中的 skills 目录。"
          action={
            <Button variant="ghost" onClick={() => scrollToPanel("discovery-roots")}>
              去登记目录
            </Button>
          }
        />
      );
    }

    if (rowCount === 0) {
      return (
        <EmptyState
          title="没有匹配的 Skill"
          body="当前筛选条件下没有结果，可以放宽筛选或清空搜索关键词。"
          action={
            <Button variant="ghost" onClick={resetFilters}>
              清除全部筛选
            </Button>
          }
        />
      );
    }

    return (
      <div className="table-scroll">
        <table className="data-table">
          {tableHead}
          <tbody>
            {visibleRows.map((row) =>
              isGroup(row)
                ? renderUniqueRow(row)
                : renderInstanceRow(row, view === "missing"),
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="page discover-page">
      <PageHeader
        title="发现"
        subtitle="只读扫描已登记 Agent 的用户目录与项目目录，Skills 保留在原位，不做任何复制"
        actions={
          <>
            <Button onClick={() => void load()} disabled={busy || loading}>
              {loading ? "扫描中…" : "重新扫描"}
            </Button>
            <Button
              variant="primary"
              onClick={onGovern}
              disabled={groups.length === 0}
              title={`将带着 ${filteredGroups.length} 个唯一 Skill 进入治理`}
            >
              下一步：治理（{groups.length} 个 Skill）→
            </Button>
          </>
        }
      />

      {error ? <ErrorNotice error={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="inline-notice notice-info"><span aria-hidden="true">✓</span><div className="notice-body"><strong>{notice}</strong></div></div> : null}

      <div className="summary-row summary-four">
        <button
          type="button"
          className="summary-card"
          onClick={() => scrollToPanel("discovery-roots")}
          title={undetected.length > 0 ? `未检测：${undetected.join("、")}` : "全部 Agent 均已检测到"}
        >
          <span>已检测 Agent</span>
          <strong>
            {detectedCount}
            <em>/{agentTotal}</em>
          </strong>
          <small>
            {undetected.length > 0 ? `${undetected.length} 个未检测 · 查看登记` : "查看登记目录"}
          </small>
        </button>
        <button
          type="button"
          className={projectOnly ? "summary-card summary-card-active" : "summary-card"}
          onClick={() => setProjectOnly((value) => !value)}
          aria-pressed={projectOnly}
        >
          <span>已登记目录</span>
          <strong>{roots.length}</strong>
          <small>{projectOnly ? "正在只看项目作用域 · 点击取消" : "点击只看项目作用域"}</small>
        </button>
        <button
          type="button"
          className={view !== "unique" ? "summary-card summary-card-active" : "summary-card"}
          onClick={() => switchView(view === "unique" ? "all" : "unique")}
          aria-pressed={view !== "unique"}
        >
          <span>发现的 Skill</span>
          <strong>
            {groups.length}
            <em>/ {instances.length}</em>
          </strong>
          <small>
            {view === "unique"
              ? `唯一 Skill · 点击看全部 ${instances.length} 条实例`
              : `正在看实例视图 · 点击回到唯一 Skill`}
          </small>
        </button>
        <button
          type="button"
          className={warnings.length > 0 ? "summary-card summary-card-alert" : "summary-card"}
          onClick={() => scrollToPanel("discovery-warnings")}
          disabled={warnings.length === 0}
        >
          <span>扫描告警</span>
          <strong>{warnings.length}</strong>
          <small>{warnings.length > 0 ? "查看明细" : "本次扫描无告警"}</small>
        </button>
      </div>

      <section className="panel-surface">
        <div className="panel-title">
          已发现的技能 · 聚合自 {roots.length} 个目录
          <span className="panel-count">
            {rowCount} / {totalInScope} 条
          </span>
        </div>
        <div className="panel-toolbar">
          <SearchField
            inputRef={searchRef}
            value={query}
            onChange={setQuery}
            placeholder="过滤 Skill（按 / 聚焦）…"
          />
          <select
            className="toolbar-select"
            aria-label="按 Agent 过滤"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
          >
            <option value={ALL_AGENTS}>全部 Agent（{agentOptions.length}）</option>
            {agentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} · {option.count} 条
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={resetFilters} disabled={!hasActiveFilters}>
            清除筛选
          </Button>
        </div>
        <div className="filter-row" role="group" aria-label="发现筛选">
          <button type="button" className={chipClass(quick === "all")} onClick={() => setQuick("all")}>
            全部 {groups.length}
          </button>
          <button
            type="button"
            className={chipClass(quick === "duplicate")}
            onClick={() => setQuick(quick === "duplicate" ? "all" : "duplicate")}
            disabled={duplicateCount === 0 || view !== "unique"}
            title={
              view !== "unique"
                ? "该筛选只在「唯一 Skill」视图下可用"
                : "同一份 Skill 被多个 Agent 登记"
            }
          >
            重复登记 {duplicateCount}
          </button>
          <button
            type="button"
            className={chipClass(quick === "conflict")}
            onClick={() => setQuick(quick === "conflict" ? "all" : "conflict")}
            disabled={conflictCount === 0 || view !== "unique"}
            title={
              view !== "unique"
                ? "该筛选只在「唯一 Skill」视图下可用"
                : "同名但内容哈希不同，需要人工确认"
            }
          >
            内容冲突 {conflictCount}
          </button>
          <button
            type="button"
            className={chipClass(quick === "scripts")}
            onClick={() => setQuick(quick === "scripts" ? "all" : "scripts")}
            disabled={scriptCount === 0 || view !== "unique"}
            title={view !== "unique" ? "该筛选只在「唯一 Skill」视图下可用" : "附带 scripts/ 资源的 Skill"}
          >
            带脚本 {scriptCount}
          </button>
          <span className="filter-spacer" />
          <button type="button" className={chipClass(view === "unique")} onClick={() => switchView("unique")}>
            唯一 Skill
          </button>
          <button type="button" className={chipClass(view === "all")} onClick={() => switchView("all")}>
            全部实例 {instances.length}
          </button>
          <button
            type="button"
            className={chipClass(view === "missing")}
            onClick={() => switchView("missing")}
            disabled={missingCount === 0}
            title="上次扫描后已从磁盘消失，卡片里还留着登记"
          >
            已失效 {missingCount}
          </button>
          {view === "unique" ? (
            <select
              className="sort-select"
              aria-label="排序方式"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="conflict">排序：冲突优先</option>
              <option value="refs">排序：引用最多</option>
              <option value="scripts">排序：脚本最多</option>
              <option value="name">排序：名称</option>
            </select>
          ) : null}
        </div>

        {snapshot && loading ? <div className="table-refreshing">正在重新扫描，结果稍后更新…</div> : null}

        {renderBody()}

        <p className="table-footnote">
          {view === "unique"
            ? `${groups.length} 个唯一 Skill，来自 ${instances.length} 条登记实例；点任意一行即可展开每个 Agent 的路径与哈希。`
            : view === "all"
              ? `正在按登记实例显示 ${filteredInstances.length} 条；切回「唯一 Skill」可看聚合结果。`
              : `以下 ${rowCount} 条是上次扫描后已从磁盘消失的登记记录，仅供核对，不参与治理与写回。`}
          {missingCount > 0 && view !== "missing"
            ? ` 另有 ${missingCount} 个 Skill 已在磁盘上消失，可在「已失效」视图查看。`
            : ""}
        </p>
      </section>

      <section className="panel-surface" id="discovery-roots">
        <div className="panel-title">登记的项目目录</div>
        <div className="root-panel-body">
          {roots.length === 0 ? (
            <EmptyState title="尚未登记任何目录" body="默认用户目录不存在时会静默跳过；可手动添加项目中的 skills 目录。" />
          ) : (
            <ul className="root-list">
              {roots.map((root) => (
                <li key={root.id}>
                  <div className="root-main">
                    <div className="root-heading">
                      <strong>{agentName(root.agentId)}</strong>
                      <StatusPill tone={root.scope === "user" ? "blue" : "green"}>
                        {root.scope === "user" ? "用户" : "项目"}
                      </StatusPill>
                      {root.isDefault ? <StatusPill tone="gray">默认</StatusPill> : null}
                    </div>
                    <code title={displayPath(root.configuredPath)}>{displayPath(root.configuredPath)}</code>
                    {root.lastWarning ? <span className="discovery-warning">{root.lastWarning}</span> : null}
                  </div>
                  {!root.isDefault ? (
                    <Button onClick={() => void removeRoot(root)} disabled={busy}>移除登记</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="root-add">
            <div className="root-add-heading">
              <h3>添加项目 Skills 目录</h3>
              <p className="muted-help">选择形如 &lt;仓库&gt;/.claude/skills 的目录，后端会按该 Agent 的约定校验。</p>
            </div>
            <div className="root-add-controls">
              <Button onClick={() => void pickDirectory()} disabled={busy}>
                {pickedPath ? "重新选择…" : "选择目录…"}
              </Button>
              <select
                aria-label="目标 Agent"
                value={pickedAgentId}
                onChange={(event) => setPickedAgentId(event.target.value)}
              >
                {catalog.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}（{agent.projectRoots.join(" / ")}）
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={() => void addRoot()} disabled={busy || !pickedPath}>
                登记并扫描
              </Button>
            </div>
            {pickedPath ? <p className="root-add-path mono-cell">已选：{displayPath(pickedPath)}</p> : null}
          </div>
        </div>
      </section>

      {warnings.length > 0 ? (
        <section className="panel-surface" id="discovery-warnings">
          <div className="panel-title">扫描告警（{warnings.length}）</div>
          <ul className="warning-list">
            {warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
