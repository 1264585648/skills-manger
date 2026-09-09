import { useState } from "react";
import { StatusPill } from "./ui";
import {
  classifyConflict,
  conflictKindMeta,
  joinDestinationPath,
} from "../services/conflictRules";
import type { SyncPlanItemRecord } from "../types/bundlePlanner";

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

interface ConflictResolverProps {
  items: SyncPlanItemRecord[];
  rootPath: string;
  busySkillId: string | null;
  onExclude: (item: SyncPlanItemRecord) => void;
  onOpenDirectory: (item: SyncPlanItemRecord) => void;
}

export function ConflictResolver({
  items,
  rootPath,
  busySkillId,
  onExclude,
  onOpenDirectory,
}: ConflictResolverProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);

  const copy = async (id: string, path: string): Promise<void> => {
    const ok = await copyText(path);
    setCopiedId(ok ? id : null);
    setCopyFailedId(ok ? null : id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
      setCopyFailedId((current) => (current === id ? null : current));
    }, 1800);
  };

  return (
    <div className="conflict-card">
      <div className="conflict-head">
        <span>!</span>
        <div>
          <strong>{items.length} 个 Skill 需要人工处置</strong>
          <p>
            这些目标不是本应用部署，或部署后已被外部修改。安全策略禁止自动覆盖——逐项处置后重新生成计划即可继续。
          </p>
        </div>
      </div>

      <div className="conflict-list">
        {items.map((item) => {
          const meta = conflictKindMeta[classifyConflict(item.reason)];
          const destination = joinDestinationPath(rootPath, item.skillName);
          const busy = busySkillId === item.skillId;
          return (
            <article className="conflict-item" key={item.id}>
              <div className="conflict-item-head">
                <strong>{item.skillName}</strong>
                <StatusPill tone="red">{meta.label}</StatusPill>
              </div>
              <p className="conflict-reason">{item.reason}</p>
              <p className="conflict-hint">{meta.hint}</p>
              <code className="conflict-path" title={destination}>
                {destination}
              </code>
              {item.currentHash ? (
                <p className="conflict-hash">
                  目标 <code>{item.currentHash.slice(0, 12)}</code> · 技能库{" "}
                  <code>{item.libraryHash.slice(0, 12)}</code>
                </p>
              ) : null}
              <div className="resolution-options">
                <button
                  type="button"
                  className={`resolution${busy ? " active" : ""}`}
                  disabled={busy}
                  onClick={() => onExclude(item)}
                >
                  <i aria-hidden />
                  {busy ? "正在排除…" : "从 Bundle 排除"}
                </button>
                <button type="button" className="resolution" onClick={() => onOpenDirectory(item)}>
                  <i aria-hidden />
                  打开所在目录
                </button>
                <button
                  type="button"
                  className={`resolution${copiedId === item.id ? " active" : ""}`}
                  onClick={() => void copy(item.id, destination)}
                >
                  <i aria-hidden />
                  {copiedId === item.id ? "已复制" : "复制路径"}
                </button>
              </div>
              {copyFailedId === item.id ? (
                <p className="conflict-copy-failed">复制失败，请手动选中上方路径复制。</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
