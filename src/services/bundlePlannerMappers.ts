import type { Bundle, SyncItem } from "../types/domain.ts";
import type { BundleRecord, SyncPlanRecord } from "../types/bundlePlanner.ts";
import { formatTimestamp } from "./formatTimestamp.ts";

export const mapBundleRecord = (record: BundleRecord): Bundle => ({
  id: record.id,
  name: record.name,
  description: record.description,
  skillIds: [...record.items]
    .sort((left, right) => left.position - right.position)
    .map((item) => item.skillId),
  targets: ["Claude Code"],
  updatedAt: formatTimestamp(record.updatedAt),
});

export const mapSyncPlanItems = (plan: SyncPlanRecord): SyncItem[] =>
  plan.items.map((item) => ({
    id: item.id,
    skillName: item.skillName,
    action: item.action,
    current: item.currentHash ?? "—",
    target: item.libraryHash,
    reason: item.reason,
  }));
