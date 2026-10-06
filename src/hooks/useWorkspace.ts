import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDirectoryRegistry } from "./useDirectoryRegistry";
import { useSkillVault } from "./useSkillVault";
import { useWorkspaceData } from "./useWorkspaceData";
import { suggestTagNames } from "../services/tagSuggestions";
import { workspaceService } from "../services/workspaceService";
import {
  displayPath,
  isGoverned,
  needsAttention,
  normalizePath,
  type SkillEntry,
} from "../types/domain";
import type { DiscoveryRootRecord } from "../types/discovery";

/** 视图筛选是单选的；「仅项目」「分组筛选」是与它正交的开关，可任意组合。 */
export type FilterKey = "all" | "attention" | "ungoverned" | "missing";

export type SortKey =
  | "name-asc"
  | "name-desc"
  | "targets-desc"
  | "scripts-desc"
  | "governance-desc";

export type ToastType = "success" | "info" | "warning" | "error";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  title?: string;
  timestamp: number;
}

/** 分发区的一行 = 一个 Agent（它的多个登记目录收敛成一行）。 */
export interface DistributionAgent {
  agentId: string;
  roots: DiscoveryRootRecord[];
  primary: DiscoveryRootRecord;
}
/**
 * 工作区的交互层：查询条件、选中、批量、以及全部写操作。数据来自 useWorkspaceData
 * （一次拉齐，选中切换不再触发请求）；所有写操作包在 withBusy 里，执行期间禁交互。
 */
