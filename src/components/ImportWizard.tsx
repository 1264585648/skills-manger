import { useEffect, useRef, type KeyboardEvent } from "react";
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const hasConflict = plan.summary.conflict > 0;
  const mutationCount = plan.summary.add + plan.summary.update;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  return (
    <div className="wizard-backdrop" role="presentation">
      <section
        ref={dialogRef}
        aria-labelledby="import-wizard-title"
        aria-modal="true"
        className="import-wizard panel-surface"
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <header className="wizard-header">
          <div>
            <span className="eyebrow">导入预览</span>
            <h2 id="import-wizard-title">添加到技能库</h2>
            <p>先确认变更，再写入受管技能库。原始目录与 Agent 部署位置不会在此步骤被修改，扫描也不会执行第三方脚本。</p>
          </div>
          <button aria-label="关闭导入预览" className="wizard-close" disabled={busy} onClick={onCancel} type="button">×</button>
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
          <div className="wizard-warning">存在未解决冲突。为避免覆盖现有内容，本次预览不会执行写入。</div>
        ) : null}

        <footer className="wizard-footer">
          <span>
            {mutationCount > 0
              ? `确认后将写入技能库中的 ${mutationCount} 个 Skill；不会自动部署。`
              : "当前来源与技能库一致，不需要写入。"}
          </span>
          <div>
            <Button disabled={busy} onClick={onCancel}>取消</Button>
            <Button variant="primary" disabled={busy || hasConflict} onClick={onConfirm}>
              {busy ? "写入中…" : mutationCount > 0 ? "写入技能库" : "完成"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
