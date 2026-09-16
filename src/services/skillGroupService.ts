import { invoke } from "@tauri-apps/api/core";
import { mockSkills } from "../data/mock";
import type { Skill } from "../types/domain";
import type { SkillGroupDraft, SkillGroupRecord } from "../types/skillGroups";

const copy = <T,>(value: T): T => structuredClone(value);

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const formatCommandError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "操作失败";
};

const isDiscoverySkill = (skill: Skill): boolean =>
  skill.id.startsWith("instance:") || skill.status === "unmanaged";

const buildMockGroups = (): SkillGroupRecord[] => {
  const librarySkills = mockSkills.filter((skill) => !isDiscoverySkill(skill));
  const names = Array.from(new Set(librarySkills.flatMap((skill) => skill.groups)))
    .sort((left, right) => left.localeCompare(right));
  return names.map((name, index) => ({
    id: `mock-group-${index + 1}`,
    name,
    skillIds: librarySkills
      .filter((skill) => skill.groups.includes(name))
      .map((skill) => skill.id),
    createdAt: index + 1,
    updatedAt: index + 1,
  }));
};

let browserGroups = buildMockGroups();
let browserSequence = browserGroups.length + 1;

const sortGroups = (groups: SkillGroupRecord[]): SkillGroupRecord[] =>
  [...groups].sort((left, right) => left.name.localeCompare(right.name));

export const applySkillGroups = (
  skills: Skill[],
  groups: SkillGroupRecord[],
): Skill[] => {
  const namesBySkill = new Map<string, string[]>();
  for (const group of groups) {
    for (const skillId of group.skillIds) {
      const names = namesBySkill.get(skillId) ?? [];
      names.push(group.name);
      namesBySkill.set(skillId, names);
    }
  }

  return skills.map((skill) => isDiscoverySkill(skill)
    ? { ...skill, groups: [] }
    : {
      ...skill,
      groups: [...(namesBySkill.get(skill.id) ?? [])]
        .sort((left, right) => left.localeCompare(right)),
    });
};

export const skillGroupService = {
  async getGroups(): Promise<SkillGroupRecord[]> {
    if (!isTauriRuntime()) return copy(sortGroups(browserGroups));
    try {
      return await invoke<SkillGroupRecord[]>("list_skill_groups");
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async saveGroup(draft: SkillGroupDraft): Promise<SkillGroupRecord> {
    if (!isTauriRuntime()) {
      const name = draft.name.trim();
      if (!name) throw new Error("分组名称不能为空");
      const duplicate = browserGroups.some((group) =>
        group.id !== draft.id && group.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
      );
      if (duplicate) throw new Error("分组名称已存在");

      const timestamp = Math.floor(Date.now() / 1000);
      if (draft.id) {
        const current = browserGroups.find((group) => group.id === draft.id);
        if (!current) throw new Error("未找到要更新的分组");
        const updated = { ...current, name, updatedAt: timestamp };
        browserGroups = browserGroups.map((group) => group.id === updated.id ? updated : group);
        return copy(updated);
      }

      const created: SkillGroupRecord = {
        id: `mock-group-${browserSequence++}`,
        name,
        skillIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      browserGroups = sortGroups([...browserGroups, created]);
      return copy(created);
    }

    try {
      return await invoke<SkillGroupRecord>("upsert_skill_group", { draft });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async deleteGroup(id: string): Promise<void> {
    if (!isTauriRuntime()) {
      const exists = browserGroups.some((group) => group.id === id);
      if (!exists) throw new Error("未找到要删除的分组");
      browserGroups = browserGroups.filter((group) => group.id !== id);
      return;
    }

    try {
      await invoke("delete_skill_group", { id });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },

  async setSkillGroups(skillId: string, groupIds: string[]): Promise<SkillGroupRecord[]> {
    if (!isTauriRuntime()) {
      const selected = new Set(groupIds);
      const knownIds = new Set(browserGroups.map((group) => group.id));
      for (const groupId of selected) {
        if (!knownIds.has(groupId)) throw new Error(`未找到分组：${groupId}`);
      }
      const timestamp = Math.floor(Date.now() / 1000);
      browserGroups = browserGroups.map((group) => {
        const contains = group.skillIds.includes(skillId);
        const shouldContain = selected.has(group.id);
        if (contains === shouldContain) return group;
        return {
          ...group,
          skillIds: shouldContain
            ? [...group.skillIds, skillId]
            : group.skillIds.filter((id) => id !== skillId),
          updatedAt: timestamp,
        };
      });
      return copy(sortGroups(browserGroups));
    }

    try {
      return await invoke<SkillGroupRecord[]>("set_skill_groups", { skillId, groupIds });
    } catch (error) {
      throw new Error(formatCommandError(error));
    }
  },
};
