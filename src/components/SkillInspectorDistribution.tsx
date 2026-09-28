import { Button, Switch } from "./ui";
import type { WorkspaceController, DistributionAgent } from "../hooks/useWorkspace";
import { displayPath, type SkillEntry } from "../types/domain";

interface Props {
  controller: WorkspaceController;
  entry: SkillEntry;
  distStates: Array<{
    agent: DistributionAgent;
    home: boolean;
    installed: boolean;
    linkIds: string[];
  }>;
  installableAgents: DistributionAgent[];
  removableStates: Array<{
    agent: DistributionAgent;
    home: boolean;
    installed: boolean;
    linkIds: string[];
  }>;
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
    toggleAgentLink,
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
            点击开关直接在目标 Agent 目录创建或移除 Windows Junction 原生软连接
          </p>
        </div>

        <div className="batch-dist-controls">
          {installableAgents.length > 0 ? (
            <Button
              variant="secondary"
              disabled={busy || entry.missing}
              onClick={onInstallAll}
              title="一键装到所有已检测的可用 Agent"
            >
              全部安装 ({installableAgents.length})
            </Button>
          ) : null}
          {removableStates.length > 0 ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={onUninstallAll}
              title="移除此 Skill 在所有 Agent 上的软连接（源目录文件不受任何影响）"
            >
              全部卸载 ({removableStates.length})
            </Button>
          ) : null}
        </div>
      </div>

      {!entry.inVault ? (
        <div className="vault-banner">
          <div className="vault-banner-text">
            <strong>未纳入中央库托管</strong>
            <span>建议将本技能纳管入库。纳管后本体安全存放在中央库，所有 Agent 均可自由启用与禁用软连接，收回后永不丢失。</span>
          </div>
          <Button
            variant="secondary"
            disabled={busy || entry.missing}
            onClick={() => void controller.incorporateToVault(entry)}
          >
            纳管入库
          </Button>
        </div>
      ) : null}

      {entry.canAutoMerge ? (
        <div className="conflict-banner conflict-banner-automerge">
          <div className="conflict-banner-text">
            <strong>检测到完全一致副本</strong>
            <span>多个 Agent 目录下的内容哈希 100% 一致，支持一键合并为中央库标准版并切换软连接。</span>
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void controller.autoMergeIdentical()}
          >
            一键自动合并
          </Button>
        </div>
      ) : entry.hasDivergentConflict ? (
        <div className="conflict-banner conflict-banner-manual">
          <div className="conflict-banner-text">
            <strong>检测到同名版本冲突</strong>
            <span>不同 Agent 目录下的内容或配置存在差异，请裁决保留哪一份作为中央库唯一母本。</span>
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

      {entry.inVault && distStates.length > 0 && distStates.every((s) => !s.installed) ? (
        <div className="vault-dormant-hint">
          <span>💡 软连接已全部收回。该技能已在中央库中安全休眠，不会丢失任何代码与配置，随时可重新分发。</span>
        </div>
      ) : null}

      <div className="agent-distribution-list">
        {distStates.length === 0 ? (
          <p className="muted-help">未探测到已安装的 Agent。请在左侧登记项目目录。</p>
        ) : (
          distStates.map(({ agent, home, installed, linkIds }) => {
            const { agentId, primary, roots } = agent;
            return (
              <div className="agent-dist-row" key={agentId}>
                <div className="agent-dist-left">
                  <div className="agent-avatar-sm">
                    {agentName(agentId).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="agent-dist-info">
                    <strong className="agent-dist-name">{agentName(agentId)}</strong>
                    <span className="agent-dist-path">
                      {home
                        ? "技能源目录直接登记在该 Agent 目录下"
                        : displayPath(primary.configuredPath)}
                      {roots.length > 1 && !home ? ` · 共 ${roots.length} 个配置点` : ""}
                    </span>
                  </div>
                </div>

                <div className="agent-dist-action">
                  {home ? (
                    <span
                      className="badge-home-origin"
                      title="Skill 源目录直接位于该 Agent 内，无需写回，源文件永远保留"
                    >
                      已就绪 (本体)
                    </span>
                  ) : (
                    <Switch
                      checked={installed}
                      disabled={busy || entry.missing}
                      title={
                        entry.missing
                          ? "源目录不存在，无法创建连接"
                          : installed
                            ? "已建立软连接 · 点击移除连接（不影响源文件）"
                            : "未安装 · 点击以 Windows Junction 零拷贝写回此 Agent"
                      }
                      ariaLabel={`为 ${agentName(agentId)} 安装软连接`}
                      onChange={() => toggleAgentLink(entry, primary.id, linkIds)}
                    />
                  )}
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
