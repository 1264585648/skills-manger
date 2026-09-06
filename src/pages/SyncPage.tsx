import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, PageHeader, StatusPill } from "../components/ui";
import { createSyncPlan } from "../services/syncPlanService";
import { workspaceService } from "../services/workspaceService";
import type { SyncItem } from "../types/domain";
import type { SyncConflictResolution, SyncPlanAction } from "../types/sync";

const actionMeta: Record<SyncPlanAction, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  add: { label: "新增", tone: "blue" },
  update: { label: "更新", tone: "amber" },
  unchanged: { label: "无变化", tone: "gray" },
  conflict: { label: "冲突", tone: "red" },
};

export function SyncPage() {
  const [items, setItems] = useState<SyncItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolutions, setResolutions] = useState<Record<string, SyncConflictResolution>>({});
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void workspaceService.getSyncItems().then((value) => {
      setItems(value);
      setLoading(false);
    });
  }, []);

  const plan = useMemo(() => createSyncPlan(items, "claude-code"), [items]);
  const conflicts = plan.items.filter((item) => item.action === "conflict");
  const unresolvedConflicts = conflicts.filter((item) => !resolutions[item.id]);
  const mutationCount = plan.items.filter((item) => item.action !== "unchanged").length;
  const canConfirm = !loading && unresolvedConflicts.length === 0 && mutationCount > 0;

  const resolveConflict = (id: string, resolution: SyncConflictResolution) => {
    setConfirmed(false);
    setResolutions((current) => ({ ...current, [id]: resolution }));
  };

  return <section className="page">
    <PageHeader
      title="Sync"
      subtitle="先生成可审查的 Sync Plan；真实 Adapter 写入在下一阶段接入。"
    />

    {confirmed ? (
      <div className="inline-notice notice-success">同步计划已确认，冲突决策已记录到当前会话。</div>
    ) : null}

    <div className="sync-context panel-surface">
      <label><span>目标 Agent</span><button type="button">{plan.targetLabel} <b>⌄</b></button></label>
      <label><span>Bundle</span><button type="button">研发通用工具包 <b>⌄</b></button></label>
      <div className="sync-context-spacer" />
      <StatusPill tone={unresolvedConflicts.length ? "amber" : "green"}>
        {unresolvedConflicts.length ? `${unresolvedConflicts.length} 个冲突待处理` : "Plan Ready"}
      </StatusPill>
      <Button variant="primary" disabled={!canConfirm} onClick={() => setConfirmed(true)}>
        确认计划
      </Button>
    </div>

    <div className="workbench sync-workbench">
      <section className="panel-surface sync-plan">
        <div className="bundle-heading compact">
          <div><span className="eyebrow">Sync Plan</span><h2>这次将影响 {mutationCount} 个 Skill</h2></div>
          <span className="plan-hash">plan · {plan.id}</span>
        </div>

        {loading ? (
          <EmptyState title="正在生成同步计划" body="读取目标状态并计算差异。" />
        ) : (
          <div className="sync-list">
            {plan.items.map((item) => {
              const meta = actionMeta[item.action];
              const resolution = resolutions[item.id];
              return <div className="sync-row" key={item.id}>
                <span className="sync-skill">
                  <i className="skill-glyph">✦</i>
                  <span>
                    <strong>{item.skillName}</strong>
                    <small>
                      {resolution === "library"
                        ? "冲突决策：使用 Library 版本"
                        : resolution === "target"
                          ? "冲突决策：保留目标版本"
                          : item.reason}
                    </small>
                  </span>
                </span>
                <span className="version-flow"><small>{item.currentVersion}</small><b>→</b><small>{item.targetVersion}</small></span>
                <StatusPill tone={resolution ? "green" : meta.tone}>{resolution ? "已解决" : meta.label}</StatusPill>
              </div>;
            })}
          </div>
        )}

        {conflicts.map((conflict) => {
          const resolution = resolutions[conflict.id];
          return (
            <div className="conflict-card" key={`resolver-${conflict.id}`}>
              <div className="conflict-head">
                <span>!</span>
                <div><strong>{conflict.skillName} 需要决策</strong><p>目标副本已发生漂移，管理器不会静默覆盖。</p></div>
              </div>
              <div className="conflict-versions">
                <code>目标：{conflict.currentVersion}</code>
                <code>Library：{conflict.targetVersion}</code>
              </div>
              <div className="resolution-options">
                <button
                  className={resolution === "library" ? "resolution active" : "resolution"}
                  onClick={() => resolveConflict(conflict.id, "library")}
                  type="button"
                ><i />使用 Library 版本</button>
                <button
                  className={resolution === "target" ? "resolution active" : "resolution"}
                  onClick={() => resolveConflict(conflict.id, "target")}
                  type="button"
                ><i />保留目标版本</button>
              </div>
            </div>
          );
        })}

        <div className="sync-steps">
          <span className={unresolvedConflicts.length ? "current" : "done"}>Resolve</span><b>→</b>
          <span className="done">Drift Check</span><b>→</b>
          <span>Snapshot</span><b>→</b><span>Apply</span><b>→</b><span>Verify</span>
        </div>
      </section>

      <aside className="panel-surface inspector">
        <div className="inspector-title simple"><div><h2>同步摘要</h2><p>Planner 已把变更和冲突显式化。</p></div></div>
        <dl className="detail-list spacious">
          <div><dt>目标</dt><dd>{plan.targetLabel}</dd></div>
          <div><dt>计划</dt><dd>{plan.id}</dd></div>
          <div><dt>变更</dt><dd>{mutationCount}</dd></div>
          <div><dt>冲突</dt><dd>{unresolvedConflicts.length}</dd></div>
        </dl>
        <div className="verify-box">
          <span className="section-label">执行边界</span>
          <p>✓ Planner 不直接覆盖目标目录</p>
          <p>✓ 冲突必须显式决策</p>
          <p>○ Snapshot / Apply / Verify 由 M3 Adapter 接入</p>
        </div>
        <div className="inspector-actions">
          <Button variant="primary" disabled={!canConfirm} onClick={() => setConfirmed(true)}>确认当前计划</Button>
          <Button disabled>执行 Adapter 写入</Button>
        </div>
      </aside>
    </div>
  </section>;
}
