import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AgentTargetRecord,
  DiscoveryRootRecord,
  GroupRecord,
  LinkOutcome,
  LinkRecord,
  ScanSnapshot,
  SkillInstanceRecord,
  SkillNoteRecord,
  TagRecord,
} from "../types/discovery";

/** `skillPath -> groupId | tagId` assignment pairs from the backend. */
export interface AssignmentRecord {
  skillPath: string;
  targetId: string;
}

export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  // ---------------------------------------------------------------- 发现

  async scan(): Promise<ScanSnapshot> {
    ensureDesktop();
    try {
      return await invoke<ScanSnapshot>("scan");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listSkillInstances(): Promise<SkillInstanceRecord[]> {
    ensureDesktop();
    try {
      return await invoke<SkillInstanceRecord[]>("list_skill_instances");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listAgentTargets(): Promise<AgentTargetRecord[]> {
    ensureDesktop();
    try {
      return await invoke<AgentTargetRecord[]>("list_agent_targets");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listDiscoveryRoots(): Promise<DiscoveryRootRecord[]> {
    ensureDesktop();
    try {
      return await invoke<DiscoveryRootRecord[]>("list_discovery_roots");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async addProjectRoot(agentId: string, path: string): Promise<DiscoveryRootRecord> {
    ensureDesktop();
    try {
      return await invoke<DiscoveryRootRecord>("add_project_root", { agentId, path });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async removeProjectRoot(id: string): Promise<void> {
    ensureDesktop();
    try {
      await invoke("remove_project_root", { id });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async pickSkillsDirectory(): Promise<string | null> {
    ensureDesktop();
    const selection = await open({
      directory: true,
      multiple: false,
      title: "选择项目的 Skills 目录（如 .claude/skills）",
    });
    if (!selection) return null;
    return Array.isArray(selection) ? selection[0] ?? null : selection;
  },

  // ---------------------------------------------------------------- 治理

  async listGroups(): Promise<GroupRecord[]> {
    ensureDesktop();
    try {
      return await invoke<GroupRecord[]>("list_groups");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async upsertGroup(name: string, id?: string): Promise<GroupRecord> {
    ensureDesktop();
    try {
      return await invoke<GroupRecord>("upsert_group", { draft: { id: id ?? null, name } });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async deleteGroup(id: string): Promise<void> {
    ensureDesktop();
    try {
      await invoke("delete_group", { id });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async setSkillGroup(skillPath: string, groupId: string | null): Promise<void> {
    ensureDesktop();
    try {
      await invoke("set_skill_group", { skillPath, groupId });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listGroupAssignments(): Promise<AssignmentRecord[]> {
    ensureDesktop();
    try {
      return await invoke<AssignmentRecord[]>("list_skill_group_assignments");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listTags(): Promise<TagRecord[]> {
    ensureDesktop();
    try {
      return await invoke<TagRecord[]>("list_tags");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async upsertTag(name: string, id?: string): Promise<TagRecord> {
    ensureDesktop();
    try {
      return await invoke<TagRecord>("upsert_tag", { draft: { id: id ?? null, name } });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async deleteTag(id: string): Promise<void> {
    ensureDesktop();
    try {
      await invoke("delete_tag", { id });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async setSkillTags(skillPath: string, tagIds: string[]): Promise<void> {
    ensureDesktop();
    try {
      await invoke("set_skill_tags", { skillPath, tagIds });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listTagAssignments(): Promise<AssignmentRecord[]> {
    ensureDesktop();
    try {
      return await invoke<AssignmentRecord[]>("list_skill_tag_assignments");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async setSkillNote(skillPath: string, note: string): Promise<SkillNoteRecord> {
    ensureDesktop();
    try {
      return await invoke<SkillNoteRecord>("set_skill_note", { skillPath, note });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listSkillNotes(): Promise<SkillNoteRecord[]> {
    ensureDesktop();
    try {
      return await invoke<SkillNoteRecord[]>("list_skill_notes");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  // ---------------------------------------------------------------- 写回

  async linkSkill(skillPath: string, targetRootId: string): Promise<LinkOutcome> {
    ensureDesktop();
    try {
      return await invoke<LinkOutcome>("link_skill", { skillPath, targetRootId });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async unlinkSkill(linkId: string): Promise<LinkRecord> {
    ensureDesktop();
    try {
      return await invoke<LinkRecord>("unlink_skill", { linkId });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async listLinks(): Promise<LinkRecord[]> {
    ensureDesktop();
    try {
      return await invoke<LinkRecord[]>("list_links");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },
};
