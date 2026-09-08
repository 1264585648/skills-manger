export type DiscoveryScope = "user" | "project";
export type SkillInstanceState = "unmanaged" | "missing";

export interface AgentTargetRecord {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  detected: boolean;
  executablePath: string | null;
  version: string | null;
  lastWarning: string | null;
  lastScannedAt: number | null;
}

export interface DiscoveryRootRecord {
  id: string;
  agentId: string;
  scope: DiscoveryScope;
  configuredPath: string;
  canonicalPath: string | null;
  enabled: boolean;
  isDefault: boolean;
  lastWarning: string | null;
}

export interface SkillInstanceRecord {
  id: string;
  agentId: string;
  rootId: string;
  scope: DiscoveryScope;
  path: string;
  name: string;
  description: string;
  contentHash: string;
  scriptCount: number;
  state: SkillInstanceState;
  firstDiscoveredAt: number;
  lastDiscoveredAt: number;
}

export interface AgentDiscoverySnapshot {
  target: AgentTargetRecord;
  roots: DiscoveryRootRecord[];
  instances: SkillInstanceRecord[];
  warnings: string[];
}
