import { useState } from "react";
import { Button, StatusPill } from "./ui";
import { IconClose, IconLink, IconGovernance, IconCheck } from "./icons";
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

type TabKey = "distribution" | "governance" | "audit";

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
  } = controller;

  const [activeTab, setActiveTab] = useState<TabKey>("distribution");

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

  const resolveAgentState = (agent: { roots: DiscoveryRootRecord[] }) => {
    const home =
      !entry.inVault &&
      homeDir.length > 0 &&
      agent.roots.some(
        (root) =>
          normalizePath(root.configuredPath) === homeDir ||
          (root.canonicalPath ? normalizePath(root.canonicalPath) === homeDir : false),
      );
    const linkIds = linkIdsFor(entry.path, agent.roots.map((root) => root.id));
    return { home, linkIds, installed: linkIds.length > 0 };
  };

  const distStates = distAgents.map((agent) => ({ agent, ...resolveAgentState(agent) }));
  const installableAgents = distStates
    .filter((state) => !state.home && !state.installed)
    .map((state) => state.agent);
  const removableStates = distStates.filter((state) => !state.home && state.installed);

  const installAll = (): void => {
    setAgentLinks(
      entry,
      installableAgents.map((agent) => ({ rootId: agent.primary.id, linkIds: [] })),
    );
  };

  const uninstallAll = (): void => {
    setAgentLinks(
      entry,
      removableStates.map((state) => ({ rootId: state.agent.primary.id, linkIds: state.linkIds })),
    );
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
                    onClick={() => void copyPath(entry.path)}
                  >
                    <span>{displayPath(entry.path)}</span>
                    <span className="copy-action-text">复制</span>
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
                  className="input-custom"
                  value={newGroupName}
                  placeholder="新建业务分组名称…"
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createGroup();
                  }}
                />
                <Button onClick={createGroup} disabled={busy || !newGroupName.trim()}>
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
                  className="input-custom"
                  value={newTagName}
                  placeholder="新建标签名称…"
                  onChange={(event) => setNewTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createTag();
                  }}
                />
                <Button onClick={createTag} disabled={busy || !newTagName.trim()}>
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
              />
              <span className="textarea-hint">输入完毕后失焦即刻自动落盘保存</span>
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
      </div>
    </aside>
  );
}
