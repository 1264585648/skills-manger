import type { AgentDetector, AgentDiscoveryResult } from "./detector";
import type { AgentAdapter } from "../types/adapter";

const adapter: AgentAdapter = {
  id: "claude-code",
  name: "Claude Code",
  provider: "Anthropic",
  capabilities: ["detect", "install", "sync", "verify"],
  detected: false,
};

export class ClaudeCodeDetector implements AgentDetector {
  async detect(): Promise<AgentDiscoveryResult> {
    // M3 first stage: only discovery contract is introduced.
    // Real filesystem probing will be added behind this boundary.
    return {
      adapter,
      available: false,
      instances: [],
    };
  }
}
