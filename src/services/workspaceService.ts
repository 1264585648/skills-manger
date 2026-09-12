import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { mockAgents, mockBundles, mockSkills, mockSources, mockSyncItems } from "../data/mock";
import { formatTimestamp } from "./formatTimestamp";
import { createSkillImportPlan } from "./importPlanService";
import { mapAgentTarget, mergeLibraryAndInstances } from "./discoveryMappers.ts";
import { mapBundleRecord } from "./bundlePlannerMappers.ts";
import type { Agent, Bundle, Skill, SkillTag, SourceConfig, SyncItem } from "../types/domain";
import type {
  AgentDiscoverySnapshot,
  AgentTargetRecord,
  DiscoveryRootRecord,
  SkillInstanceRecord,
} from "../types/discovery";
import type { SkillImportCandidate, SkillImportPlan } from "../types/import";
import type {
  ApplyOperationRecord,
  BundleDraft,
  BundleRecord,
  DeploymentRecord,
  SyncPlanRecord,
} from "../types/bundlePlanner";
import type { GitSourceDraft, SkillUpdateRecord } from "../types/gitSources";

type LibrarySkillRecord = {
  id: string;
  name: string;
  description: string;
  sourceKind: string;
  sourceLocator: string;
  version: string | null;
  license: string | null;
  compatibility: string | null;
  allowedTools: string | null;
  contentHash: string;
  libraryPath: string;
  scriptCount: number;
  importedAt: number;
  updatedAt: number;
};

type BackendTagRecord = {
  id: string;
  name: string;
  isSystem: boolean;
  skillCount: number;
  skillIds: string[];
};
export type SkillTagAssignment = { skillId: string; tagIds: string[] };

const systemTagNames = ["编码", "UI", "办公", "Review"];
const browserTagAssignments = new Map<string, string[]>(
  mockSkills.map((skill) => [skill.id, [...skill.tags]]),
);
const browserCustomTags = new Map<string, SkillTag>();

type SkillImportPreviewRecord = {
  path: string;
  name: string;
  description: string;
  source: "local";
  action: SkillImportCandidate["action"];
  reason: string;
  contentHash: string;
  existingSkillId: string | null;
};

export type ImportSkillResult = {
  outcome: "created" | "updated" | "unchanged";
  skill: Skill;
};

const copy = <T,>(value: T): T => structuredClone(value);

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const mapLibrarySkill = (record: LibrarySkillRecord): Skill => ({
  id: record.id,
  name: record.name,
  description: record.description,
  source: record.sourceKind === "local" ? "本地目录" : record.sourceKind,
  sourcePath: record.sourceLocator,
  libraryPath: record.libraryPath,
  contentHash: record.contentHash,
  version: record.version ?? "—",
  status: "clean",
  tags: [],
  bundles: [],
  targets: [],
  lastUpdated: formatTimestamp(record.updatedAt),
  security:
    record.scriptCount > 0
      ? `包含 scripts/ · ${record.scriptCount} 个文件`
      : "未发现 scripts/",
  license: record.license ?? undefined,
  compatibility: record.compatibility ?? undefined,
  allowedTools: record.allowedTools ?? undefined,
});

const formatCommandError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "操作失败";
};

const ensureDesktop = (): void => {
  if (!isTauriRuntime()) {
    throw new Error("此操作需要在桌面应用中执行");
  }
};

