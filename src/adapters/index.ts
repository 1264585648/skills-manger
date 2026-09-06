import type { AgentAdapter } from "../types/adapter";
import { ClaudeCodeDetector } from "./claude-code";

export const agentAdapters: AgentAdapter[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    provider: "Anthropic",
    capabilities: ["detect", "install", "sync", "verify"],
    detected: false,
  },
  {
    id: "cursor",
    name: "Cursor",
    provider: "Cursor",
    capabilities: ["detect", "install"],
    detected: false,
  },
];

export const agentDetectors = {
  "claude-code": new ClaudeCodeDetector(),
};
