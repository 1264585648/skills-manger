import assert from "node:assert/strict";
import test from "node:test";

import { mapAgentTarget, mapSkillInstance, mergeLibraryAndInstances } from "../src/services/discoveryMappers.ts";
import type { AgentTargetRecord, DiscoveryRootRecord, SkillInstanceRecord } from "../src/types/discovery.ts";
import type { Skill } from "../src/types/domain.ts";

const target: AgentTargetRecord = {
  id: "claude-code", name: "Claude Code", provider: "Anthropic",
  capabilities: ["detect", "read-skills"], detected: true,
  executablePath: "C:/tools/claude.exe", version: null, lastWarning: null, lastScannedAt: 2,
};
const root: DiscoveryRootRecord = {
  id: "root-1", agentId: "claude-code", scope: "project",
  configuredPath: "C:/repo/.claude/skills", canonicalPath: "C:/repo/.claude/skills",
  enabled: true, isDefault: false, lastWarning: null,
};
const instance: SkillInstanceRecord = {
  id: "instance-1", agentId: "claude-code", rootId: "root-1", scope: "project",
  path: "C:/repo/.claude/skills/demo", name: "demo", description: "Discovered demo",
  contentHash: "abc123", scriptCount: 1, state: "unmanaged",
  firstDiscoveredAt: 1, lastDiscoveredAt: 2,
};

test("agent detection maps to ready or setup", () => {
  const ready = mapAgentTarget(target, [instance], [root]);
  assert.equal(ready.status, "ready");
  assert.equal(ready.discoveredSkills, 1);
  assert.deepEqual(ready.scopes, ["project"]);
  const setup = mapAgentTarget({ ...target, detected: false, executablePath: null }, [instance], [root]);
  assert.equal(setup.status, "setup");
});

test("skill instance maps physical path, agent identity, security and state", () => {
  const unmanaged = mapSkillInstance(instance, "Claude Code");
  assert.equal(unmanaged.id, "instance:instance-1");
  assert.equal(unmanaged.sourcePath, instance.path);
  assert.equal(unmanaged.status, "unmanaged");
  assert.equal(unmanaged.source, "Claude Code · Project");
  assert.match(unmanaged.security, /未执行/);
  assert.equal(mapSkillInstance({ ...instance, state: "missing" }).status, "missing");
});

test("merge preserves Library records and resolves the owning adapter", () => {
  const library: Skill[] = [{
    id: "library-1", name: "demo", description: "Canonical copy", source: "本地目录",
    version: "1.0", status: "clean", groups: [], bundles: [], targets: [],
    lastUpdated: "2026-09-08", security: "未发现 scripts/",
  }];
  const merged = mergeLibraryAndInstances(library, [instance], [target]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.id, "library-1");
  assert.equal(merged[1]?.targets[0], "Claude Code");
});
