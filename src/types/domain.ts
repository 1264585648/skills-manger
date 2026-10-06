import type {
  GroupRecord,
  LinkRecord,
  SkillInstanceRecord,
  TagRecord,
} from "./discovery";

export interface EntrySources {
  instances: SkillInstanceRecord[];
  links: LinkRecord[];
  groups: GroupRecord[];
  tags: TagRecord[];
  notes: Map<string, string>;
  groupByPath: Map<string, string>;
  tagIdsByPath: Map<string, string[]>;
}

/**
 * 把扫描结果聚合成列表行。
 *
 * 按真实路径分桶：一个目录一行，`refs` 保留全部 Agent 登记；同名不同目录各自成行
 * 并标 `nameConflict`（那才是要人看的冲突）。最后按名称排序，保证顺序稳定。
 */
export const buildSkillEntries = (sources: EntrySources): SkillEntry[] => {
  const { instances, links, groups, tags, notes, groupByPath, tagIdsByPath } = sources;

  const pathsByName = new Map<string, Set<string>>();
  for (const instance of instances) {
    const key = instance.name.trim().toLowerCase();
    const paths = pathsByName.get(key) ?? new Set<string>();
    paths.add(instance.path);
    pathsByName.set(key, paths);
  }

  const buckets = new Map<string, SkillInstanceRecord[]>();
  for (const instance of instances) {
    const bucket = buckets.get(instance.path);
    if (bucket) bucket.push(instance);
    else buckets.set(instance.path, [instance]);
  }

  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  return [...buckets.entries()]
    .map(([path, refs]) => {
      const tagIds = tagIdsByPath.get(path) ?? [];
      const groupId = groupByPath.get(path) ?? null;
      const primary = refs[0];
      const key = primary.name.trim().toLowerCase();
      const sameNameInstances = instances.filter((i) => i.name.trim().toLowerCase() === key);
      const nameConflict = (pathsByName.get(key)?.size ?? 0) > 1;
      const uniqueHashes = new Set(sameNameInstances.map((i) => i.contentHash));
      const canAutoMerge = nameConflict && uniqueHashes.size === 1;
      const hasDivergentConflict = nameConflict && uniqueHashes.size > 1;
      const inVault = refs.some((ref) => ref.agentId === "skills-manager-vault");

      return {
        path,
        name: primary.name,
        description: refs.reduce(
          (longest, ref) => (ref.description.length > longest.length ? ref.description : longest),
          "",
        ),
        contentHash: primary.contentHash,
        refs,
        agentIds: [...new Set(refs.map((ref) => ref.agentId))],
        scriptCount: refs.reduce((max, ref) => Math.max(max, ref.scriptCount), 0),
        hasUserScope: refs.some((ref) => ref.scope === "user"),
        hasProjectScope: refs.some((ref) => ref.scope === "project"),
        missing: refs.every((ref) => ref.state === "missing"),
        nameConflict,
        canAutoMerge,
        hasDivergentConflict,
        conflictInstances: nameConflict ? sameNameInstances : [],
        inVault,
        installedRootIds: links
          .filter((link) => {
            const linkNorm = normalizePath(link.skillPath);
            const pathNorm = normalizePath(path);
            if (linkNorm === pathNorm) return true;
            if (link.skillName && link.skillName.trim().toLowerCase() === key) return true;
            return false;
          })
          .map((l) => l.targetRootId),
        note: notes.get(path) ?? "",
        groupId,
        groupName: groupId ? groupNames.get(groupId) ?? null : null,
        tagIds,
        tagNames: tagIds.map((id) => tagNames.get(id) ?? id),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

/**
 * 工作区里的一行 = 磁盘上的一个真实目录（Skill 本体）。
 *
 * 治理元数据与连接都以「真实路径」为键，所以列表按路径聚合：同一个目录被 10 个
 * Agent 登记时收敛成一行（`refs` 保留全部登记），而不是 10 行。同名不同目录则
 * 是两行，并各自标记 `nameConflict` —— 那才是需要人工介入的冲突。
 */
export interface SkillEntry {
  path: string;
  name: string;
  description: string;
  contentHash: string;
  refs: SkillInstanceRecord[];
  agentIds: string[];
  scriptCount: number;
  hasUserScope: boolean;
  hasProjectScope: boolean;
  missing: boolean;
  nameConflict: boolean;
  canAutoMerge: boolean;
  hasDivergentConflict: boolean;
  conflictInstances: SkillInstanceRecord[];
  inVault: boolean;
  installedRootIds: string[];
  note: string;
  groupId: string | null;
  groupName: string | null;
  tagIds: string[];
  tagNames: string[];
}

/** 治理过 = 分组、标签、中文简介至少占一样。 */
export const isGoverned = (entry: SkillEntry): boolean =>
  Boolean(entry.groupId || entry.tagIds.length > 0 || entry.note.trim().length > 0);

/** 需要人工看一眼 = 同名冲突，或已从磁盘消失。 */
export const needsAttention = (entry: SkillEntry): boolean => entry.nameConflict || entry.missing;

/** Strip the Windows \\?\ verbatim prefix for display. */
export const displayPath = (path: string): string =>
  path.startsWith("\\\\?\\") ? path.slice(4) : path;

/** Short, copy-friendly form of a content hash. */
export const shortHash = (hash: string): string =>
  hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;

/** Normalize a path for equality checks: forward slashes, no trailing slash, lowercase. */
export const normalizePath = (path: string): string =>
  displayPath(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** The directory containing a skill — used to spot the root it already lives in. */
export const parentPath = (path: string): string => {
  const normalized = displayPath(path).replace(/\\/g, "/").replace(/\/+$/, "");
  const cut = normalized.lastIndexOf("/");
  return cut > 0 ? normalized.slice(0, cut).toLowerCase() : "";
};
