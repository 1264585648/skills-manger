import test from "node:test";
import assert from "node:assert/strict";
import {
  uniqueSkillCount,
  visibleSkills,
  diagnosticsFor,
} from "../src/types/agentCenter.ts";
import type {
  AgentCenterSnapshot,
  AgentSkill,
} from "../src/types/agentCenter.ts";
const skill = (
  id: string,
  agentId: string,
  resolvedPath: string,
): AgentSkill => ({
  id,
  agentId,
  rootId: agentId,
  path: `${agentId}/demo`,
  resolvedPath,
  name: "demo",
  description: "",
  status: "present",
  linked: true,
  diagnostics: [],
  modifiedAt: null,
});
test("shared physical skills count once while agent associations remain visible", () => {
  const skills = [
    skill("1", "claude-code", "C:\\Shared\\demo"),
    skill("2", "codex", "c:/shared/demo"),
    { ...skill("3", "codex", "C:/deleted"), status: "missing" },
  ];
  assert.equal(uniqueSkillCount(skills), 1);
  const snapshot = { skills } as AgentCenterSnapshot;
  assert.equal(visibleSkills(snapshot).length, 2);
  assert.equal(visibleSkills(snapshot, "codex")[0].id, "2");
});
test("diagnostics stay scoped to their owning agent", () => {
  const problem = {
    code: "broken_link",
    severity: "warning",
    path: "C:/broken",
    message: "broken",
    suggestion: "rescan",
  };
  const snapshot = {
    detections: {},
    roots: [],
    rootDetails: {},
    skills: [
      {
        ...skill("1", "codex", "C:/broken"),
        status: "invalid",
        diagnostics: [problem],
      },
    ],
  } as unknown as AgentCenterSnapshot;
  assert.deepEqual(diagnosticsFor(snapshot, "claude-code"), []);
  assert.deepEqual(diagnosticsFor(snapshot, "codex"), [problem]);
});
