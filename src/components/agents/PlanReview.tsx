import { ShieldCheck } from "lucide-react";
import type { SyncPlanRecord } from "../../types/bundlePlanner";
import type {
  AgentInstallPlan,
  AgentCenterSnapshot,
} from "../../types/agentCenter";

export function PlanReview({
  plans,
  snapshot,
  reviewed,
  onReviewed,
  requireReview = true,
}: {
  plans: SyncPlanRecord[];
  snapshot?: AgentCenterSnapshot;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  requireReview?: boolean;
}) {
  const enriched = plans as AgentInstallPlan[];
  const items = plans.flatMap((p) => p.items);
  const changes = items.filter((i) => i.action !== "unchanged");
  const dangerous =
    items.some((i) => i.action === "update") ||
    enriched.some((p) => (p.affectedAgents?.length ?? 0) > 1);
  return (
    <section className="ux-plan-review">
      <div className="ux-plan-counts">
        <ShieldCheck size={17} />
        <strong>
          {changes.length ? `${changes.length} 项变更` : "内容已是最新"}
        </strong>
        <span>
          新增 {items.filter((i) => i.action === "add").length} · 覆盖{" "}
          {items.filter((i) => i.action === "update").length}
        </span>
      </div>
      <details
        className={dangerous ? "ux-review-warning" : ""}
        onToggle={(e) => {
          if (!e.currentTarget.open && requireReview) onReviewed(false);
        }}
      >
        <summary>
          {dangerous ? "查看覆盖内容与共享影响" : "查看变更清单"}
        </summary>
        {enriched.map((plan) => (
          <div key={plan.id} className="ux-plan-group">
            {plan.rootPath ? <code>{plan.rootPath}</code> : null}
            {(plan.affectedAgents?.length ?? 0) > 1 ? (
              <p className="ux-warning">
                同时影响：
                {plan.affectedAgents
                  .map(
                    (id) =>
                      snapshot?.catalog.find((a) => a.id === id)?.name ?? id,
                  )
                  .join("、")}
              </p>
            ) : null}
            {plan.items.map((item) => (
              <div className="ux-plan-row" key={item.id}>
                <span>{item.skillName}</span>
                <strong>
                  {item.action === "add"
                    ? "新增"
                    : item.action === "update"
                      ? "备份并覆盖"
                      : item.action === "conflict"
                        ? "待处理"
                        : "无变化"}
                </strong>
                <small>
                  {item.destinationRelative
                    ? `${item.destinationRelative} · `
                    : ""}
                  {item.reason}
                </small>
              </div>
            ))}
          </div>
        ))}
        {dangerous && requireReview ? (
          <label className="ux-review-ack">
            <input
              type="checkbox"
              aria-label="已查看覆盖内容与共享影响"
              checked={reviewed}
              onChange={(e) => onReviewed(e.target.checked)}
            />
            已查看覆盖内容与共享影响
          </label>
        ) : null}
      </details>
    </section>
  );
}
