export interface Environment {
  id: string;
  name: string;
  description: string;
  agents: string[];
  skills: number;
  updatedAt: string;
}

export interface SkillTrust {
  source: string;
  license?: string;
  risk: string[];
  score?: number;
}
