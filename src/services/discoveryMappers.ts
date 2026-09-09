import type { Agent, Skill } from "../types/domain.ts";
import type {
  AgentTargetRecord,
  DiscoveryRootRecord,
  SkillInstanceRecord,
} from "../types/discovery.ts";
import { formatTimestamp } from "./formatTimestamp.ts";

export const mapAgentTarget = (
  record: AgentTargetRecord,
  instances: SkillInstanceRecord[],
  roots: DiscoveryRootRecord[],
): Agent => ({
  id: record.id,
  name: record.name,
  type: record.provider,
  status: record.detected ? "ready" : "setup",
  version: record.version ?? "未知",
  path: record.executablePath ?? "未检测到可执行文件",
  scopes: Array.from(
    new Set(
      roots
        .filter((root) => root.agentId === record.id && root.enabled)
        .map((root) => root.scope),
    ),
  ),
  capabilities: record.capabilities,
  discoveredSkills: instances.filter(
    (instance) => instance.agentId === record.id && instance.state === "unmanaged",
  ).length,
  warning: record.lastWarning ?? undefined,
  lastScannedAt: record.lastScannedAt ?? undefined,
});

export const mapSkillInstance = (
  record: SkillInstanceRecord,
  agentName = "Agent",
): Skill => ({
  id: `instance:${record.id}`,
  name: record.name,
  description: record.description,
  source: `${agentName} · ${record.scope === "user" ? "User" : "Project"}`,
  sourcePath: record.path,
  contentHash: record.contentHash,
  version: "—",
  status: record.state,
  groups: [],
  bundles: [],
  targets: [agentName],
  lastUpdated: formatTimestamp(record.lastDiscoveredAt),
  security:
    record.scriptCount > 0
      ? `包含 scripts/ · ${record.scriptCount} 个文件 · 未执行`
      : "未发现 scripts/",
});

export const mergeLibraryAndInstances = (
  librarySkills: Skill[],
  instances: SkillInstanceRecord[],
  targets: AgentTargetRecord[] = [],
): Skill[] => [
  ...librarySkills,
  ...instances.map((instance) =>
    mapSkillInstance(
      instance,
      targets.find((target) => target.id === instance.agentId)?.name ?? "Agent",
    ),
  ),
];
