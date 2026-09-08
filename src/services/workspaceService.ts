import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { mockAgents, mockBundles, mockSkills, mockSources, mockSyncItems } from "../data/mock";
import { formatTimestamp } from "./formatTimestamp";
import { createSkillImportPlan } from "./importPlanService";
import type { Agent, Bundle, Skill, SourceConfig, SyncItem } from "../types/domain";
import type { SkillImportCandidate, SkillImportPlan } from "../types/import";

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
  groups: [],
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
    if (!isTauriRuntime()) return copy(mockSkills);
    const records = await invoke<LibrarySkillRecord[]>("list_library_skills");
    return records.map(mapLibrarySkill);
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

  async getBundles(): Promise<Bundle[]> { return copy(mockBundles); },
  async getAgents(): Promise<Agent[]> { return copy(mockAgents); },
  async getSyncItems(): Promise<SyncItem[]> { return copy(mockSyncItems); },
  async getSources(): Promise<SourceConfig[]> { return copy(mockSources); },
};
