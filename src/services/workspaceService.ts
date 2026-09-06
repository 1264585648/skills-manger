import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { mockAgents, mockBundles, mockSkills, mockSources, mockSyncItems } from "../data/mock";
import type { Agent, Bundle, Skill, SourceConfig, SyncItem } from "../types/domain";

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

export type ImportSkillResult = {
  outcome: "created" | "updated" | "unchanged";
  skill: Skill;
};

const copy = <T,>(value: T): T => structuredClone(value);

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const formatTimestamp = (timestamp: number): string => {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp * 1000));
};

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

export const workspaceService = {
  async getSkills(): Promise<Skill[]> {
    if (!isTauriRuntime()) return copy(mockSkills);
    const records = await invoke<LibrarySkillRecord[]>("list_library_skills");
    return records.map(mapLibrarySkill);
  },

  async importSkillFromPicker(): Promise<ImportSkillResult | null> {
    if (!isTauriRuntime()) {
      throw new Error("导入 Skill 需要在桌面应用中执行");
    }

    const path = await open({
      directory: true,
      multiple: false,
      title: "选择包含 SKILL.md 的 Skill 目录",
    });

    if (!path) return null;

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

  async getBundles(): Promise<Bundle[]> { return copy(mockBundles); },
  async getAgents(): Promise<Agent[]> { return copy(mockAgents); },
  async getSyncItems(): Promise<SyncItem[]> { return copy(mockSyncItems); },
  async getSources(): Promise<SourceConfig[]> { return copy(mockSources); },
};
