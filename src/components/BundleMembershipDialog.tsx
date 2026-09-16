import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Skill } from "../types/domain";
import type { BundleRecord } from "../types/bundlePlanner";
import { Button, EmptyState } from "./ui";

interface Props {
  skill: Skill;
  bundles: BundleRecord[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (bundleIds: string[]) => void;
}

export function BundleMembershipDialog({
  skill,
  bundles,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialIds = useMemo(
    () => bundles
      .filter((bundle) => bundle.items.some((item) => item.skillId === skill.id))
      .map((bundle) => bundle.id),
    [bundles, skill.id],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const toggleBundle = (bundleId: string): void => {
    setSelectedIds((current) => current.includes(bundleId)
      ? current.filter((id) => id !== bundleId)
      : [...current, bundleId]);
  };

  const changedCount = bundles.filter((bundle) => {
    const wasSelected = initialIds.includes(bundle.id);
    const isSelected = selectedIds.includes(bundle.id);
    return wasSelected !== isSelected;
  }).length;

  return (
    <div className="wizard-backdrop" role="presentation">
      <section
        ref={dialogRef}
        aria-describedby="bundle-membership-help"
        aria-labelledby="bundle-membership-title"
        aria-modal="true"
        className="bundle-membership-dialog panel-surface"
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <header className="wizard-header">
          <div>
            <span className="eyebrow">组合关系</span>
            <h2 id="bundle-membership-title">管理所属组合</h2>
            <p id="bundle-membership-help">
              为 <strong>{skill.name}</strong> 选择 Bundle。这里仅修改组合定义，不会立即写入任何 Agent。
            </p>
          </div>
          <button
            aria-label="关闭组合关系编辑"
            className="wizard-close"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >×</button>
        </header>

        <div className="bundle-membership-list">
          {bundles.length === 0 ? (
            <EmptyState
              title="还没有 Bundle"
              body="请先在 Bundles 页面创建组合，再把 Skill 加入其中。"
            />
          ) : bundles.map((bundle) => {
            const checked = selectedIds.includes(bundle.id);
            const isOnlyItem = bundle.items.length === 1
              && bundle.items[0]?.skillId === skill.id;
            return (
              <label className={isOnlyItem ? "bundle-membership-item locked" : "bundle-membership-item"} key={bundle.id}>
                <input
                  checked={checked}
                  disabled={busy || (checked && isOnlyItem)}
                  onChange={() => toggleBundle(bundle.id)}
                  type="checkbox"
                />
                <span>
                  <strong>{bundle.name}</strong>
                  <small>{bundle.description || `${bundle.items.length} 个 Skill`}</small>
                </span>
                <em>
                  {isOnlyItem
                    ? "至少保留 1 个 Skill"
                    : checked ? "已加入" : `${bundle.items.length} 个 Skill`}
                </em>
              </label>
            );
          })}
        </div>

        <footer className="wizard-footer">
          <span>
            {changedCount > 0
              ? `将更新 ${changedCount} 个 Bundle；部署位置保持不变。`
              : "组合关系没有变化。"}
          </span>
          <div>
            <Button disabled={busy} onClick={onCancel}>取消</Button>
            <Button
              variant="primary"
              disabled={busy || bundles.length === 0 || changedCount === 0}
              onClick={() => onConfirm(selectedIds)}
            >
              {busy ? "保存中…" : "保存组合关系"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
