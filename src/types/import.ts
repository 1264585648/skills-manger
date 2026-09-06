export type SkillImportAction =
  | 'add'
  | 'update'
  | 'skip'
  | 'conflict';

export interface SkillImportSummary {
  add: number;
  update: number;
  skip: number;
  conflict: number;
}

export interface SkillImportPlan {
  createdAt: string;
  candidates: unknown[];
  summary: SkillImportSummary;
  requiresConfirmation: boolean;
}
