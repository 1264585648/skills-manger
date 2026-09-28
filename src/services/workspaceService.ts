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
import {
  MOCK_CATALOG,
  MOCK_GROUPS,
  MOCK_GROUP_ASSIGNMENTS,
  MOCK_LINKS,
  MOCK_NOTES,
  MOCK_SNAPSHOT,
  MOCK_TAGS,
  MOCK_TAG_ASSIGNMENTS,
} from "./browserMockData";

export interface AssignmentRecord {
  skillPath: string;
  targetId: string;
}

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

const inFlight = new Map<string, Promise<unknown>>();

const call = <T>(
  command: string,
  args?: Record<string, unknown>,
  options: { share?: boolean } = {},
): Promise<T> => {
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

// ---------------- In-memory Mock State for Browser Dev Preview
let mockSnapshot = { ...MOCK_SNAPSHOT };
let mockGroups = [...MOCK_GROUPS];
let mockTags = [...MOCK_TAGS];
let mockLinks = [...MOCK_LINKS];
let mockNotes = [...MOCK_NOTES];
let mockGroupAssignments = [...MOCK_GROUP_ASSIGNMENTS];
let mockTagAssignments = [...MOCK_TAG_ASSIGNMENTS];

export const workspaceService = {
  scan(force = false): Promise<ScanSnapshot> {
    if (!isTauriRuntime()) return Promise.resolve(mockSnapshot);
    return call<ScanSnapshot>("scan", { force }, { share: !force });
  },

  listAgentCatalog(): Promise<AgentCatalogEntry[]> {
    if (!isTauriRuntime()) return Promise.resolve(MOCK_CATALOG);
    return call<AgentCatalogEntry[]>("list_agent_catalog", undefined, { share: true });
  },

  listSkillInstances(): Promise<SkillInstanceRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockSnapshot.instances);
    return call<SkillInstanceRecord[]>("list_skill_instances", undefined, { share: true });
  },

  listAgentTargets(): Promise<AgentTargetRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockSnapshot.targets);
    return call<AgentTargetRecord[]>("list_agent_targets", undefined, { share: true });
  },

  listDiscoveryRoots(): Promise<DiscoveryRootRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockSnapshot.roots);
    return call<DiscoveryRootRecord[]>("list_discovery_roots", undefined, { share: true });
  },

  addProjectRoot(agentId: string, path: string): Promise<DiscoveryRootRecord> {
    if (!isTauriRuntime()) {
      const record: DiscoveryRootRecord = {
        id: `root-${Date.now()}`,
        agentId,
        scope: "project",
        configuredPath: path,
        canonicalPath: path,
        enabled: true,
        isDefault: false,
        lastWarning: null,
      };
      mockSnapshot = { ...mockSnapshot, roots: [...mockSnapshot.roots, record] };
      return Promise.resolve(record);
    }
    return call<DiscoveryRootRecord>("add_project_root", { agentId, path });
  },

  removeProjectRoot(id: string): Promise<void> {
    if (!isTauriRuntime()) {
      mockSnapshot = { ...mockSnapshot, roots: mockSnapshot.roots.filter((r) => r.id !== id) };
      return Promise.resolve();
    }
    return call<void>("remove_project_root", { id });
  },

  async pickSkillsDirectory(): Promise<string | null> {
    if (!isTauriRuntime()) return "D:\\vibe-projects\\app\\.claude\\skills";
    const selection = await open({
      directory: true,
      multiple: false,
      title: "选择项目的 Skills 目录（如 .claude/skills）",
    });
    if (!selection) return null;
    return Array.isArray(selection) ? selection[0] ?? null : selection;
  },

  listGroups(): Promise<GroupRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockGroups);
    return call<GroupRecord[]>("list_groups", undefined, { share: true });
  },

  upsertGroup(name: string, id?: string): Promise<GroupRecord> {
    if (!isTauriRuntime()) {
      const record: GroupRecord = { id: id ?? `grp-${Date.now()}`, name, skillCount: 0 };
      mockGroups = [...mockGroups.filter((g) => g.id !== record.id), record];
      return Promise.resolve(record);
    }
    return call<GroupRecord>("upsert_group", { draft: { id: id ?? null, name } });
  },

  deleteGroup(id: string): Promise<void> {
    if (!isTauriRuntime()) {
      mockGroups = mockGroups.filter((g) => g.id !== id);
      return Promise.resolve();
    }
    return call<void>("delete_group", { id });
  },

  setSkillGroup(skillPath: string, groupId: string | null): Promise<void> {
    if (!isTauriRuntime()) {
      mockGroupAssignments = mockGroupAssignments.filter((a) => a.skillPath !== skillPath);
      if (groupId) mockGroupAssignments.push({ skillPath, targetId: groupId });
      return Promise.resolve();
    }
    return call<void>("set_skill_group", { skillPath, groupId });
  },

  listGroupAssignments(): Promise<AssignmentRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockGroupAssignments);
    return call<AssignmentRecord[]>("list_skill_group_assignments", undefined, { share: true });
  },

  listTags(): Promise<TagRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockTags);
    return call<TagRecord[]>("list_tags", undefined, { share: true });
  },

  upsertTag(name: string, id?: string): Promise<TagRecord> {
    if (!isTauriRuntime()) {
      const record: TagRecord = { id: id ?? `tag-${Date.now()}`, name, isSystem: false, skillCount: 0 };
      mockTags = [...mockTags.filter((t) => t.id !== record.id), record];
      return Promise.resolve(record);
    }
    return call<TagRecord>("upsert_tag", { draft: { id: id ?? null, name } });
  },

  deleteTag(id: string): Promise<void> {
    if (!isTauriRuntime()) {
      mockTags = mockTags.filter((t) => t.id !== id);
      return Promise.resolve();
    }
    return call<void>("delete_tag", { id });
  },

  setSkillTags(skillPath: string, tagIds: string[]): Promise<void> {
    if (!isTauriRuntime()) {
      mockTagAssignments = mockTagAssignments.filter((a) => a.skillPath !== skillPath);
      for (const tagId of tagIds) mockTagAssignments.push({ skillPath, targetId: tagId });
      return Promise.resolve();
    }
    return call<void>("set_skill_tags", { skillPath, tagIds });
  },

  listTagAssignments(): Promise<AssignmentRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockTagAssignments);
    return call<AssignmentRecord[]>("list_skill_tag_assignments", undefined, { share: true });
  },

  setSkillNote(skillPath: string, note: string): Promise<SkillNoteRecord> {
    if (!isTauriRuntime()) {
      const record: SkillNoteRecord = { skillPath, note, updatedAt: Date.now() };
      mockNotes = [...mockNotes.filter((n) => n.skillPath !== skillPath), record];
      return Promise.resolve(record);
    }
    return call<SkillNoteRecord>("set_skill_note", { skillPath, note });
  },

  listSkillNotes(): Promise<SkillNoteRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockNotes);
    return call<SkillNoteRecord[]>("list_skill_notes", undefined, { share: true });
  },

  linkSkill(skillPath: string, targetRootId: string): Promise<LinkOutcome> {
    if (!isTauriRuntime()) {
      const skillName = skillPath.split(/[\/\\]/).pop() || "Skill";
      const link: LinkRecord = {
        id: `link-${Date.now()}`,
        skillPath,
        skillName,
        targetRootId,
        targetAgentId: "cursor",
        targetRootPath: "C:\\Users\\zhuxuan\\.cursor\\skills",
        linkPath: `C:\\Users\\zhuxuan\\.cursor\\skills\\${skillName}`,
        createdAt: Date.now(),
      };
      mockLinks = [...mockLinks, link];
      return Promise.resolve({ link, created: true });
    }
    return call<LinkOutcome>("link_skill", { skillPath, targetRootId });
  },

  unlinkSkill(linkId: string): Promise<void> {
    if (!isTauriRuntime()) {
      mockLinks = mockLinks.filter((l) => l.id !== linkId);
      return Promise.resolve();
    }
    return call<void>("unlink_skill", { linkId });
  },

  listLinks(): Promise<LinkRecord[]> {
    if (!isTauriRuntime()) return Promise.resolve(mockLinks);
    return call<LinkRecord[]>("list_links", undefined, { share: true });
  },

  incorporateToVault(skillPath: string): Promise<string> {
    if (!isTauriRuntime()) return Promise.resolve(skillPath);
    return call<string>("incorporate_to_vault", { skillPath });
  },

  autoMergeIdentical(): Promise<{ mergedNames: string[]; linksCreated: number }> {
    if (!isTauriRuntime()) return Promise.resolve({ mergedNames: [], linksCreated: 0 });
    return call<{ mergedNames: string[]; linksCreated: number }>("auto_merge_identical");
  },

  manualMergeKeepOne(skillName: string, winnerPath: string): Promise<string> {
    if (!isTauriRuntime()) return Promise.resolve(winnerPath);
    return call<string>("manual_merge_keep_one", { skillName, winnerPath });
  },

  forkSkill(sourcePath: string, newName: string): Promise<string> {
    if (!isTauriRuntime()) return Promise.resolve(sourcePath);
    return call<string>("fork_skill", { sourcePath, newName });
  },
};
