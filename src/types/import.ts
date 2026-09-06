import type { SkillSource } from "./skill-lifecycle";

export type SkillImportAction = "add" | "update" | "skip" | "conflict";

export interface SkillImportCandidate {
  path: string;
  name: string;
  description: string;
  source: SkillSource;
  action: SkillImportAction;
  reason: string;
  contentHash: string;
  existingSkillId?: string;
}

export interface SkillImportSummary {
  add: number;
  update: number;
  skip: number;
  conflict: number;
}

export interface SkillImportPlan {
  createdAt: string;
  candidates: SkillImportCandidate[];
  summary: SkillImportSummary;
  requiresConfirmation: boolean;
}
