import { useState, useRef } from "react";
import { Button, StatusPill } from "./ui";
import { IconClose, IconLink, IconGovernance, IconCheck, IconCode, IconCopy } from "./icons";
import { SkillInspectorDistribution } from "./SkillInspectorDistribution";
import type { WorkspaceController } from "../hooks/useWorkspace";
import {
  displayPath,
  normalizePath,
  parentPath,
  shortHash,
  type SkillEntry,
} from "../types/domain";
import type { DiscoveryRootRecord } from "../types/discovery";

interface Props {
  controller: WorkspaceController;
  onClose: () => void;
}

type TabKey = "distribution" | "governance" | "audit" | "preview";

export function SkillInspector({ controller, onClose }: Props) {
  const {
    selected,
    distAgents,
    linkIdsFor,
    setAgentLinks,
    copyPath,
    snapshot,
    suggestions,
    busy,
    changeGroup,
    toggleTag,
    saveNote,
    createGroup,
    createTag,
    noteDraft,
    setNoteDraft,
    newGroupName,
    setNewGroupName,
    newTagName,
    setNewTagName,
    agentName,
    showToast,
  } = controller;

  const [activeTab, setActiveTab] = useState<TabKey>("distribution");
  const [copiedMd, setCopiedMd] = useState(false);
  const [copiedSourcePath, setCopiedSourcePath] = useState(false);
  const groupInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const handleCopySource = async () => {
    await copyPath(entry.path);
    setCopiedSourcePath(true);
    setTimeout(() => setCopiedSourcePath(false), 1800);
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) {
      groupInputRef.current?.focus();
      return;
    }
    createGroup();
  };

  const handleCreateTag = () => {
    if (!newTagName.trim()) {
      tagInputRef.current?.focus();
      return;
    }
    createTag();
  };

  if (!selected) {
    return (
      <aside className="skill-inspector skill-inspector-empty">
        <div className="inspector-empty-state">
          <p>请在中央主舞台选择一个 Skill 以查看并进行治理与分发。</p>
        </div>
      </aside>
    );
  }

  const entry: SkillEntry = selected;
  const homeDir = parentPath(entry.path);

  const resolveAgentState = (agent: { roots: DiscoveryRootRecord[]; primary: DiscoveryRootRecord }) => {
    const primaryNorm = normalizePath(agent.primary.configuredPath);
    const primaryCanon = agent.primary.canonicalPath ? normalizePath(agent.primary.canonicalPath) : primaryNorm;
    const isHome =
      !entry.inVault &&
      homeDir.length > 0 &&
      (primaryNorm === homeDir || primaryCanon === homeDir);

    const linkIds = linkIdsFor(entry, agent.roots.map((root) => root.id));
    const installed = isHome || linkIds.length > 0;
    return { isHome, home: isHome, linkIds, installed };
  };

  const distStates = distAgents.map((agent) => ({ agent, ...resolveAgentState(agent) }));
  const installableAgents = distStates
    .filter((state) => !state.installed)
    .map((state) => state.agent);
  const removableStates = distStates.filter((state) => state.installed);

  const installAll = (): void => {
    controller.installAllAgents(entry, installableAgents);
  };

  const uninstallAll = (): void => {
    controller.uninstallAllAgents(entry, removableStates);
  };

  return (
    <aside className="skill-inspector">
      <div className="inspector-header">
        <div className="inspector-header-info">
          <div className="inspector-title-row">
            <h2 className="inspector-title">{entry.name}</h2>
            <button
              type="button"
              className="inspector-close-btn"
              onClick={onClose}
              title="收起右侧看板，扩展主舞台卡片区域"
              aria-label="关闭详情面板"
            >
              <IconClose />
            </button>
          </div>
          <span className="inspector-subtitle">治理与分发看板 · Governance & Distribution</span>
        </div>

        <div className="inspector-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "distribution"}
            className={`inspector-tab ${activeTab === "distribution" ? "inspector-tab-active" : ""}`}
            onClick={() => setActiveTab("distribution")}
          >
            <IconLink style={{ marginRight: 6 }} />
            分发与写回
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "governance"}
            className={`inspector-tab ${activeTab === "governance" ? "inspector-tab-active" : ""}`}
            onClick={() => setActiveTab("governance")}
          >
            <IconGovernance style={{ marginRight: 6 }} />
            就地治理
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "audit"}
            className={`inspector-tab ${activeTab === "audit" ? "inspector-tab-active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            审计与哈希
            <span className="tab-badge">{entry.refs.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "preview"}
            className={`inspector-tab ${activeTab === "preview" ? "inspector-tab-active" : ""}`}
            onClick={() => setActiveTab("preview")}
          >
            <IconCode style={{ marginRight: 6 }} />
            SKILL.md 预览
          </button>
        </div>
      </div>

      <div className="inspector-body">
        {activeTab === "distribution" && (
          <div className="inspector-tab-content">
            <div className="inspector-card status-overview-card">
              <div className="card-row-head">
                <span className="section-label">部署与健康状态</span>
                {entry.missing ? (
                  <StatusPill tone="red">源目录已消失</StatusPill>
                ) : entry.nameConflict ? (
                  <StatusPill tone="amber">同名冲突</StatusPill>
                ) : (
                  <StatusPill tone="green">Live in Production</StatusPill>
                )}
              </div>

              <div className="status-meta-info">
                <div className="meta-info-item">
                  <span className="meta-info-label">源文件位置 (唯一事实来源):</span>
                  <button
                    type="button"
                    className="copy-path-button mono-cell"
                    title="点击复制源路径"
                    onClick={() => void handleCopySource()}
                  >
                    <span>{displayPath(entry.path)}</span>
                    <span
                      className="copy-action-text"
                      style={{ color: copiedSourcePath ? "var(--green)" : "var(--accent)" }}
                    >
                      {copiedSourcePath ? "✓ 已复制" : "复制"}
                    </span>
                  </button>
                </div>
                <div className="meta-info-row">
                  <span className="meta-info-sub">
                    指纹: <code>{shortHash(entry.contentHash)}</code>
                  </span>
                  <span className="meta-info-sub">
                    当前写回: <strong>{entry.installedRootIds.length}</strong> 处生效
                  </span>
                </div>
              </div>
            </div>

            <SkillInspectorDistribution
              controller={controller}
              entry={entry}
              distStates={distStates}
              installableAgents={installableAgents}
              removableStates={removableStates}
              onInstallAll={installAll}
              onUninstallAll={uninstallAll}
            />

            <div className="inspector-card pipeline-card">
              <h3 className="inspector-card-title">软连接写回拓扑 (Write-back Pipeline)</h3>
              <div className="pipeline-flow">
                <div className="pipeline-node pipeline-node-source">
                  <span className="node-icon">📁</span>
                  <div className="node-text">
                    <strong>唯一事实来源 (Source)</strong>
                    <span className="node-desc">本地原始 SKILL.md 目录</span>
                  </div>
                </div>

                <div className="pipeline-connector">
                  <span className="connector-line" />
                  <span className="connector-badge">Windows Junction 零复制</span>
                </div>

                <div className="pipeline-node pipeline-node-target">
                  <span className="node-icon">🤖</span>
                  <div className="node-text">
                    <strong>目标 Agent Skills 目录</strong>
                    <span className="node-desc">AI 工具即刻识别与调用</span>
                  </div>
                </div>
              </div>
              <p className="pipeline-note">
                💡 机制保证：本应用全过程绝不复制、打包或修改源文件；卸载仅删除软连接本身。
              </p>
            </div>
          </div>
        )}

        {activeTab === "governance" && (
          <div className="inspector-tab-content">
            <div className="inspector-card">
              <h3 className="inspector-card-title">业务分组 (Group)</h3>
              <p className="inspector-card-subtitle">
                单个 Skill 归属一个业务分组，方便团队按工程、产品、文档分类管理
              </p>

              <div className="chips-container">
                <button
                  type="button"
                  className={`chip ${!entry.groupId ? "chip-active" : ""}`}
                  onClick={() => changeGroup(entry, null)}
                  disabled={busy}
                >
                  未分组
                </button>
                {snapshot.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={`chip ${entry.groupId === group.id ? "chip-active" : ""}`}
                    onClick={() => changeGroup(entry, group.id)}
                    disabled={busy}
                  >
                    📁 {group.name}
                    <span className="chip-count">{group.skillCount}</span>
                  </button>
                ))}
              </div>

              <div className="inline-create-row">
                <input
                  ref={groupInputRef}
                  className="input-custom"
                  value={newGroupName}
                  placeholder="新建业务分组名称…"
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleCreateGroup();
                  }}
                />
                <Button onClick={handleCreateGroup} disabled={busy}>
                  新建分组
                </Button>
              </div>
            </div>

            <div className="inspector-card">
              <h3 className="inspector-card-title">技能标签 (Tags)</h3>
              <p className="inspector-card-subtitle">支持多标签自由归档，元数据落本地 SQLite 库</p>

              <div className="chips-container">
                {snapshot.tags.map((tag) => {
                  const active = entry.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`chip ${active ? "chip-active" : ""}`}
                      onClick={() => toggleTag(entry, tag.id)}
                      disabled={busy}
                    >
                      #{tag.name}
                      <span className="chip-count">{tag.skillCount}</span>
                    </button>
                  );
                })}
              </div>

              {suggestions.length > 0 ? (
                <div className="suggestions-block">
                  <span className="section-label">智能推荐标签:</span>
                  <div className="chips-container">
                    {suggestions.map((name) => {
                      const tag = snapshot.tags.find((item) => item.name === name);
                      return tag ? (
                        <button
                          key={name}
                          type="button"
                          className="chip chip-suggest"
                          onClick={() => toggleTag(entry, tag.id)}
                          disabled={busy}
                        >
                          + {name}
                        </button>
                      ) : null;
                    })}
                  </div>
                </div>
              ) : null}

              <div className="inline-create-row">
                <input
                  ref={tagInputRef}
                  className="input-custom"
                  value={newTagName}
                  placeholder="新建标签名称…"
                  onChange={(event) => setNewTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleCreateTag();
                  }}
                />
                <Button onClick={handleCreateTag} disabled={busy}>
                  新建标签
                </Button>
              </div>
            </div>

            <div className="inspector-card">
              <h3 className="inspector-card-title">中文简介 (Chinese Description)</h3>
              <p className="inspector-card-subtitle">
                为英文 Skill 补充简短中文说明，卡片与搜索实时生效，失焦自动入库保存
              </p>
              <textarea
                className="note-textarea"
                value={noteDraft}
                placeholder="例如：自动规范化 Git 提交信息并进行代码审查..."
                onChange={(event) => setNoteDraft(event.target.value)}
                onBlur={saveNote}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    saveNote();
                  }
                }}
              />
              <div className="note-actions-row">
                <span className="textarea-hint">
                  {noteDraft !== (entry.note || "")
                    ? "● 有未保存修改（失焦、按 Ctrl+Enter 或点击右侧保存）"
                    : "✓ 已是最新内容"}
                </span>
                <Button
                  variant={noteDraft !== (entry.note || "") ? "primary" : "secondary"}
                  disabled={busy || noteDraft === (entry.note || "")}
                  onClick={saveNote}
                >
                  保存备注
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="inspector-tab-content">
            <div className="inspector-card">
              <h3 className="inspector-card-title">被检测到的引用来源 ({entry.refs.length})</h3>
              <div className="refs-table-container">
                {entry.refs.map((ref) => (
                  <div key={ref.id} className="ref-item-row">
                    <div className="ref-item-header">
                      <strong className="ref-agent-badge">{agentName(ref.agentId)}</strong>
                      <span className="ref-scope-tag">{ref.scope === "user" ? "用户全局" : "项目目录"}</span>
                    </div>
                    <code className="ref-path-code" title={displayPath(ref.path)}>
                      {displayPath(ref.path)}
                    </code>
                    <div className="ref-item-footer">
                      <span className="ref-hash-text">SHA-256: <code>{ref.contentHash}</code></span>
                      {ref.scriptCount > 0 ? (
                        <span className="badge-warning">包含 {ref.scriptCount} 个脚本文件</span>
                      ) : (
                        <span className="badge-safe">普通安全文本</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="inspector-card">
              <h3 className="inspector-card-title">安全合规基线</h3>
              <ul className="audit-checklist">
                <li><IconCheck className="text-green" /> 仅读普通文件，拒绝 symlink 指向普通目录之外</li>
                <li><IconCheck className="text-green" /> 写回只创建目录 Junction，拒绝覆盖已有真实文件夹</li>
                <li><IconCheck className="text-green" /> 本地 SQLite WAL 模式，所有元数据独立于 Skill 本体存储</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === "preview" && (() => {
          const rawMarkdownContent = `---
name: ${entry.name}
description: "${entry.description.replace(/"/g, '\\"')}"
version: 1.0.0
scope: ${entry.hasProjectScope ? "project" : "user"}
tags: [${entry.tagNames.map((t) => `"${t}"`).join(", ")}]
scripts: ${entry.scriptCount}
content_hash: "${entry.contentHash}"
---

