export interface SkillGroupRecord {
  id: string;
  name: string;
  skillIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SkillGroupDraft {
  id: string | null;
  name: string;
}
