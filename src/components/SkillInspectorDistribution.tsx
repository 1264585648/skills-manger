import { Button, Switch } from "./ui";
import type { WorkspaceController, DistributionAgent } from "../hooks/useWorkspace";
import { displayPath, type SkillEntry } from "../types/domain";

export interface DistributionState {
  agent: DistributionAgent;
  isHome: boolean;
  home: boolean;
  installed: boolean;
  linkIds: string[];
}

interface Props {
  controller: WorkspaceController;
  entry: SkillEntry;
  distStates: DistributionState[];
  installableAgents: DistributionAgent[];
  removableStates: DistributionState[];
  onInstallAll: () => void;
  onUninstallAll: () => void;
}

export function SkillInspectorDistribution({
  controller,
  entry,
  distStates,
  installableAgents,
  removableStates,
  onInstallAll,
  onUninstallAll,
}: Props) {
  const {
    agentName,
    toggleAgentDistribution,
    showAllAgents,
    setShowAllAgents,
    busy,
    snapshot,
  } = controller;

  return (
    <div className="inspector-card">
      <div className="card-row-head">
        <div>
          <h3 className="inspector-card-title">目标 Agent 分发 (Agent Distribution)</h3>
          <p className="inspector-card-subtitle">
            点击开关直接在目标 Agent 中启用或停用此技能
          </p>
        </div>

        <div className="batch-dist-controls">
          {installableAgents.length > 0 ? (
            <Button
              variant="secondary"
              disabled={busy || entry.missing}
              onClick={onInstallAll}
              title="一键为所有已检测的可用 Agent 启用"
            >
              {busy ? "处理中…" : `全部安装 (${installableAgents.length})`}
            </Button>
          ) : null}
          {removableStates.length > 0 ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={onUninstallAll}
              title="一键在所有 Agent 中停用（原代码与配置完好保存）"
            >
              {busy ? "处理中…" : `全部卸载 (${removableStates.length})`}
            </Button>
          ) : null}
        </div>
      </div>

      {entry.canAutoMerge ? (
        <div className="conflict-banner conflict-banner-automerge">
          <div className="conflict-banner-text">
            <strong>检测到完全一致副本</strong>
            <span>多个 Agent 目录下的内容哈希 100% 一致，支持一键合并为标准版并统一分发。</span>
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void controller.autoMergeIdentical()}
          >
            {busy ? "合并处理中…" : "一键自动合并"}
          </Button>
        </div>
      ) : entry.hasDivergentConflict ? (
        <div className="conflict-banner conflict-banner-manual">
          <div className="conflict-banner-text">
            <strong>检测到同名版本冲突</strong>
            <span>不同 Agent 目录下的内容或配置存在差异，请裁决保留哪一份作为唯一母本。</span>
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => controller.setConflictEntry(entry)}
          >
            裁决并合并
          </Button>
        </div>
      ) : null}

      {distStates.length > 0 && distStates.every((s) => !s.installed) ? (
        <div className="vault-dormant-hint">
          <span>💡 该技能已在所有 Agent 中停用，其代码与配置已安全保留，随时可重新开启分发。</span>
        </div>
      ) : null}

      <div className="agent-distribution-list">
        {distStates.length === 0 ? (
          <p className="muted-help">未探测到已安装的 Agent。请在左侧登记项目目录。</p>
        ) : (
          distStates.map((state) => {
            const { agent, installed } = state;
            const { agentId, primary, roots } = agent;
            return (
              <div
                className="agent-dist-row"
                key={agentId}
                onClick={() => {
                  if (!busy && !entry.missing) {
                    toggleAgentDistribution(entry, agent, state);
                  }
                }}
                style={{ cursor: busy || entry.missing ? "not-allowed" : "pointer" }}
              >
                <div className="agent-dist-left">
                  <div className="agent-avatar-sm">
                    {agentName(agentId).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="agent-dist-info">
                    <strong className="agent-dist-name">{agentName(agentId)}</strong>
                    <span className="agent-dist-path">
                      {displayPath(primary.configuredPath)}
                      {roots.length > 1 ? ` · 共 ${roots.length} 个配置点` : ""}
                    </span>
                  </div>
                </div>

                <div className="agent-dist-action" onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={installed}
                    disabled={busy || entry.missing}
                    title={
                      entry.missing
                        ? "源目录不存在，无法启用"
                        : installed
                          ? "已启用 · 点击为该 Agent 停用此技能"
                          : "未启用 · 点击为该 Agent 启用此技能"
                    }
                    ariaLabel={`为 ${agentName(agentId)} ${installed ? "停用" : "启用"}此技能`}
                    onChange={() => toggleAgentDistribution(entry, agent, state)}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="agent-dist-footer">
        <label className="check-line-sub">
          <input
            type="checkbox"
            checked={showAllAgents}
            onChange={(e) => setShowAllAgents(e.target.checked)}
          />
          <span>
            显示未在 PATH 中探测到的残留 Agent (
            {snapshot.targets.filter((t) => !t.installed).length} 个)
          </span>
        </label>
      </div>
    </div>
  );
}
