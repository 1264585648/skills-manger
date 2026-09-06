import type {
  SkillImportCandidate,
  SkillImportPlan,
} from '../types/skill-lifecycle';

/**
 * Build a safe import plan before mutating Canonical Library.
 *
 * Import and sync are intentionally separated:
 * candidate discovery -> plan review -> execution.
 */
export function createSkillImportPlan(
  candidates: SkillImportCandidate[],
): SkillImportPlan {
  const summary = candidates.reduce(
    (result, candidate) => {
      if (candidate.action === 'add') result.add++;
      if (candidate.action === 'update') result.update++;
      if (candidate.action === 'skip') result.skip++;
      if (candidate.action === 'conflict') result.conflict++;
      return result;
    },
    {
      add: 0,
      update: 0,
      skip: 0,
      conflict: 0,
    },
  );

  return {
    createdAt: new Date().toISOString(),
    candidates,
    summary,
    requiresConfirmation: summary.conflict > 0 || summary.update > 0,
  };
}
