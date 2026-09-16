import assert from "node:assert/strict";
import test from "node:test";

import { enrichLibrarySkillRelations } from "../src/services/skillRelations.ts";
import type { Skill } from "../src/types/domain.ts";
import type { AgentTargetRecord, DiscoveryRootRecord } from "../src/types/discovery.ts";
import type { BundleRecord, DeploymentRecord } from "../src/types/bundlePlanner.ts";
import type { SkillGroupRecord } from "../src/types/skillGroups.ts";

const skill: Skill = {
  id: "skill-1",
  name: "demo-skill",
  description: "Demo",
  source: "本地目录",
  version: "1.0.0",
  status: "clean",
  groups: [],
  bundles: [],
  targets: [],
  lastUpdated: "2026-09-16",
  security: "未发现 scripts/",
  contentHash: "hash-current",
};

const groups: SkillGroupRecord[] = [
  {
    id: "group-b",
    name: "研发效率",
    skillIds: ["skill-1"],
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: "group-a",
    name: "代码质量",
    skillIds: ["skill-1"],
    createdAt: 1,
    updatedAt: 3,
  },
];

const bundles: BundleRecord[] = [
  {
    id: "bundle-b",
    name: "后端开发",
    description: "Backend",
    items: [{ skillId: "skill-1", mode: "required", position: 0 }],
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: "bundle-a",
    name: "研发通用",
    description: "Common",
    items: [{ skillId: "skill-1", mode: "optional", position: 1 }],
    createdAt: 1,
    updatedAt: 3,
  },
];

const root: DiscoveryRootRecord = {
  id: "root-1",
  agentId: "claude-code",
  scope: "project",
  configuredPath: "C:/repo/.claude/skills",
  canonicalPath: "C:/repo/.claude/skills",
  enabled: true,
  isDefault: false,
  lastWarning: null,
};

const target: AgentTargetRecord = {
  id: "claude-code",
  name: "Claude Code",
  provider: "Anthropic",
  capabilities: ["detect", "write-skills"],
  detected: true,
  executablePath: "C:/tools/claude.exe",
  version: "2.1.3",
  lastWarning: null,
  lastScannedAt: 10,
};

const deployment: DeploymentRecord = {
  id: "deployment-1",
  skillId: "skill-1",
  rootId: "root-1",
  destinationPath: "C:/repo/.claude/skills/demo-skill",
  deployedHash: "hash-current",
  createdAt: 10,
  updatedAt: 20,
};

test("enriches Library Skills with persisted groups, Bundles and deployments", () => {
  const [enriched] = enrichLibrarySkillRelations([skill], {
    groups,
    bundles,
    deployments: [deployment],
    roots: [root],
    targets: [target],
  });

  assert.deepEqual(enriched?.groups, ["代码质量", "研发效率"]);
  assert.deepEqual(enriched?.bundles, ["后端开发", "研发通用"]);
  assert.deepEqual(enriched?.targets, ["Claude Code"]);
  assert.equal(enriched?.deployments?.length, 1);
  assert.equal(enriched?.deployments?.[0]?.agentName, "Claude Code");
  assert.equal(enriched?.deployments?.[0]?.scope, "project");
  assert.equal(enriched?.deployments?.[0]?.rootPath, root.configuredPath);
  assert.equal(enriched?.deployments?.[0]?.destinationPath, deployment.destinationPath);
  assert.notEqual(enriched?.deployments?.[0]?.updatedAt, "—");
});

test("keeps a deployment visible when its Agent metadata is incomplete", () => {
  const [enriched] = enrichLibrarySkillRelations([skill], {
    groups: [],
    bundles: [],
    deployments: [deployment],
    roots: [],
    targets: [],
  });

  assert.equal(enriched?.deployments?.[0]?.agentName, "未知 Agent");
  assert.equal(enriched?.deployments?.[0]?.scope, "unknown");
  assert.deepEqual(enriched?.targets, ["未知 Agent"]);
});
