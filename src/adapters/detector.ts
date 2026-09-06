import type { AgentAdapter } from "../types/adapter";

export interface SkillInstance {
  agentId: string;
  path: string;
  scope: "user" | "project" | "unknown";
  managed: boolean;
  skillName?: string;
}

export interface AgentDiscoveryResult {
  adapter: AgentAdapter;
  available: boolean;
  instances: SkillInstance[];
}

export interface AgentDetector {
  detect(): Promise<AgentDiscoveryResult>;
}