export const workspaceService = {
  async getSkills(): Promise<Skill[]> {
    if (!isTauriRuntime()) {
      return copy(mockSkills).map((skill) => ({ ...skill, tags: browserTagAssignments.get(skill.id) ?? [] }));
    }
    const [records, instances, targets, updates, tagRecords] = await Promise.all([
      invoke<LibrarySkillRecord[]>("list_library_skills"),
      invoke<SkillInstanceRecord[]>("list_skill_instances"),
      invoke<AgentTargetRecord[]>("list_agent_targets"),
      invoke<SkillUpdateRecord[]>("list_skill_updates"),
      invoke<BackendTagRecord[]>("list_tags"),
    ]);
    const tagsBySkill = new Map<string, string[]>();
    for (const tag of tagRecords) {
      for (const skillId of tag.skillIds) {
        tagsBySkill.set(skillId, [...(tagsBySkill.get(skillId) ?? []), tag.name]);
      }
    }
    const bySkill = new Map(updates.map((update) => [update.skillId, update]));
    const library = records.map((record) => {
      const skill = mapLibrarySkill(record);
      const update = bySkill.get(record.id);
      return {
        ...skill,
        ...(update
          ? {
              status: update.status,
              trackedSourceId: update.sourceId,
              updateStatus: update.status,
              canPromote: update.canPromote,
            }
          : {}),
        tags: tagsBySkill.get(record.id) ?? [],
      } satisfies Skill;
    });
    return mergeLibraryAndInstances(library, instances, targets);
  },

  async getTags(): Promise<SkillTag[]> {
    if (!isTauriRuntime()) {
      const skills = await this.getSkills();
      const builtins = systemTagNames.map((name, index) => ({
        id: `tag-${["coding", "ui", "office", "review"][index]}`,
        name,
        isSystem: true,
        skillCount: skills.filter((skill) => skill.status !== "unmanaged" && skill.tags.includes(name)).length,
      }));
      return [...builtins, ...Array.from(browserCustomTags.values()).map((tag) => ({
        ...tag,
        skillCount: skills.filter((skill) => skill.status !== "unmanaged" && skill.tags.includes(tag.name)).length,
      }))];
    }
    const records = await invoke<BackendTagRecord[]>("list_tags");
    return records.map(({ skillIds: _skillIds, ...tag }) => tag);
  },

  async upsertTag(name: string, id?: string): Promise<SkillTag> {
    if (!isTauriRuntime()) {
      const normalized = name.trim();
      const tagId = id ?? `tag-browser-${normalized.toLowerCase().replace(/\s+/g, "-")}`;
      const previousName = id ? browserCustomTags.get(id)?.name : undefined;
      const tag = { id: tagId, name: normalized, isSystem: false, skillCount: 0 };
      browserCustomTags.set(tagId, tag);
      if (previousName && previousName !== normalized) {
        for (const [skillId, assigned] of browserTagAssignments) {
          browserTagAssignments.set(skillId, assigned.map((assignedName) => assignedName === previousName ? normalized : assignedName));
        }
      }
      return tag;
    }
    const record = await invoke<BackendTagRecord>("upsert_tag", { draft: { id: id ?? null, name } });
    return { id: record.id, name: record.name, isSystem: record.isSystem, skillCount: record.skillCount };
  },

  async deleteTag(id: string): Promise<void> {
    if (!isTauriRuntime()) {
      const deletedName = browserCustomTags.get(id)?.name;
      browserCustomTags.delete(id);
      if (deletedName) for (const [skillId, tags] of browserTagAssignments) browserTagAssignments.set(skillId, tags.filter((tag) => tag !== deletedName));
      return;
    }
    await invoke("delete_tag", { id });
  },

  async setSkillTags(skillIds: string[], tagIds: string[]): Promise<void> {
    await this.updateSkillTagAssignments(skillIds.map((skillId) => ({ skillId, tagIds })));
  },

  async updateSkillTagAssignments(assignments: SkillTagAssignment[]): Promise<void> {
    if (!isTauriRuntime()) {
      const tags = await this.getTags();
      for (const assignment of assignments) {
        const names = assignment.tagIds.map((tagId) => tags.find((tag) => tag.id === tagId)?.name).filter((name): name is string => Boolean(name));
        browserTagAssignments.set(assignment.skillId, [...names]);
      }
      return;
    }
    await invoke("set_skill_tag_assignments", { assignments });
  },

  async pickSkillDirectory(): Promise<string | null> {
    ensureDesktop();
    const selection = await open({
      directory: true,
      multiple: false,
      title: "选择包含 SKILL.md 的 Skill 目录",
    });
    if (!selection) return null;
    return Array.isArray(selection) ? selection[0] ?? null : selection;
  },

  async previewSkillDirectory(path: string): Promise<SkillImportPlan> {
    ensureDesktop();
    try {
      const preview = await invoke<SkillImportPreviewRecord>("preview_skill_directory", { path });
      return createSkillImportPlan([
        {
          path: preview.path,
          name: preview.name,
          description: preview.description,
          source: preview.source,
          action: preview.action,
          reason: preview.reason,
          contentHash: preview.contentHash,
          existingSkillId: preview.existingSkillId ?? undefined,
        },
      ]);
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async previewSkillFromPicker(): Promise<SkillImportPlan | null> {
    const path = await this.pickSkillDirectory();
    return path ? this.previewSkillDirectory(path) : null;
  },

  async importSkillDirectory(path: string): Promise<ImportSkillResult> {
    ensureDesktop();
    try {
      const result = await invoke<{
        outcome: ImportSkillResult["outcome"];
        skill: LibrarySkillRecord;
      }>("import_skill_directory", { path });
      return {
        outcome: result.outcome,
        skill: mapLibrarySkill(result.skill),
      };
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async executeImportPlan(plan: SkillImportPlan): Promise<ImportSkillResult[]> {
    const blocked = plan.candidates.filter((candidate) => candidate.action === "conflict");
    if (blocked.length > 0) {
      throw new Error("导入计划仍有冲突，请先解决后再执行");
    }

    const executable = plan.candidates.filter(
      (candidate) => candidate.action === "add" || candidate.action === "update",
    );
    const results: ImportSkillResult[] = [];
    for (const candidate of executable) {
      results.push(await this.importSkillDirectory(candidate.path));
    }
    return results;
  },

  async importSkillFromPicker(): Promise<ImportSkillResult | null> {
    const path = await this.pickSkillDirectory();
    return path ? this.importSkillDirectory(path) : null;
  },

  async getBundles(): Promise<Bundle[]> {
    if (!isTauriRuntime()) return copy(mockBundles);
    const records = await invoke<BundleRecord[]>("list_bundles");
    return records.map(mapBundleRecord);
  },

  async getBundleRecords(): Promise<BundleRecord[]> {
    if (!isTauriRuntime()) return [];
    return invoke<BundleRecord[]>("list_bundles");
  },

  async saveBundle(draft: BundleDraft): Promise<BundleRecord> {
    ensureDesktop();
    try {
      return await invoke<BundleRecord>("upsert_bundle", { draft });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async deleteBundle(id: string): Promise<void> {
    ensureDesktop();
    try {
      await invoke("delete_bundle", { id });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async generateSyncPlan(bundleId: string, rootId: string): Promise<SyncPlanRecord> {
    ensureDesktop();
    try {
      return await invoke<SyncPlanRecord>("generate_sync_plan", { bundleId, rootId });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async applySyncPlan(planId: string): Promise<ApplyOperationRecord> {
    ensureDesktop();
    try {
      return await invoke<ApplyOperationRecord>("apply_sync_plan", { planId });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async getDeployments(): Promise<DeploymentRecord[]> {
    if (!isTauriRuntime()) return [];
    return invoke<DeploymentRecord[]>("list_deployments");
  },

  async getApplyOperations(): Promise<ApplyOperationRecord[]> {
    if (!isTauriRuntime()) return [];
    return invoke<ApplyOperationRecord[]>("list_apply_operations");
  },
  async getAgents(): Promise<Agent[]> {
    if (!isTauriRuntime()) return copy(mockAgents);
    const [targets, roots, instances] = await Promise.all([
      invoke<AgentTargetRecord[]>("list_agent_targets"),
      invoke<DiscoveryRootRecord[]>("list_discovery_roots"),
      invoke<SkillInstanceRecord[]>("list_skill_instances"),
    ]);
    return targets.map((target) => mapAgentTarget(target, instances, roots));
  },

  async scanClaudeCode(): Promise<AgentDiscoverySnapshot> {
    ensureDesktop();
    try {
      return await invoke<AgentDiscoverySnapshot>("scan_claude_code");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async scanAgents(): Promise<AgentDiscoverySnapshot[]> {
    ensureDesktop();
    try {
      await invoke("start_agent_scan", { agentId: null, rootId: null });
      let snapshot = await invoke<{ scan: { running: boolean; error: string | null } }>("get_agent_center");
      while (snapshot.scan.running) {
        await new Promise(resolve => setTimeout(resolve, 500));
        snapshot = await invoke("get_agent_center");
      }
      if (snapshot.scan.error) throw new Error(snapshot.scan.error);
      return [];
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async getDiscoveryRoots(): Promise<DiscoveryRootRecord[]> {
    if (!isTauriRuntime()) return [];
    return invoke<DiscoveryRootRecord[]>("list_discovery_roots");
  },

  async pickDiscoveryRoot(): Promise<string | null> {
    ensureDesktop();
    const selection = await open({
      directory: true,
      multiple: false,
      title: "选择项目的 .claude/skills 目录",
    });
    if (!selection) return null;
    return Array.isArray(selection) ? selection[0] ?? null : selection;
  },

  async addDiscoveryRoot(path: string, agentId = "claude-code"): Promise<DiscoveryRootRecord> {
    ensureDesktop();
    try {
      return await invoke<DiscoveryRootRecord>("add_discovery_root", {
        path,
        scope: "project",
        agentId,
      });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async removeDiscoveryRoot(id: string): Promise<void> {
    ensureDesktop();
    try {
      await invoke("remove_discovery_root", { id });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },
  async registerGitSource(draft: GitSourceDraft): Promise<SkillUpdateRecord> {
    ensureDesktop();
    try {
      return await invoke<SkillUpdateRecord>("register_git_source", { draft });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async getSkillUpdates(): Promise<SkillUpdateRecord[]> {
    if (!isTauriRuntime()) return [];
    return invoke<SkillUpdateRecord[]>("list_skill_updates");
  },

  async checkGitSource(sourceId: string): Promise<SkillUpdateRecord> {
    ensureDesktop();
    try {
      return await invoke<SkillUpdateRecord>("check_git_source", { sourceId });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async promoteGitSource(sourceId: string): Promise<ImportSkillResult> {
    ensureDesktop();
    try {
      const result = await invoke<{
        outcome: ImportSkillResult["outcome"];
        skill: LibrarySkillRecord;
      }>("promote_git_source", { sourceId });
      return { outcome: result.outcome, skill: mapLibrarySkill(result.skill) };
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },
  async getSyncItems(): Promise<SyncItem[]> { return copy(mockSyncItems); },

  async getSources(): Promise<SourceConfig[]> {
    if (!isTauriRuntime()) return copy(mockSources);
    const [records, roots, updates] = await Promise.all([
      invoke<LibrarySkillRecord[]>("list_library_skills"),
      invoke<DiscoveryRootRecord[]>("list_discovery_roots"),
      invoke<SkillUpdateRecord[]>("list_skill_updates"),
    ]);
    const gitRepositories = new Set(updates.map((update) => update.sourceId)).size;
    const localImports = records.filter((record) => record.sourceKind === "local").length;
    const enabledRoots = roots.filter((root) => root.enabled).length;

    return [
      {
        id: "source-git",
        name: "Git Repository",
        description: "跟踪仓库、分支与相对路径。",
        detail: `${gitRepositories} 个仓库`,
        enabled: gitRepositories > 0,
      },
      {
        id: "source-local",
        name: "本地目录",
        description: "你主动导入的本地 Skill 目录。",
        detail: `${localImports} 个本地导入`,
        enabled: localImports > 0,
      },
      {
        id: "source-agent",
        name: "Agent 发现目录",
        description: "只读扫描已登记 Agent 的 Skill 目录。",
        detail: `${enabledRoots} 个已启用 root`,
        enabled: enabledRoots > 0,
      },
    ];
  },
};