export function useWorkspace() {
  const data = useWorkspaceData();
  // loading / error 不在这里解构：它们经 ...data 原样暴露给页面（加载态与错误态
  // 由列表/应用层渲染），本层不直接读。
  const { snapshot, catalog, setError, reload, entries, agentName } = data;

  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [projectOnly, setProjectOnly] = useState(false);
  /** 分组筛选："" 全部 / "__none__" 未分组 / 其余为 groupId；与视图筛选、仅项目正交。 */
  const [groupFilter, setGroupFilter] = useState("");
  /** 标签筛选："" 全部 / 其余为 tagId */
  const [tagFilter, setTagFilter] = useState("");
  /** Agent 筛选："" 全部 / 其余为 agentId */
  const [agentFilter, setAgentFilter] = useState("");
  /** 脚本安全筛选：仅含可执行脚本 */
  const [hasScriptsOnly, setHasScriptsOnly] = useState(false);
  /** 多维排序 */
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  /** 视图模式：卡片网格 vs 紧凑列表 */
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [showAllAgents, setShowAllAgents] = useState(false);

  const [noteDraft, setNoteDraft] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [batchTagId, setBatchTagId] = useState("");
  const [batchGroupId, setBatchGroupId] = useState("");
  const [batchRootId, setBatchRootId] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const lastClickedPathRef = useRef<string | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "info", title?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((previous) => [...previous.slice(-3), { id, message, type, title, timestamp: Date.now() }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((t) => t.id !== id));
  }, []);

  const setNotice = useCallback((msg: string | null) => {
    if (msg) showToast(msg, "success");
  }, [showToast]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const counts = useMemo(
    () => ({
      all: entries.length,
      attention: entries.filter(needsAttention).length,
      ungoverned: entries.filter((entry) => !isGoverned(entry)).length,
      missing: entries.filter((entry) => entry.missing).length,
      links: snapshot.links.length,
    }),
    [entries, snapshot.links],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = entries.filter((entry) => {
      if (filterKey === "attention" && !needsAttention(entry)) return false;
      if (filterKey === "ungoverned" && isGoverned(entry)) return false;
      if (filterKey === "missing" && !entry.missing) return false;
      if (projectOnly && !entry.hasProjectScope) return false;
      if (groupFilter === "__none__" && entry.groupId) return false;
      if (groupFilter && groupFilter !== "__none__" && entry.groupId !== groupFilter) return false;
      if (tagFilter && !entry.tagIds.includes(tagFilter)) return false;
      if (agentFilter && !entry.agentIds.includes(agentFilter)) return false;
      if (hasScriptsOnly && entry.scriptCount <= 0) return false;
      if (!normalized) return true;
      return `${entry.name} ${entry.description} ${displayPath(entry.path)} ${entry.note} ${entry.groupName ?? ""} ${entry.tagNames.join(" ")}`
        .toLowerCase()
        .includes(normalized);
    });

    return [...result].sort((left, right) => {
      switch (sortKey) {
        case "name-asc":
          return left.name.localeCompare(right.name);
        case "name-desc":
          return right.name.localeCompare(left.name);
        case "targets-desc":
          return right.installedRootIds.length - left.installedRootIds.length || left.name.localeCompare(right.name);
        case "scripts-desc":
          return right.scriptCount - left.scriptCount || left.name.localeCompare(right.name);
        case "governance-desc": {
          const scoreLeft = (left.groupId ? 2 : 0) + (left.tagIds.length ? 1 : 0) + (left.note ? 1 : 0);
          const scoreRight = (right.groupId ? 2 : 0) + (right.tagIds.length ? 1 : 0) + (right.note ? 1 : 0);
          return scoreRight - scoreLeft || left.name.localeCompare(right.name);
        }
        default:
          return left.name.localeCompare(right.name);
      }
    });
  }, [
    entries,
    query,
    filterKey,
    projectOnly,
    groupFilter,
    tagFilter,
    agentFilter,
    hasScriptsOnly,
    sortKey,
  ]);

  // 分组或标签被删/改名后，指向它的筛选条件自动复位，避免下拉框停在空值。
  useEffect(() => {
    const staleGroup =
      groupFilter !== "" &&
      groupFilter !== "__none__" &&
      !snapshot.groups.some((group) => group.id === groupFilter);
    if (staleGroup) setGroupFilter("");

    const staleTag = tagFilter !== "" && !snapshot.tags.some((tag) => tag.id === tagFilter);
    if (staleTag) setTagFilter("");
  }, [groupFilter, tagFilter, snapshot.groups, snapshot.tags]);

  const hasActiveFilters = Boolean(
    query.trim() ||
      filterKey !== "all" ||
      projectOnly ||
      groupFilter ||
      tagFilter ||
      agentFilter ||
      hasScriptsOnly,
  );

  const clearAllFilters = useCallback((): void => {
    setQuery("");
    setFilterKey("all");
    setProjectOnly(false);
    setGroupFilter("");
    setTagFilter("");
    setAgentFilter("");
    setHasScriptsOnly(false);
  }, []);

  const selected = useMemo(
    () => entries.find((entry) => entry.path === selectedPath) ?? null,
    [entries, selectedPath],
  );

  const selectedEntries = useMemo(
    () => entries.filter((entry) => checked.has(entry.path)),
    [entries, checked],
  );

  useEffect(() => {
    if (!filtered.length) return;
    if (!selectedPath || !filtered.some((entry) => entry.path === selectedPath)) {
      setSelectedPath(filtered[0].path);
    }
  }, [filtered, selectedPath]);

  useEffect(() => {
    setNoteDraft(selected?.note ?? "");
  }, [selected?.path, selected?.note]);

  /**
   * 分发列表按 Agent 聚合，**只列本机真正安装了的 Agent**。
   *
   * 目录约定有多个 fallback root（Cursor 同时认 .cursor/.agents/.claude/.codex），
   * 逐个 root 展示会让同一 Agent 重复出现，所以按 Agent 收敛成一行。
   * 「安装」的判定取 `installed`（PATH 里有可执行文件）而不是 `detected`（目录存在）——
   * 后者会把卸载后残留的空目录也算成已装，右侧于是多出几行噪音。
   */
  const distAgents = useMemo<DistributionAgent[]>(() => {
    const visible = (showAllAgents
      ? snapshot.targets
      : snapshot.targets.filter((t) => t.installed)
    ).filter((t) => t.id !== "skills-manager-vault");
    const ids = new Set(visible.map((target) => target.id));
    const byAgent = new Map<string, DiscoveryRootRecord[]>();
    for (const root of snapshot.roots) {
      if (!root.enabled || !ids.has(root.agentId) || root.agentId === "skills-manager-vault") continue;
      const list = byAgent.get(root.agentId);
      if (list) list.push(root);
      else byAgent.set(root.agentId, [root]);
    }
    return [...byAgent.entries()]
      .map(([agentId, roots]) => {
        const sorted = [...roots].sort(
          (left, right) => Number(left.scope !== "user") - Number(right.scope !== "user"),
        );
        const fragments = [agentId, agentId.split("-")[0]].map((f) => `.${f}`);
        const own = sorted.find((root) => {
          const normalized = normalizePath(root.configuredPath);
          return fragments.some((fragment) => normalized.includes(fragment));
        });
        return { agentId, roots: sorted, primary: own ?? sorted[0] };
      })
      .sort((left, right) => agentName(left.agentId).localeCompare(agentName(right.agentId)));
  }, [snapshot.roots, snapshot.targets, showAllAgents, agentName]);

  const withBusy = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      console.error("Workspace action error:", cause);
      setError(cause);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [setError, setNotice]);

  const linkIdsFor = useCallback(
    (entryOrPath: SkillEntry | string, rootIds: string[]): string[] => {
      const rootSet = new Set(rootIds);
      const isString = typeof entryOrPath === "string";
      const pathNorm = normalizePath(isString ? entryOrPath : entryOrPath.path);
      const nameKey = (isString ? entryOrPath.split(/[\/\\]/).pop() : entryOrPath.name)
        ?.trim()
        .toLowerCase();

      return snapshot.links
        .filter((link) => {
          if (!rootSet.has(link.targetRootId)) return false;
          if (normalizePath(link.skillPath) === pathNorm) return true;
          if (nameKey && link.skillName.trim().toLowerCase() === nameKey) return true;
          return false;
        })
        .map((link) => link.id);
    },
    [snapshot.links],
  );

  // ------------------------------------------------------------------ 分发

  /**
   * 针对指定 Agent 切换开启/停用状态。
   * 静默流转：
   * - 停用时：若为源目录本体，则先安全归档入中央库再断开，原配置与代码永不丢失。
   * - 启用时：若尚未入库，静默纳管后建立链接，全 Agent 对等统一分发。
   */
  const toggleAgentDistribution = useCallback(
    (
      entry: SkillEntry,
      agent: DistributionAgent,
      state: { isHome: boolean; installed: boolean; linkIds: string[] },
    ): void =>
      void withBusy(async () => {
        const agentDisplayName = agentName(agent.agentId);
        if (state.installed) {
          if (state.isHome) {
            const vaultPath = await workspaceService.deactivateHomeSkill(entry.path);
            setSelectedPath(vaultPath);
            setNotice(`「${entry.name}」已为 ${agentDisplayName} 停用，原配置与代码已安全保存在技能库`);
          } else {
            const targetIds =
              state.linkIds.length > 0
                ? state.linkIds
                : linkIdsFor(entry, agent.roots.map((r) => r.id));
            for (const linkId of targetIds) {
              await workspaceService.unlinkSkill(linkId);
            }
            setNotice(`「${entry.name}」已为 ${agentDisplayName} 停用`);
          }
        } else {
          let activeSkillPath = entry.path;
          if (!entry.inVault) {
            activeSkillPath = await workspaceService.incorporateToVault(entry.path);
            setSelectedPath(activeSkillPath);
          }
          await workspaceService.linkSkill(activeSkillPath, agent.primary.id);
          setNotice(`「${entry.name}」已为 ${agentDisplayName} 启用`);
        }
        await reload(true);
      }),
    [agentName, withBusy, reload, setNotice, linkIdsFor, setSelectedPath],
  );

  /** 一键启用所有可用 Agent */
  const installAllAgents = useCallback(
    (entry: SkillEntry, targetAgents: DistributionAgent[]): void =>
      void withBusy(async () => {
        let activeSkillPath = entry.path;
        if (!entry.inVault) {
          activeSkillPath = await workspaceService.incorporateToVault(entry.path);
          setSelectedPath(activeSkillPath);
        }
        for (const agent of targetAgents) {
          await workspaceService.linkSkill(activeSkillPath, agent.primary.id);
        }
        setNotice(`「${entry.name}」已为全部 ${targetAgents.length} 个可用 Agent 启用`);
        await reload(true);
      }),
    [withBusy, reload, setNotice, setSelectedPath],
  );

  /** 一键在所有 Agent 中停用 */
  const uninstallAllAgents = useCallback(
    (
      entry: SkillEntry,
      states: Array<{ agent: DistributionAgent; isHome: boolean; linkIds: string[] }>,
    ): void =>
      void withBusy(async () => {
        let preservedVaultPath: string | null = null;
        for (const state of states) {
          if (state.isHome) {
            preservedVaultPath = await workspaceService.deactivateHomeSkill(entry.path);
          } else {
            const targetIds =
              state.linkIds.length > 0
                ? state.linkIds
                : linkIdsFor(entry, state.agent.roots.map((r) => r.id));
            for (const linkId of targetIds) {
              await workspaceService.unlinkSkill(linkId);
            }
          }
        }
        if (preservedVaultPath) {
          setSelectedPath(preservedVaultPath);
        }
        setNotice(`「${entry.name}」已在全部 Agent 中停用，配置已安全保存在技能库`);
        await reload(true);
      }),
    [withBusy, reload, setNotice, linkIdsFor, setSelectedPath],
  );

  const setAgentLinks = useCallback(
    (entry: SkillEntry, changes: Array<{ rootId: string; linkIds: string[] }>): void =>
      void withBusy(async () => {
        let activeSkillPath = entry.path;
        const hasInstalls = changes.some((c) => c.linkIds.length === 0);
        if (hasInstalls && !entry.inVault) {
          activeSkillPath = await workspaceService.incorporateToVault(entry.path);
        }
        for (const change of changes) {
          if (change.linkIds.length > 0) {
            for (const linkId of change.linkIds) await workspaceService.unlinkSkill(linkId);
          } else {
            await workspaceService.linkSkill(activeSkillPath, change.rootId);
          }
        }
        const installs = changes.filter((change) => change.linkIds.length === 0).length;
        const removals = changes.reduce((sum, change) => sum + change.linkIds.length, 0);
        if (installs > 0 && removals > 0) {
          setNotice(`「${entry.name}」已装到 ${installs} 个 Agent，并移除 ${removals} 条连接`);
        } else if (installs > 0) {
          setNotice(installs === 1 ? `「${entry.name}」已创建连接` : `「${entry.name}」已装到 ${installs} 个 Agent`);
        } else if (removals > 0) {
          setNotice(removals === 1 ? `「${entry.name}」已移除连接` : `「${entry.name}」已移除 ${removals} 条连接`);
        }
        await reload(true);
      }),
    [withBusy, reload, setNotice],
  );

  const toggleAgentLink = useCallback(
    (entry: SkillEntry, primaryRootId: string, existingLinkIds: string[]): void =>
      setAgentLinks(entry, [{ rootId: primaryRootId, linkIds: existingLinkIds }]),
    [setAgentLinks],
  );

  // ------------------------------------------------------------------ 治理

  const changeGroup = useCallback(
    (entry: SkillEntry, groupId: string | null): void =>
      void withBusy(async () => {
        await workspaceService.setSkillGroup(entry.path, groupId);
        await reload();
      }),
    [withBusy, reload],
  );

  const toggleTag = useCallback(
    (entry: SkillEntry, tagId: string): void =>
      void withBusy(async () => {
        const next = entry.tagIds.includes(tagId)
          ? entry.tagIds.filter((id) => id !== tagId)
          : [...entry.tagIds, tagId];
        await workspaceService.setSkillTags(entry.path, next);
        await reload();
      }),
    [withBusy, reload],
  );

  /** 简介失焦即存：治 100 个 Skill 不该点 100 次「保存」。 */
  const saveNote = useCallback((): void => {
    if (!selected || noteDraft === selected.note) return;
    void withBusy(async () => {
      await workspaceService.setSkillNote(selected.path, noteDraft);
      await reload();
    });
  }, [selected, noteDraft, withBusy, reload]);

  const createGroup = useCallback((): void => {
    const name = newGroupName.trim();
    if (!name) return;
    void withBusy(async () => {
      await workspaceService.upsertGroup(name);
      setNewGroupName("");
      await reload();
    });
  }, [newGroupName, withBusy, reload]);

  const createTag = useCallback((): void => {
    const name = newTagName.trim();
    if (!name) return;
    void withBusy(async () => {
      await workspaceService.upsertTag(name);
      setNewTagName("");
      await reload();
    });
  }, [newTagName, withBusy, reload]);

  const suggestions = useMemo(() => {
    if (!selected) return [];
    return suggestTagNames(selected.refs[0], snapshot.tags).filter(
      (name) => !selected.tagNames.includes(name),
    );
  }, [selected, snapshot.tags]);

  // ------------------------------------------------------------------ 批量

  const applyTagToSelection = useCallback((): void => {
    if (!batchTagId) {
      setNotice("请先在下拉列表中选择要添加的目标标签，或选择清空标签");
      return;
    }
    void withBusy(async () => {
      if (batchTagId === "__clear_tags__") {
        for (const entry of selectedEntries) {
          await workspaceService.setSkillTags(entry.path, []);
        }
        setNotice(`已清空 ${selectedEntries.length} 个 Skill 的标签`);
      } else {
        for (const entry of selectedEntries) {
          if (!entry.tagIds.includes(batchTagId)) {
            await workspaceService.setSkillTags(entry.path, [...entry.tagIds, batchTagId]);
          }
        }
        setNotice(`已为 ${selectedEntries.length} 个 Skill 加上标签`);
      }
      setBatchTagId("");
      await reload();
    });
  }, [batchTagId, selectedEntries, withBusy, reload, setNotice]);

  const applyGroupToSelection = useCallback((): void => {
    if (!batchGroupId) {
      setNotice("请先在下拉列表中选择目标分组，或选择清除分组");
      return;
    }
    void withBusy(async () => {
      const targetGroupId = batchGroupId === "__clear__" ? null : batchGroupId;
      for (const entry of selectedEntries) {
        await workspaceService.setSkillGroup(entry.path, targetGroupId);
      }
      setNotice(
        targetGroupId
          ? `已把 ${selectedEntries.length} 个 Skill 归入分组`
          : `已清除 ${selectedEntries.length} 个 Skill 的分组`,
      );
      setBatchGroupId("");
      await reload();
    });
  }, [batchGroupId, selectedEntries, withBusy, reload, setNotice]);

  const writeBackSelection = useCallback((): void => {
    if (!batchRootId) {
      setNotice("请先在下拉列表中选择写回的目标 Agent 目录");
      return;
    }
    void withBusy(async () => {
      let created = 0;
      for (const entry of selectedEntries) {
        if (linkIdsFor(entry.path, [batchRootId]).length > 0) continue;
        await workspaceService.linkSkill(entry.path, batchRootId);
        created += 1;
      }
      setNotice(created ? `已写回 ${created} 个新连接` : "选中的 Skill 都已在该目录");
      setBatchRootId("");
      await reload(true);
    });
  }, [batchRootId, selectedEntries, linkIdsFor, withBusy, reload, setNotice]);

  const toggleChecked = useCallback((path: string, isShift = false): void => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (isShift && lastClickedPathRef.current && lastClickedPathRef.current !== path) {
        const lastIdx = filtered.findIndex((e) => e.path === lastClickedPathRef.current);
        const currIdx = filtered.findIndex((e) => e.path === path);
        if (lastIdx !== -1 && currIdx !== -1) {
          const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
          for (let i = start; i <= end; i++) {
            next.add(filtered[i].path);
          }
          lastClickedPathRef.current = path;
          return next;
        }
      }

      if (next.has(path)) next.delete(path);
      else next.add(path);
      lastClickedPathRef.current = path;
      return next;
    });
  }, [filtered]);

  const clearChecked = useCallback((): void => {
    lastClickedPathRef.current = null;
    setChecked(new Set<string>());
  }, []);

  /** 全键盘导航与快捷键系统 (↑/↓/J/K 选择, Space 勾选, / 搜索, ? 快捷键指南) */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (isInput) {
        if (event.key === "Escape") (target as HTMLInputElement).blur();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsModalOpen((prev) => !prev);
        return;
      }

      if (event.key === "Escape") {
        if (shortcutsModalOpen) {
          setShortcutsModalOpen(false);
          return;
        }
      }

      if (filtered.length > 0) {
        const currentIndex = filtered.findIndex((e) => e.path === selectedPath);

        if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
          event.preventDefault();
          const nextIndex = currentIndex < filtered.length - 1 ? currentIndex + 1 : 0;
          setSelectedPath(filtered[nextIndex].path);
          return;
        }

        if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
          event.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : filtered.length - 1;
          setSelectedPath(filtered[prevIndex].path);
          return;
        }

        if (event.key === " " && selectedPath) {
          event.preventDefault();
          toggleChecked(selectedPath);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, selectedPath, shortcutsModalOpen, toggleChecked]);

  // ------------------------------------------------------------------ 目录登记

  const registry = useDirectoryRegistry({ catalog, withBusy, reload, setNotice, setError });
  const vault = useSkillVault({ withBusy, reload, setNotice });

  const refreshScan = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      await reload(true);
      setNotice(`扫描完成：已刷新所有技能与目录状态`);
    });
  }, [reload, withBusy, setNotice]);

  return {
    ...data,
    counts,
    filtered,
    selected,
    selectedEntries,
    distAgents,
    suggestions,
    busy,
    notice: toasts.length > 0 ? toasts[toasts.length - 1].message : null,
    toasts,
    showToast,
    removeToast,
    shortcutsModalOpen,
    setShortcutsModalOpen,
    query,
    filterKey,
    projectOnly,
    groupFilter,
    tagFilter,
    agentFilter,
    hasScriptsOnly,
    sortKey,
    viewMode,
    hasActiveFilters,
    selectedPath, checked, showAllAgents, noteDraft, newGroupName, newTagName,
    batchTagId, batchGroupId, batchRootId, searchRef,
    setQuery, setFilterKey, setProjectOnly, setGroupFilter,
    setTagFilter, setAgentFilter, setHasScriptsOnly, setSortKey, setViewMode,
    clearAllFilters, setSelectedPath,
    setShowAllAgents, setNoteDraft, setNewGroupName, setNewTagName,
    setBatchTagId, setBatchGroupId, setBatchRootId,
    setNotice,
    ...registry,
    ...vault,
    linkIdsFor,
    setAgentLinks,
    toggleAgentLink,
    toggleAgentDistribution,
    installAllAgents,
    uninstallAllAgents,
    refreshScan,
    changeGroup,
    toggleTag,
    saveNote,
    createGroup,
    createTag,
    applyTagToSelection,
    applyGroupToSelection,
    writeBackSelection,
    toggleChecked,
    clearChecked,
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspace>;
