export type SyncTarget =
  | "claude-code"
  | "codex"
  | "cursor";

export type SyncStatus =
  | "ready"
  | "pending"
  | "conflict"
  | "failed"
  | "completed";

export interface SyncPlanItem {
  skillId: string;
  skillName: string;
  target: SyncTarget;
  status: SyncStatus;
  fromVersion?: string;
  toVersion?: string;
}

export interface SyncPlan {
  createdAt: string;
  items: SyncPlanItem[];
  requiresConfirmation: boolean;
}
