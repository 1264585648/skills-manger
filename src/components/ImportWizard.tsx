import { Button, StatusPill } from "./ui";
import type { SkillImportAction, SkillImportPlan } from "../types/import";

interface Props {
  plan: SkillImportPlan;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const actionMeta: Record<
  SkillImportAction,
  { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }
> = {
  add: { label: "新增", tone: "blue" },
  update: { label: "更新", tone: "amber" },
  skip: { label: "无变化", tone: "gray" },
  conflict: { label: "冲突", tone: "red" },
};

export function ImportWizard({ plan, busy = false, onConfirm, onCancel }: Props) {
  const hasConflict = plan.summary.conflict > 0;
  const mutationCount = plan.summary.add + plan.summary.update;

  return (
    <div className="wizard-backdrop" role="presentation">
      <section
        aria-labelledby="import-wizard-title"
        aria-modal="true"
        className="import-wizard panel-surface"
        role="dialog"
      >
        <header className="wizard-header">
          <div>
            <span className="eyebrow">Import Plan</span>
            <h2 id="import-wizard-title">导入 Skill</h2>
            <p>先确认计划，再写入 Canonical Library。扫描阶段不会执行第三方脚本。</p>
          </div>
          <button aria-label="关闭导入向导" className="wizard-close" disabled={busy} onClick={onCancel} type="button">×</button>
        </header>

        <div className="import-summary">
          <div><span>新增</span><strong>{plan.summary.add}</strong></div>
          <div><span>更新</span><strong>{plan.summary.update}</strong></div>
          <div><span>无变化</span><strong>{plan.summary.skip}</strong></div>
          <div><span>冲突</span><strong>{plan.summary.conflict}</strong></div>
        </div>

        <div className="import-list">
          {plan.candidates.map((item) => {
            const meta = actionMeta[item.action];
            return (
              <article className="import-item" key={`${item.path}:${item.contentHash}`}>
                <div className="import-item-main">
                  <div className="import-item-title">
                    <i className="skill-glyph">✦</i>
                    <div><strong>{item.name}</strong><small>{item.description}</small></div>
                  </div>
                  <p>{item.reason}</p>
                  <code title={item.path}>{item.path}</code>
                </div>
                <div className="import-item-meta">
                  <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  <span title={item.contentHash}>{item.contentHash.slice(0, 12)}</span>
                </div>
              </article>
            );
          })}
        </div>

        {hasConflict ? (
          <div className="wizard-warning">存在未解决冲突，本次计划不会执行写入。</div>
        ) : null}

        <footer className="wizard-footer">
          <span>
            {mutationCount > 0
              ? `确认后将写入 ${mutationCount} 个 Skill。`
              : "当前来源与 Library 一致，不需要写入。"}
          </span>
          <div>
            <Button disabled={busy} onClick={onCancel}>取消</Button>
            <Button variant="primary" disabled={busy || hasConflict} onClick={onConfirm}>
              {busy ? "执行中…" : mutationCount > 0 ? "确认导入" : "完成"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
