import type { Skill, SkillTag } from "../types/domain";

export const BUILTIN_TAG_NAMES = ["编码", "UI", "办公", "Review"] as const;
export type SkillsViewMode = "browse" | "organize";

export interface SkillsViewPreferences {
  mode: SkillsViewMode;
  tagId: string;
  query: string;
  page: number;
}

export const isLibrarySkill = (skill: Pick<Skill, "id" | "status">): boolean =>
  !skill.id.startsWith("instance:") && skill.status !== "unmanaged";

export const filterSkills = (
  skills: Skill[],
  tags: SkillTag[],
  preferences: SkillsViewPreferences,
): Skill[] => {
  const tagName = tags.find((tag) => tag.id === preferences.tagId)?.name;
  const normalized = preferences.query.trim().toLowerCase();
  const source = preferences.mode === "organize"
    ? skills.filter((skill) => isLibrarySkill(skill) && skill.tags.length === 0)
    : skills;
  return source.filter((skill) => {
    const matchesTag = preferences.tagId === "all"
      || (preferences.tagId === "unassigned"
        ? isLibrarySkill(skill) && skill.tags.length === 0
        : Boolean(tagName && isLibrarySkill(skill) && skill.tags.includes(tagName)));
    const matchesQuery = !normalized
      || `${skill.name} ${skill.description} ${skill.source} ${skill.sourcePath ?? ""}`
        .toLowerCase()
        .includes(normalized);
    return matchesTag && matchesQuery;
  });
};

export const suggestTagNames = (
  skill: Pick<Skill, "name" | "description" | "source">,
  tags: SkillTag[],
): string[] => {
  const text = `${skill.name} ${skill.description} ${skill.source}`;
  const patterns: Record<string, RegExp> = {
    编码: /code|java|python|typescript|javascript|sql|backend|test|开发|测试/i,
    UI: /ui|design|frontend|css|react|vue|figma|界面|设计/i,
    办公: /excel|word|powerpoint|ppt|report|document|office|文档|办公|报告/i,
    Review: /review|audit|qa|quality|评审|审查|审核/i,
  };
  return Object.entries(patterns)
    .filter(([name, pattern]) => tags.some((tag) => tag.name === name) && pattern.test(text))
    .map(([name]) => name);
};

export const readViewPreferences = (raw: string | null): SkillsViewPreferences | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SkillsViewPreferences>;
    if ((parsed.mode !== "browse" && parsed.mode !== "organize") || typeof parsed.tagId !== "string" || typeof parsed.query !== "string") return null;
    return { mode: parsed.mode, tagId: parsed.tagId, query: parsed.query, page: typeof parsed.page === "number" && parsed.page > 0 ? Math.floor(parsed.page) : 1 };
  } catch {
    return null;
  }
};
