export type DiscoveryScope = "user" | "project";
export type SkillInstanceState = "unmanaged" | "missing";

export interface AgentTargetRecord {
  id: string;
  name: string;
  provider: string;
  detected: boolean;
  /** 强信号：PATH 里找到了可执行文件（真的装了）。detected 只代表目录存在。 */
  installed: boolean;
  executablePath: string | null;
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

export interface ScanSnapshot {
  targets: AgentTargetRecord[];
  roots: DiscoveryRootRecord[];
  instances: SkillInstanceRecord[];
  warnings: string[];
}

export interface GroupRecord {
  id: string;
  name: string;
  skillCount: number;
}

export interface TagRecord {
  id: string;
  name: string;
  isSystem: boolean;
  skillCount: number;
}

export interface SkillNoteRecord {
  skillPath: string;
  note: string;
  updatedAt: number;
}

export interface LinkRecord {
  id: string;
  skillPath: string;
  skillName: string;
  targetRootId: string;
  targetAgentId: string;
  targetRootPath: string;
  linkPath: string;
  createdAt: number;
}

export interface LinkOutcome {
  link: LinkRecord;
  created: boolean;
}
