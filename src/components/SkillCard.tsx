import { useState } from "react";
import { StatusPill } from "./ui";
import { IconSkill, IconCopy, IconCheck } from "./icons";
import { HighlightText } from "./HighlightText";
import type { SkillEntry } from "../types/domain";
import type { WorkspaceController } from "../hooks/useWorkspace";

interface Props {
  entry: SkillEntry;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: () => void;
  onToggleCheck: (shiftKey?: boolean) => void;
  controller: WorkspaceController;
}

export function SkillCard({
  entry,
  isSelected,
  isChecked,
  onSelect,
  onToggleCheck,
  controller,
}: Props) {
  const { agentName, snapshot, query, showToast } = controller;
  const [copiedPath, setCopiedPath] = useState(false);

  // Determine which agents this skill is deployed in (both primary home & created junctions)
  const deployedAgentNames = new Set<string>();

  // Home agents
  for (const agentId of entry.agentIds) {
    if (agentId !== "skills-manager-vault") {
      deployedAgentNames.add(agentName(agentId));
    }
  }

  // Junction-installed agents
  for (const rootId of entry.installedRootIds) {
    const root = snapshot.roots.find((r) => r.id === rootId);
    if (root && root.agentId !== "skills-manager-vault") {
      deployedAgentNames.add(agentName(root.agentId));
    }
  }

  const deployedList = [...deployedAgentNames];

  const scopeLabel =
    entry.hasUserScope && entry.hasProjectScope
      ? "用户 + 项目"
      : entry.hasProjectScope
        ? "项目"
        : "全局用户";

  const handleCopyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(entry.path);
    setCopiedPath(true);
    showToast(`已复制「${entry.name}」本地路径`, "success");
    setTimeout(() => setCopiedPath(false), 1800);
  };

  return (
    <div
      className={`skill-card ${isSelected ? "skill-card-selected" : ""} ${
        entry.missing ? "skill-card-missing" : ""
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="card-header">
        <div className="card-header-left">
          <input
            type="checkbox"
            className="card-checkbox"
            checked={isChecked}
            aria-label={`选择 ${entry.name}`}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const native = e.nativeEvent as MouseEvent;
              onToggleCheck(native.shiftKey);
            }}
          />
          <div className="card-icon-box">
            <IconSkill />
          </div>
          <div className="card-title-group">
            <h3 className="card-title" title={entry.name}>
              <HighlightText text={entry.name} query={query} />
            </h3>
            <span className="card-scope-badge">{scopeLabel}</span>
          </div>
        </div>

        <div className="card-status-badge">
          {entry.missing ? (
            <StatusPill tone="red">已失效</StatusPill>
          ) : entry.hasDivergentConflict ? (
            <StatusPill tone="amber">版本冲突</StatusPill>
          ) : entry.canAutoMerge ? (
            <StatusPill tone="amber">待合并</StatusPill>
          ) : entry.scriptCount > 0 ? (
            <StatusPill tone="amber">含脚本 ({entry.scriptCount})</StatusPill>
          ) : (
            <StatusPill tone="gray">就绪</StatusPill>
          )}
        </div>
      </div>

      <div className="card-body">
        <p className="card-description" title={entry.note || entry.description || "暂无描述"}>
          {entry.note ? (
            <span className="card-note-highlight">
              <HighlightText text={entry.note} query={query} />
            </span>
          ) : (
            <HighlightText text={entry.description || "暂无描述"} query={query} />
          )}
        </p>
      </div>

      <div className="card-tags-row">
        {entry.groupName ? (
          <span className="card-group-pill" title={`所属分组: ${entry.groupName}`}>
            📁 {entry.groupName}
          </span>
        ) : null}

        {entry.tagNames.slice(0, 3).map((tag) => (
          <span key={tag} className="card-tag-pill">
            #{tag}
          </span>
        ))}

        {entry.tagNames.length > 3 ? (
          <span className="card-tag-more">+{entry.tagNames.length - 3}</span>
        ) : null}

        <button
          type="button"
          className="card-quick-copy-btn"
          title="复制本地路径"
          onClick={handleCopyPath}
        >
          {copiedPath ? (
            <IconCheck style={{ color: "var(--green)" }} />
          ) : (
            <IconCopy style={{ opacity: 0.7 }} />
          )}
        </button>
      </div>

      <div className="card-footer">
        <div className="card-deployed-group">
          <span className="deployed-label">已分发至:</span>
          <div className="deployed-pills">
            {deployedList.slice(0, 3).map((name) => (
              <span key={name} className="deployed-agent-chip" title={name}>
                {name}
              </span>
            ))}
            {deployedList.length > 3 ? (
              <span className="deployed-more-chip" title={deployedList.join(", ")}>
                +{deployedList.length - 3}
              </span>
            ) : null}
            {deployedList.length === 0 ? (
              <span className="deployed-none">未分发</span>
            ) : null}
          </div>
        </div>

        <div className="card-meta-end">
          {entry.refs.length > 1 ? (
            <span className="refs-badge" title={`在 ${entry.refs.length} 处被检测到`}>
              {entry.refs.length} 处登记
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
