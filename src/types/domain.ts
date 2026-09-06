export type PageKey = "home" | "skills" | "bundles" | "agents" | "sync" | "settings";

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

export type SkillStatus = "clean" | "update" | "unmanaged" | "conflict" | "missing";

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: string;
  sourcePath?: string;
  libraryPath?: string;
  contentHash?: string;
  version: string;
  status: SkillStatus;
  groups: string[];
  bundles: string[];
  targets: string[];
  lastUpdated: string;
  security: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
}

export interface Bundle {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  targets: string[];
  updatedAt: string;
  conflict?: string;
}

export type AgentStatus = "ready" | "limited" | "setup" | "error";

export interface Agent {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  version: string;
  path: string;
  scopes: string[];
  capabilities: string[];
  discoveredSkills: number;
}

export type SyncAction = "add" | "update" | "unchanged" | "conflict";

export interface SyncItem {
  id: string;
  skillName: string;
  action: SyncAction;
  current: string;
  target: string;
  reason: string;
}

export interface SourceConfig {
  id: string;
  name: string;
  description: string;
  detail: string;
  enabled: boolean;
}
