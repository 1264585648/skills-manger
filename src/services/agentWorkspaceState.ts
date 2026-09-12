import type {
  AgentCenterSnapshot,
  AgentPreferences,
  ManagedSkill,
} from "../types/agentCenter";

export const scopeKey = (agentId: string, scopeId: string) =>
  `${agentId}:${scopeId}`;
export function initialAgent(
  snapshot: AgentCenterSnapshot,
  prefs: AgentPreferences,
  requested?: string,
): string {
  if (requested) return requested;
  if (prefs.lastAgentId) return prefs.lastAgentId;
  return (
    snapshot.catalog.find(
      (a) => snapshot.detections[a.id]?.status === "installed",
    )?.id ??
    snapshot.catalog.find((a) =>
      snapshot.roots.some((r) => r.agentId === a.id && r.canonicalPath),
    )?.id ??
    snapshot.catalog[0]?.id ??
    "claude-code"
  );
}
export function filterSkills(
  skills: ManagedSkill[],
  query: string,
  filter: string,
  sort: string,
): ManagedSkill[] {
  return skills
    .filter(
      (s) =>
        `${s.name} ${s.description}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "update" && s.canUpdate) ||
          (filter === "issues" &&
            (s.state === "issue" || s.state === "unverified"))),
    )
    .sort((a, b) =>
      sort === "recent"
        ? (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) ||
          a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name, "zh-CN"),
    );
}
export interface SessionView {
  query: string;
  filter: string;
  scroll: number;
}
const sessions = new Map<string, SessionView>();
export const sessionView = (key: string): SessionView =>
  sessions.get(key) ?? { query: "", filter: "all", scroll: 0 };
export const rememberSession = (key: string, value: SessionView) =>
  sessions.set(key, value);

export class LatestRequest {
  private sequence = 0;
  next(): number {
    return ++this.sequence;
  }
  current(id: number): boolean {
    return id === this.sequence;
  }
  invalidate(): void {
    this.sequence++;
  }
}
