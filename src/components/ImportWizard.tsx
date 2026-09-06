import { Button, StatusPill } from "./ui";
import type { SkillImportPlan } from "../types/import";

interface Props {
  plan: SkillImportPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportWizard({ plan, onConfirm, onCancel }: Props) {
  return (
    <div className="import-wizard panel-surface">
      <header>
        <h2>导入 Skill</h2>
        <p>确认导入计划后，Skill 才会进入 Canonical Library。</p>
      </header>

      <div className="import-summary">
        <div><span>新增</span><strong>{plan.summary.add}</strong></div>
        <div><span>更新</span><strong>{plan.summary.update}</strong></div>
        <div><span>跳过</span><strong>{plan.summary.skip}</strong></div>
        <div><span>冲突</span><strong>{plan.summary.conflict}</strong></div>
      </div>

      <div className="import-list">
        {plan.candidates.map((item, index) => (
          <div className="import-item" key={index}>
            <div>
              <strong>{typeof item === "object" && item !== null && "name" in item ? String(item.name) : "Unknown Skill"}</strong>
              <small>{JSON.stringify(item)}</small>
            </div>
            <StatusPill tone="gray">待确认</StatusPill>
          </div>
        ))}
      </div>

      <footer>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="primary" onClick={onConfirm}>确认导入</Button>
      </footer>
    </div>
  );
}
