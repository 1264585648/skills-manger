import assert from "node:assert/strict";
import test from "node:test";

import { applySkillGroups } from "../src/services/skillGroupService.ts";
import type { Skill } from "../src/types/domain.ts";
import type { SkillGroupRecord } from "../src/types/skillGroups.ts";

const librarySkill: Skill = {
  id: "skill-1",
  name: "demo",
  description: "Demo",
  source: "本地目录",
  version: "—",
  status: "clean",
  groups: ["旧值"],
  bundles: [],
  targets: [],
  lastUpdated: "今天",
  security: "未发现 scripts/",
};

const discoverySkill: Skill = {
  ...librarySkill,
  id: "instance:discovery-1",
  status: "unmanaged",
  groups: [],
};

const groups: SkillGroupRecord[] = [
  {
    id: "group-2",
    name: "研发效率",
    skillIds: ["skill-1"],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "group-1",
    name: "代码质量",
    skillIds: ["skill-1"],
    createdAt: 1,
    updatedAt: 1,
  },
];

test("projects persisted group membership onto Library Skills", () => {
  const [mapped] = applySkillGroups([librarySkill], groups);
  assert.deepEqual(mapped?.groups, ["代码质量", "研发效率"]);
});

test("does not assign Library groups to discovery instances", () => {
  const [mapped] = applySkillGroups([discoverySkill], groups);
  assert.deepEqual(mapped?.groups, []);
});
