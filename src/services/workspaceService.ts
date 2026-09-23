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

/** Flattened view of the backend agent catalog (for project-root conventions). */
export interface AgentCatalogEntry {
  id: string;
  name: string;
  provider: string;
  projectRoots: string[];
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

/**
 * Requests that are already in flight, keyed by command + arguments.
 *
 * React strict mode mounts effects twice in development and every page reloads
 * itself after a mutation, so without this the same expensive command (a full
 * disk scan, or seven governance queries) went to the backend twice back to
 * back. Duplicate callers now share one request instead.
 */
const inFlight = new Map<string, Promise<unknown>>();

const call = <T>(
  command: string,
  args?: Record<string, unknown>,
  options: { share?: boolean } = {},
): Promise<T> => {
  ensureDesktop();

  const key = options.share ? `${command}:${JSON.stringify(args ?? {})}` : null;
  if (key) {
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const request = (async (): Promise<T> => {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw new Error(formatCommandError(error));
    } finally {
      if (key) inFlight.delete(key);
    }
  })();

  if (key) inFlight.set(key, request);
  return request;
};

export const workspaceService = {
  // ---------------------------------------------------------------- 发现

  /** `force` walks the disk; the default serves the scan already cached by the backend. */
  scan(force = false): Promise<ScanSnapshot> {
    return call<ScanSnapshot>("scan", { force }, { share: !force });
  },

  listAgentCatalog(): Promise<AgentCatalogEntry[]> {
    return call<AgentCatalogEntry[]>("list_agent_catalog", undefined, { share: true });
  },

  listSkillInstances(): Promise<SkillInstanceRecord[]> {
    return call<SkillInstanceRecord[]>("list_skill_instances", undefined, { share: true });
  },

  listAgentTargets(): Promise<AgentTargetRecord[]> {
    return call<AgentTargetRecord[]>("list_agent_targets", undefined, { share: true });
  },

  listDiscoveryRoots(): Promise<DiscoveryRootRecord[]> {
    return call<DiscoveryRootRecord[]>("list_discovery_roots", undefined, { share: true });
  },

  addProjectRoot(agentId: string, path: string): Promise<DiscoveryRootRecord> {
    return call<DiscoveryRootRecord>("add_project_root", { agentId, path });
  },

  removeProjectRoot(id: string): Promise<void> {
    return call<void>("remove_project_root", { id });
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

  listGroups(): Promise<GroupRecord[]> {
    return call<GroupRecord[]>("list_groups", undefined, { share: true });
  },

  upsertGroup(name: string, id?: string): Promise<GroupRecord> {
    return call<GroupRecord>("upsert_group", { draft: { id: id ?? null, name } });
  },

  deleteGroup(id: string): Promise<void> {
    return call<void>("delete_group", { id });
  },

  setSkillGroup(skillPath: string, groupId: string | null): Promise<void> {
    return call<void>("set_skill_group", { skillPath, groupId });
  },

  listGroupAssignments(): Promise<AssignmentRecord[]> {
    return call<AssignmentRecord[]>("list_skill_group_assignments", undefined, { share: true });
  },

  listTags(): Promise<TagRecord[]> {
    return call<TagRecord[]>("list_tags", undefined, { share: true });
  },

  upsertTag(name: string, id?: string): Promise<TagRecord> {
    return call<TagRecord>("upsert_tag", { draft: { id: id ?? null, name } });
  },

  deleteTag(id: string): Promise<void> {
    return call<void>("delete_tag", { id });
  },

  setSkillTags(skillPath: string, tagIds: string[]): Promise<void> {
    return call<void>("set_skill_tags", { skillPath, tagIds });
  },

  listTagAssignments(): Promise<AssignmentRecord[]> {
    return call<AssignmentRecord[]>("list_skill_tag_assignments", undefined, { share: true });
  },

  setSkillNote(skillPath: string, note: string): Promise<SkillNoteRecord> {
    return call<SkillNoteRecord>("set_skill_note", { skillPath, note });
  },

  listSkillNotes(): Promise<SkillNoteRecord[]> {
    return call<SkillNoteRecord[]>("list_skill_notes", undefined, { share: true });
  },

  // ---------------------------------------------------------------- 写回

  linkSkill(skillPath: string, targetRootId: string): Promise<LinkOutcome> {
    return call<LinkOutcome>("link_skill", { skillPath, targetRootId });
  },

  unlinkSkill(linkId: string): Promise<LinkRecord> {
    return call<LinkRecord>("unlink_skill", { linkId });
  },

  listLinks(): Promise<LinkRecord[]> {
    return call<LinkRecord[]>("list_links", undefined, { share: true });
  },
};
