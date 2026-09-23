import { Button, EmptyState, StatusPill } from "./ui";
import { GovernancePanel } from "./GovernancePanel";
import type { WorkspaceController } from "../hooks/useWorkspace";
import { displayPath, normalizePath, parentPath, shortHash, type SkillEntry } from "../types/domain";
import type { DiscoveryRootRecord, SkillInstanceRecord } from "../types/discovery";

interface Props {
  controller: WorkspaceController;
}

export function SkillDetail({ controller }: Props) {
  const {
    selected,
    entries,
    counts,
    snapshot,
    distAgents,
    agentName,
    linkIdsFor,
    setAgentLinks,
    toggleAgentLink,
    showAllAgents,
    setShowAllAgents,
    busy,
    copyPath,
  } = controller;

  if (!selected) {
    return (
      <section className="ws-detail">
        <EmptyState
          title="没有选中 Skill"
          body="左侧列表为空时，先在下方登记项目 skills 目录，或点「重新扫描」。"
        />
      </section>
    );
  }

  const entry: SkillEntry = selected;
  const homeDir = parentPath(entry.path);

  // 计算每个 Agent 行的分发状态：是否「已就绪」（本体就在登记目录内）、
  // 已有哪些连接、是否已安装。分发区与「批量写回」共用这一份判定。
  const resolveAgentState = (agent: { roots: DiscoveryRootRecord[] }) => {
    const home =
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

  // 批量写回 / 批量卸载：整批变更走一次原子操作（一次 busy、一次 reload）。
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

  const renderDistribution = () => (
    <div className="dist-list">
      {distStates.map(({ agent, home, installed }) => {
        const { agentId, roots, primary } = agent;
        return (
          <div className="dist-row" key={agentId}>
            <span className="dist-main">
              <strong>{agentName(agentId)}</strong>
              <span className="dist-meta">
                {home
                  ? "登记目录已覆盖 Skill 本体，无需写回"
                  : `${displayPath(primary.configuredPath)}${roots.length > 1 ? ` · 共 ${roots.length} 个登记目录` : ""}`}
              </span>
            </span>
            {home ? (
              <span className="dist-home" title="Skill 本体已在该 Agent 的登记目录内，无需写回，也不是可点的按钮">
                已就绪
              </span>
            ) : (
              <button
                type="button"
                className={installed ? "switch switch-on" : "switch"}
                disabled={busy || entry.missing}
                title={
                  entry.missing
                    ? "源目录已从磁盘消失，无法创建连接"
                    : installed
                      ? "已安装到该 Agent · 点击移除这条软连接（只会删除连接，不会删除源目录）"
                      : "创建指向源目录的软连接（源目录不会被改动）"
                }
                onClick={() => toggleAgentLink(entry, primary.id, resolveAgentState(agent).linkIds)}
              >
                {installed ? "已装" : "安装"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderRefs = (refs: SkillInstanceRecord[]) => (
    <ul className="ref-list">
      {refs.map((ref) => (
        <li key={ref.id}>
          <span className="ref-agent">{agentName(ref.agentId)}</span>
          <span className="ref-scope">{ref.scope === "user" ? "用户" : "项目"}</span>
          <code className="ref-path" title={displayPath(ref.path)}>
            {displayPath(ref.path)}
          </code>
          <code className="ref-hash" title={ref.contentHash}>
            {shortHash(ref.contentHash)}
          </code>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="ws-detail">
      <div className="detail-head">
        <div>
          <h2>{entry.name}</h2>
          <p className="detail-desc">{entry.description || "没有描述"}</p>
          <button
            type="button"
            className="detail-path mono-cell"
            title="点击复制路径"
            onClick={() => void copyPath(entry.path)}
          >
            {displayPath(entry.path)}
          </button>
        </div>
        <div className="detail-status">
          {entry.nameConflict ? <StatusPill tone="amber">同名冲突</StatusPill> : null}
          {entry.missing ? <StatusPill tone="red">磁盘已消失</StatusPill> : null}
          {entry.scriptCount > 0 ? (
            <StatusPill tone="amber">scripts {entry.scriptCount}</StatusPill>
          ) : null}
        </div>
      </div>

      <section className="detail-section">
        <div className="section-head">
          <h3>装到哪些 Agent</h3>
          <span className="section-hint">软连接写回 · 源目录始终是唯一事实来源</span>
        </div>
        {distAgents.length === 0 ? (
          <p className="muted-help">没有可用的目标目录，先在左侧登记项目 skills 目录。</p>
        ) : (
          renderDistribution()
        )}
        {!entry.missing && (installableAgents.length > 0 || removableStates.length > 0) ? (
          <div className="ws-toolbar-foot">
            <span className="section-hint">批量写回：</span>
            {installableAgents.length > 0 ? (
              <Button
                variant="secondary"
                disabled={busy}
                title="为当前 Skill 在所有「可安装」的已检测 Agent 创建软连接（不会改动源目录）"
                onClick={installAll}
              >
                一键装到全部 {installableAgents.length} 个 Agent
              </Button>
            ) : null}
            {removableStates.length > 0 ? (
              <Button
                variant="ghost"
                disabled={busy}
                title="移除当前 Skill 在所有 Agent 上的软连接——只会删除连接，不会删除源目录（源目录始终保留）"
                onClick={uninstallAll}
              >
                全部卸载（{removableStates.length}）
              </Button>
            ) : null}
          </div>
        ) : null}
        <label className="check-line">
          <input
            type="checkbox"
            checked={showAllAgents}
            onChange={(event) => setShowAllAgents(event.target.checked)}
          />
          显示未安装的 Agent（{snapshot.targets.filter((target) => !target.installed).length} 个，
          仅目录残留、PATH 里没有可执行文件）
        </label>
      </section>

      <GovernancePanel controller={controller} entry={entry} />

      <details className="fold">
        <summary className="fold-summary">
          引用与内容哈希
          <span className="panel-count">{entry.refs.length}</span>
        </summary>
        <div className="fold-body">{renderRefs(entry.refs)}</div>
      </details>

      <p className="detail-foot">
        {entries.length} 个 Skill · {counts.links} 条连接 ·{" "}
        {snapshot.targets.filter((target) => target.installed).length} 个 Agent 已安装（PATH
        可见）· {snapshot.targets.filter((target) => target.detected && !target.installed).length}{" "}
        个仅目录残留
      </p>
    </section>
  );
}
