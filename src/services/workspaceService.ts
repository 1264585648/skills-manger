import { mockAgents, mockBundles, mockSkills, mockSources, mockSyncItems } from "../data/mock";
import type { Agent, Bundle, Skill, SourceConfig, SyncItem } from "../types/domain";

const copy = <T,>(value: T): T => structuredClone(value);

export const workspaceService = {
  async getSkills(): Promise<Skill[]> { return copy(mockSkills); },
  async getBundles(): Promise<Bundle[]> { return copy(mockBundles); },
  async getAgents(): Promise<Agent[]> { return copy(mockAgents); },
  async getSyncItems(): Promise<SyncItem[]> { return copy(mockSyncItems); },
  async getSources(): Promise<SourceConfig[]> { return copy(mockSources); },
};
