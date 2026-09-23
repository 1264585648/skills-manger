import { useCallback, useEffect, useMemo, useState } from "react";
import { useSingleFlight } from "./useSingleFlight";
import { workspaceService, type AgentCatalogEntry } from "../services/workspaceService";
import { buildSkillEntries, type SkillEntry } from "../types/domain";
import type {
  AgentTargetRecord,
  DiscoveryRootRecord,
  GroupRecord,
  LinkRecord,
  SkillInstanceRecord,
  TagRecord,
} from "../types/discovery";

export interface WorkspaceSnapshot {
  instances: SkillInstanceRecord[];
  roots: DiscoveryRootRecord[];
  targets: AgentTargetRecord[];
  links: LinkRecord[];
  warnings: string[];
  groups: GroupRecord[];
  tags: TagRecord[];
  notes: Map<string, string>;
  groupByPath: Map<string, string>;
  tagIdsByPath: Map<string, string[]>;
}

export interface EntryCounts {
  all: number;
  attention: number;
  ungoverned: number;
  missing: number;
  links: number;
}

const emptySnapshot: WorkspaceSnapshot = {
  instances: [],
  roots: [],
  targets: [],
  links: [],
  warnings: [],
  groups: [],
  tags: [],
  notes: new Map(),
  groupByPath: new Map(),
  tagIdsByPath: new Map(),
};

const toMap = (pairs: Array<{ skillPath: string; targetId: string }>): Map<string, string> =>
  new Map(pairs.map((pair) => [pair.skillPath, pair.targetId]));

const toTagMap = (pairs: Array<{ skillPath: string; targetId: string }>): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const pair of pairs) {
    const current = map.get(pair.skillPath);
    if (current) current.push(pair.targetId);
    else map.set(pair.skillPath, [pair.targetId]);
  }
  return map;
};

/**
 * 一次拉齐全部数据，并派生出列表行与计数。
 *
 * 三页合并成单页之后，所有区域共享这一份数据：切换选中项、展开折叠面板都不会
 * 再触发任何请求 —— 只有显式的「重新扫描」/目录登记变更才走 force。
 */
export function useWorkspaceData() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot);
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (force = false): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [scan, links, groups, tags, noteRecords, groupPairs, tagPairs, entries] =
        await Promise.all([
          workspaceService.scan(force),
          workspaceService.listLinks(),
          workspaceService.listGroups(),
          workspaceService.listTags(),
          workspaceService.listSkillNotes(),
          workspaceService.listGroupAssignments(),
          workspaceService.listTagAssignments(),
          workspaceService.listAgentCatalog(),
        ]);
      setSnapshot({
        instances: scan.instances,
        roots: scan.roots,
        targets: scan.targets,
        warnings: scan.warnings,
        links,
        groups,
        tags,
        notes: new Map(noteRecords.map((record) => [record.skillPath, record.note])),
        groupByPath: toMap(groupPairs),
        tagIdsByPath: toTagMap(tagPairs),
      });
      setCatalog(entries);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  const { loadOnce, reload } = useSingleFlight(load);

  useEffect(() => {
    void loadOnce();
  }, [loadOnce]);

  const entries = useMemo<SkillEntry[]>(
    () =>
      buildSkillEntries({
        instances: snapshot.instances,
        links: snapshot.links,
        groups: snapshot.groups,
        tags: snapshot.tags,
        notes: snapshot.notes,
        groupByPath: snapshot.groupByPath,
        tagIdsByPath: snapshot.tagIdsByPath,
      }),
    [snapshot],
  );

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of catalog) map.set(agent.id, agent.name);
    for (const target of snapshot.targets) map.set(target.id, target.name);
    return map;
  }, [catalog, snapshot.targets]);

  const agentName = useCallback((id: string): string => agentNames.get(id) ?? id, [agentNames]);

  const uniqueWarnings = useMemo(() => [...new Set(snapshot.warnings)], [snapshot.warnings]);

  return { snapshot, catalog, loading, error, setError, reload, entries, agentName, uniqueWarnings };
}

export type WorkspaceData = ReturnType<typeof useWorkspaceData>;
