import type { SkillInstanceRecord, TagRecord } from "../types/discovery";

/** Keyword heuristics for the four built-in tags, used as one-click suggestions. */
const TAG_PATTERNS: Record<string, RegExp> = {
  编码: /code|java|python|typescript|javascript|sql|backend|test|开发|测试|脚本/i,
  UI: /ui|design|frontend|css|react|vue|figma|界面|设计/i,
  办公: /excel|word|powerpoint|ppt|report|document|office|文档|办公|报告/i,
  Review: /review|audit|qa|quality|评审|审查|审核/i,
};

export const suggestTagNames = (
  skill: Pick<SkillInstanceRecord, "name" | "description">,
  tags: TagRecord[],
): string[] => {
  const text = `${skill.name} ${skill.description}`;
  return Object.entries(TAG_PATTERNS)
    .filter(([name, pattern]) => tags.some((tag) => tag.name === name) && pattern.test(text))
    .map(([name]) => name);
};
