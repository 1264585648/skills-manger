export type AgentCapability = "detect" | "install" | "sync" | "verify" | "remove";

export interface AgentAdapter {
  id: string;
  name: string;
  provider: string;
  capabilities: AgentCapability[];
  detected: boolean;
}
