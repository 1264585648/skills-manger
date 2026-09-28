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
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [projectOnly, setProjectOnly] = useState(false);
  /** 分组筛选："" 全部 / "__none__" 未分组 / 其余为 groupId；与视图筛选、仅项目正交。 */
  const [groupFilter, setGroupFilter] = useState("");
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

  /** `/` 从任何地方跳进过滤框，Escape 失焦。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (event.key === "Escape") (target as HTMLInputElement).blur();
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    return entries.filter((entry) => {
      if (filterKey === "attention" && !needsAttention(entry)) return false;
      if (filterKey === "ungoverned" && isGoverned(entry)) return false;
      if (filterKey === "missing" && !entry.missing) return false;
      if (projectOnly && !entry.hasProjectScope) return false;
      if (groupFilter === "__none__" && entry.groupId) return false;
      if (groupFilter && groupFilter !== "__none__" && entry.groupId !== groupFilter) return false;
      if (!normalized) return true;
      return `${entry.name} ${entry.description} ${displayPath(entry.path)} ${entry.note} ${entry.groupName ?? ""} ${entry.tagNames.join(" ")}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [entries, query, filterKey, projectOnly, groupFilter]);

  // 分组被删/改名后，指向它的筛选条件自动复位，避免下拉框停在空值。
  useEffect(() => {
    const stale =
      groupFilter !== "" &&
      groupFilter !== "__none__" &&
      !snapshot.groups.some((group) => group.id === groupFilter);
    if (stale) setGroupFilter("");
  }, [groupFilter, snapshot.groups]);

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
      setError(cause);
    } finally {
      setBusy(false);
    }
  }, [setError]);

  const linkIdsFor = useCallback(
    (skillPath: string, rootIds: string[]): string[] =>
      snapshot.links
        .filter((link) => link.skillPath === skillPath && rootIds.includes(link.targetRootId))
        .map((link) => link.id),
    [snapshot.links],
  );

  // ------------------------------------------------------------------ 分发

  /**
   * 一次 withBusy 内串行改多条连接，结束只 reload 一次：批量入口把整批变更当成
   * 一次原子操作（逐个 toggle 会并发 N 组请求、触发 N 次 reload、busy 保护失效）。
   * 完成后发全局反馈 —— 装/卸是最高频操作，静默成功会让人怀疑到底点没点上。
   */
  const setAgentLinks = useCallback(
    (entry: SkillEntry, changes: Array<{ rootId: string; linkIds: string[] }>): void =>
      void withBusy(async () => {
        for (const change of changes) {
          if (change.linkIds.length > 0) {
            for (const linkId of change.linkIds) await workspaceService.unlinkSkill(linkId);
          } else {
            await workspaceService.linkSkill(entry.path, change.rootId);
          }
        }
        const installs = changes.filter((change) => change.linkIds.length === 0).length;
        const removals = changes.reduce((sum, change) => sum + change.linkIds.length, 0);
        if (installs > 0 && removals > 0) {
          setNotice(`「${entry.name}」已装到 ${installs} 个 Agent，并移除 ${removals} 条连接`);
        } else if (installs > 0) {
          setNotice(installs === 1 ? `「${entry.name}」已创建软连接` : `「${entry.name}」已装到 ${installs} 个 Agent`);
        } else if (removals > 0) {
          setNotice(removals === 1 ? `「${entry.name}」已移除连接` : `「${entry.name}」已移除 ${removals} 条连接`);
        }
        await reload();
      }),
    [withBusy, reload],
  );

  /** 安装到该 Agent 的主目录；卸载则移除该 Agent 名下本应用创建的全部连接。 */
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
    if (!batchTagId) return;
    void withBusy(async () => {
      for (const entry of selectedEntries) {
        if (!entry.tagIds.includes(batchTagId)) {
          await workspaceService.setSkillTags(entry.path, [...entry.tagIds, batchTagId]);
        }
      }
      setNotice(`已为 ${selectedEntries.length} 个 Skill 加上标签`);
      await reload();
    });
  }, [batchTagId, selectedEntries, withBusy, reload]);

  const applyGroupToSelection = useCallback((): void => {
    void withBusy(async () => {
      for (const entry of selectedEntries) {
        await workspaceService.setSkillGroup(entry.path, batchGroupId || null);
      }
      setNotice(`已把 ${selectedEntries.length} 个 Skill 归入分组`);
      setBatchGroupId("");
      await reload();
    });
  }, [batchGroupId, selectedEntries, withBusy, reload]);

  const writeBackSelection = useCallback((): void => {
    if (!batchRootId) return;
    void withBusy(async () => {
      let created = 0;
      for (const entry of selectedEntries) {
        if (linkIdsFor(entry.path, [batchRootId]).length > 0) continue;
        await workspaceService.linkSkill(entry.path, batchRootId);
        created += 1;
      }
      setNotice(created ? `已写回 ${created} 个新连接` : "选中的 Skill 都已在该目录");
      setBatchRootId("");
      await reload();
    });
  }, [batchRootId, selectedEntries, linkIdsFor, withBusy, reload]);

  const toggleChecked = useCallback((path: string): void => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const clearChecked = useCallback((): void => setChecked(new Set<string>()), []);

  // ------------------------------------------------------------------ 目录登记

  const registry = useDirectoryRegistry({ catalog, withBusy, reload, setNotice, setError });
  const vault = useSkillVault({ withBusy, reload, setNotice });

  return {
    ...data,
    counts,
    filtered,
    selected,
    selectedEntries,
    distAgents,
    suggestions,
    busy,
    notice,
    query,
    filterKey,
    projectOnly,
    groupFilter,
    selectedPath, checked, showAllAgents, noteDraft, newGroupName, newTagName,
    batchTagId, batchGroupId, batchRootId, searchRef,
    setQuery, setFilterKey, setProjectOnly, setGroupFilter, setSelectedPath,
    setShowAllAgents, setNoteDraft, setNewGroupName, setNewTagName,
    setBatchTagId, setBatchGroupId, setBatchRootId,
    ...registry,
    ...vault,
    linkIdsFor,
    setAgentLinks,
    toggleAgentLink,
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
