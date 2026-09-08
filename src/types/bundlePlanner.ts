export type BundleItemMode = "required" | "optional";
export type PlannerAction = "add" | "unchanged" | "conflict";

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
}

export interface SyncPlanRecord {
  id: string;
  bundleId: string;
  rootId: string;
  items: SyncPlanItemRecord[];
  warnings: string[];
  requiresConfirmation: boolean;
}
