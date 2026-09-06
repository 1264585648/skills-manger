import type { SyncItem } from "../types/domain";
import type { SyncPlan, SyncPlanItem, SyncTarget } from "../types/sync";

const targetLabels: Record<SyncTarget, string> = {
  "claude-code": "Claude Code · User",
  codex: "Codex · User",
  cursor: "Cursor · User",
};

const compactHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
};

export function createSyncPlan(
  items: SyncItem[],
  target: SyncTarget = "claude-code",
): SyncPlan {
  const planItems: SyncPlanItem[] = items.map((item) => ({
    id: item.id,
    skillName: item.skillName,
    target,
    action: item.action,
    status:
      item.action === "conflict"
        ? "conflict"
        : item.action === "unchanged"
          ? "completed"
          : "pending",
    currentVersion: item.current,
    targetVersion: item.target,
    reason: item.reason,
  }));

  const signature = planItems
    .map((item) => `${item.id}:${item.action}:${item.currentVersion}:${item.targetVersion}`)
    .join("|");

  return {
    id: compactHash(signature),
    createdAt: new Date().toISOString(),
    target,
    targetLabel: targetLabels[target],
    items: planItems,
    requiresConfirmation: planItems.some((item) => item.action !== "unchanged"),
  };
}
