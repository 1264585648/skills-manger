export type BundleItemMode = "required" | "optional";
export type PlannerAction = "add" | "update" | "unchanged" | "conflict";

export interface BundleItemRecord {
  skillId: string;
  mode: BundleItemMode;
  position: number;
}

export interface BundleRecord {
  id: string;
  name: string;
  description: string;
  items: BundleItemRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface BundleDraft {
  id: string | null;
  name: string;
  description: string;
  items: Array<{ skillId: string; mode: BundleItemMode }>;
}

export interface SyncPlanItemRecord {
  id: string;
  skillId: string;
  skillName: string;
  mode: BundleItemMode;
  action: PlannerAction;
  currentHash: string | null;
  libraryHash: string;
  reason: string;
  destinationRelative?: string | null;
}

export interface SyncPlanRecord {
  id: string;
  bundleId: string;
  rootId: string;
  items: SyncPlanItemRecord[];
  warnings: string[];
  requiresConfirmation: boolean;
}

export interface ApplyOperationItemRecord {
  skillId: string;
  action: "add" | "update";
  destinationPath: string;
  status: "pending" | "applied" | "rolled_back" | "failed";
  snapshotPath: string | null;
  deployedHash: string | null;
  error: string | null;
  position: number;
}

export interface ApplyOperationRecord {
  id: string;
  planId: string;
  status: "running" | "succeeded" | "rolled_back" | "rollback_failed";
  canRestore?: boolean;
  backupState?: "available" | "missing" | "not-needed";
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  items: ApplyOperationItemRecord[];
}

export interface DeploymentRecord {
  id: string;
  skillId: string;
  rootId: string;
  destinationPath: string;
  deployedHash: string;
  createdAt: number;
  updatedAt: number;
}
