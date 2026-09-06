export type SyncTarget = "claude-code" | "codex" | "cursor";

export type SyncStatus =
  | "ready"
  | "pending"
  | "conflict"
  | "failed"
  | "completed";

export type SyncPlanAction = "add" | "update" | "unchanged" | "conflict";
export type SyncConflictResolution = "library" | "target";

export interface SyncPlanItem {
  id: string;
  skillName: string;
  target: SyncTarget;
  action: SyncPlanAction;
  status: SyncStatus;
  currentVersion: string;
  targetVersion: string;
  reason: string;
}

export interface SyncPlan {
  id: string;
  createdAt: string;
  target: SyncTarget;
  targetLabel: string;
  items: SyncPlanItem[];
  requiresConfirmation: boolean;
}
