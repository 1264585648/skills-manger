import type { Skill, SkillDeployment } from "../types/domain.ts";
import type {
  AgentTargetRecord,
  DiscoveryRootRecord,
} from "../types/discovery.ts";
import type {
  BundleRecord,
  DeploymentRecord,
} from "../types/bundlePlanner.ts";
import { formatTimestamp } from "./formatTimestamp.ts";

export interface SkillRelationContext {
  bundles: BundleRecord[];
  deployments: DeploymentRecord[];
  roots: DiscoveryRootRecord[];
  targets: AgentTargetRecord[];
}

const unique = (values: string[]): string[] => Array.from(new Set(values));

export const enrichLibrarySkillRelations = (
  skills: Skill[],
  context: SkillRelationContext,
): Skill[] => {
  const rootById = new Map(context.roots.map((root) => [root.id, root]));
  const targetById = new Map(context.targets.map((target) => [target.id, target]));
  const bundlesBySkill = new Map<string, string[]>();
  const deploymentsBySkill = new Map<string, SkillDeployment[]>();

  for (const bundle of context.bundles) {
    for (const item of bundle.items) {
      const names = bundlesBySkill.get(item.skillId) ?? [];
      names.push(bundle.name);
      bundlesBySkill.set(item.skillId, names);
    }
  }

  for (const deployment of context.deployments) {
    const root = rootById.get(deployment.rootId);
    const agentId = root?.agentId ?? "unknown";
    const target = targetById.get(agentId);
    const placement: SkillDeployment = {
      id: deployment.id,
      rootId: deployment.rootId,
      agentId,
      agentName: target?.name ?? (agentId === "unknown" ? "未知 Agent" : agentId),
      scope: root?.scope ?? "unknown",
      rootPath: root?.configuredPath ?? "",
      destinationPath: deployment.destinationPath,
      deployedHash: deployment.deployedHash,
      updatedAt: formatTimestamp(deployment.updatedAt),
    };
    const placements = deploymentsBySkill.get(deployment.skillId) ?? [];
    placements.push(placement);
    deploymentsBySkill.set(deployment.skillId, placements);
  }

  return skills.map((skill) => {
    const deployments = [...(deploymentsBySkill.get(skill.id) ?? [])]
      .sort((left, right) =>
        `${left.agentName}\0${left.rootPath}\0${left.destinationPath}`
          .localeCompare(`${right.agentName}\0${right.rootPath}\0${right.destinationPath}`),
      );
    const bundleNames = unique([
      ...skill.bundles,
      ...(bundlesBySkill.get(skill.id) ?? []),
    ]).sort((left, right) => left.localeCompare(right));
    const deploymentTargets = deployments.map((deployment) => deployment.agentName);

    return {
      ...skill,
      bundles: bundleNames,
      deployments,
      targets: deploymentTargets.length > 0
        ? unique(deploymentTargets)
        : skill.targets,
    };
  });
};
