import test from "node:test";
import assert from "node:assert/strict";
import { filterSkills, isLibrarySkill, readViewPreferences, suggestTagNames } from "../src/services/skillTagState.ts";
import type { Skill, SkillTag } from "../src/types/domain.ts";

const tags: SkillTag[] = [
  { id: "tag-coding", name: "编码", isSystem: true, skillCount: 1 },
  { id: "tag-review", name: "Review", isSystem: true, skillCount: 1 },
];
const skills = [
  { id: "a", name: "java-testing", description: "Java testing review", source: "Library", tags: ["编码", "Review"], status: "clean" },
  { id: "b", name: "unassigned", description: "", source: "Library", tags: [], status: "clean" },
  { id: "instance:c", name: "external", description: "", source: "Agent", tags: [], status: "unmanaged" },
] as Skill[];

test("tag filtering supports multiple tags and excludes unmanaged items from unassigned", () => {
  assert.deepEqual(filterSkills(skills, tags, { mode: "browse", tagId: "tag-coding", query: "", page: 1 }).map((skill) => skill.id), ["a"]);
  assert.deepEqual(filterSkills(skills, tags, { mode: "organize", tagId: "unassigned", query: "", page: 1 }).map((skill) => skill.id), ["b"]);
  assert.equal(isLibrarySkill(skills[2]), false);
});

test("tag suggestions only return available matching labels", () => {
  assert.deepEqual(suggestTagNames(skills[0], tags), ["编码", "Review"]);
});

test("view preferences reject malformed storage and normalize page", () => {
  assert.deepEqual(readViewPreferences('{"mode":"organize","tagId":"unassigned","query":"java","page":2.9}'), { mode: "organize", tagId: "unassigned", query: "java", page: 2 });
  assert.equal(readViewPreferences("bad-json"), null);
});