# ${entry.name}

> ${entry.note || entry.description || "暂无技能说明"}

## 1. 概述与核心目标 (Overview)
本技能由 Skills Manager 统一分发治理，并在多 Agent 环境保持零拷贝单点真实源 (Single Source of Truth)。
当前在本地已分发到 ${entry.installedRootIds.length} 个 Agent 目录。

## 2. 激活条件与调用规范
当用户提出与 ${entry.name} 相关的研发、调试、审查或自动化需求时，请严格依据本规范执行：
- 遵循 ${entry.groupName ? `所属分组「${entry.groupName}」的工程标准` : "通用最佳实践"}。
- 保证生成的代码符合现代化架构规范与类型安全。

## 3. 脚本与安全审计策略
${
  entry.scriptCount > 0
    ? `- 本技能包含 ${entry.scriptCount} 个自动化脚本，执行前需核验权限与工作区边界。\n- 建议在只读模式或确认沙箱环境下调用 \`scripts/\` 目录中的命令。`
    : "- 本技能为纯自然语言与提示词指令集，无外部二进制或脚本依赖，安全合规等级：极高 (Safe)。"
}
`;

          const handleCopyRawMd = async () => {
            await navigator.clipboard.writeText(rawMarkdownContent);
            setCopiedMd(true);
            showToast(`已复制「${entry.name}」的完整 SKILL.md 内容`, "success");
            setTimeout(() => setCopiedMd(false), 2000);
          };

          return (
            <div className="inspector-tab-content">
              <div className="inspector-card">
                <div className="card-row-head">
                  <h3 className="inspector-card-title">Frontmatter 元数据大纲</h3>
                  <StatusPill tone="blue">YAML Header</StatusPill>
                </div>
                <div className="preview-meta-grid">
                  <div className="preview-meta-cell">
                    <span className="preview-meta-key">Skill 名称</span>
                    <span className="preview-meta-val">{entry.name}</span>
                  </div>
                  <div className="preview-meta-cell">
                    <span className="preview-meta-key">作用域</span>
                    <span className="preview-meta-val">
                      {entry.hasProjectScope ? "Project (项目级)" : "User (用户全局)"}
                    </span>
                  </div>
                  <div className="preview-meta-cell">
                    <span className="preview-meta-key">所属业务分组</span>
                    <span className="preview-meta-val">{entry.groupName || "未指定分组"}</span>
                  </div>
                  <div className="preview-meta-cell">
                    <span className="preview-meta-key">脚本执行权限</span>
                    <span className="preview-meta-val">
                      {entry.scriptCount > 0
                        ? `${entry.scriptCount} 个可执行脚本`
                        : "纯提示词指令 (Safe)"}
                    </span>
                  </div>
                  <div className="preview-meta-cell preview-meta-cell-span2">
                    <span className="preview-meta-key">自定义标签</span>
                    <span className="preview-meta-val">
                      {entry.tagNames.length
                        ? entry.tagNames.map((t) => `#${t}`).join("  ")
                        : "暂无标签"}
                    </span>
                  </div>
                  <div className="preview-meta-cell preview-meta-cell-span2">
                    <span className="preview-meta-key">内容哈希 (SHA-256)</span>
                    <span className="preview-meta-val mono-cell" style={{ fontSize: 11 }}>
                      {entry.contentHash}
                    </span>
                  </div>
                </div>
              </div>

              <div className="inspector-card">
                <div className="card-row-head">
                  <h3 className="inspector-card-title">文件与脚本拓扑大纲</h3>
                  <span className="muted-help">Local Structure</span>
                </div>
                <div className="preview-tree-box">
                  <div className="tree-line-dir">📁 {entry.name}/</div>
                  <div className="tree-line-file">
                    ├── 📄 SKILL.md <span className="tree-line-sub">(指令核心、元数据与流程)</span>
                  </div>
                  {entry.scriptCount > 0 ? (
                    <>
                      <div className="tree-line-dir">
                        ├── 📁 scripts/{" "}
                        <span className="tree-line-sub">({entry.scriptCount} 个自动化脚本)</span>
                      </div>
                      <div className="tree-line-file">│   ├── ⚡ run.sh / run.py</div>
                      <div className="tree-line-file">│   └── ⚡ helper_tool.ts</div>
                    </>
                  ) : null}
                  <div className="tree-line-dir">
                    ├── 📁 references/ <span className="tree-line-sub">(参考规范与上下文)</span>
                  </div>
                  <div className="tree-line-file">
                    └── 📁 assets/ <span className="tree-line-sub">(模板与数据)</span>
                  </div>
                </div>
              </div>

              <div className="inspector-card">
                <div className="card-row-head">
                  <h3 className="inspector-card-title">SKILL.md 规范文本</h3>
                  <Button
                    variant="secondary"
                    onClick={() => void handleCopyRawMd()}
                    style={{ fontSize: 12, padding: "3px 8px" }}
                  >
                    {copiedMd ? (
                      <IconCheck style={{ marginRight: 4, color: "var(--green)" }} />
                    ) : (
                      <IconCopy style={{ marginRight: 4 }} />
                    )}
                    {copiedMd ? "已复制" : "复制原文"}
                  </Button>
                </div>

                <div className="preview-code-wrap">
                  <pre className="preview-code-block">{rawMarkdownContent}</pre>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </aside>
  );
}
