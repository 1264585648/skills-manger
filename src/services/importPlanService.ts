import type { SkillImportCandidate, SkillImportPlan } from "../types/import";

/**
 * Build a safe import plan before mutating Canonical Library.
 * Discovery and adoption are deliberately separated.
 */
export function createSkillImportPlan(
  candidates: SkillImportCandidate[],
): SkillImportPlan {
  const summary = candidates.reduce(
    (result, candidate) => {
      result[candidate.action] += 1;
      return result;
    },
    { add: 0, update: 0, skip: 0, conflict: 0 },
  );

  return {
    createdAt: new Date().toISOString(),
    candidates,
    summary,
    requiresConfirmation: summary.add > 0 || summary.update > 0 || summary.conflict > 0,
  };
}
