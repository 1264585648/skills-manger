import {
  IconSkill,
  IconAlert,
  IconAgents,
  IconFolder,
  IconGovernance,
  IconRefresh,
} from "./icons";
import type { WorkspaceController } from "../hooks/useWorkspace";

interface Props {
  controller: WorkspaceController;
  onOpenAgentsModal: () => void;
  onOpenDirectoriesModal: () => void;
}

export function AppNavRail({
  controller,
  onOpenAgentsModal,
  onOpenDirectoriesModal,
}: Props) {
  const {
    counts,
    filterKey,
    setFilterKey,
    snapshot,
    catalog,
    loading,
    busy,
    reload,
  } = controller;

  const installedAgentsCount = snapshot.targets.filter((t) => t.installed).length;

  return (
    <aside className="app-nav-rail">
      <div className="nav-brand">
        <div className="nav-brand-logo">
          <span className="nav-brand-icon">✦</span>
        </div>
        <div className="nav-brand-info">
          <strong className="nav-brand-title">Skills Hub</strong>
          <span className="nav-brand-tag">Local-First</span>
        </div>
      </div>

      <nav className="nav-section">
        <span className="nav-section-title">技能管理</span>

        <button
          type="button"
          className={`nav-item ${filterKey === "all" ? "nav-item-active" : ""}`}
          onClick={() => setFilterKey("all")}
        >
          <IconSkill className="nav-item-icon" />
          <span className="nav-item-label">全部技能</span>
          <span className="nav-item-badge">{counts.all}</span>
        </button>

        <button
          type="button"
          className={`nav-item ${filterKey === "attention" ? "nav-item-active nav-item-attention" : ""}`}
          onClick={() => setFilterKey("attention")}
        >
          <IconAlert className="nav-item-icon text-amber" />
          <span className="nav-item-label">需处理</span>
          {counts.attention > 0 ? (
            <span className="nav-item-badge badge-amber">{counts.attention}</span>
          ) : (
            <span className="nav-item-badge badge-muted">0</span>
          )}
        </button>

        <button
          type="button"
          className={`nav-item ${filterKey === "ungoverned" ? "nav-item-active" : ""}`}
          onClick={() => setFilterKey("ungoverned")}
        >
          <IconGovernance className="nav-item-icon text-blue" />
          <span className="nav-item-label">未治理</span>
          {counts.ungoverned > 0 ? (
            <span className="nav-item-badge badge-blue">{counts.ungoverned}</span>
          ) : (
            <span className="nav-item-badge badge-muted">0</span>
          )}
        </button>
      </nav>

      <nav className="nav-section">
        <span className="nav-section-title">环境与分发</span>

        <button
          type="button"
          className="nav-item"
          onClick={onOpenAgentsModal}
          title="查看本机 15 个受支持 Agent 的环境探测与就绪状态"
        >
          <IconAgents className="nav-item-icon" />
          <span className="nav-item-label">Agent 矩阵</span>
          <span className="nav-item-badge" title={`${installedAgentsCount} 个已安装 / ${catalog.length} 个支持`}>
            {installedAgentsCount}/{catalog.length}
          </span>
        </button>

        <button
          type="button"
          className="nav-item"
          onClick={onOpenDirectoriesModal}
          title="管理已登记的项目 Skills 目录"
        >
          <IconFolder className="nav-item-icon" />
          <span className="nav-item-label">登记目录</span>
          <span className="nav-item-badge">{snapshot.roots.length}</span>
        </button>
      </nav>

      <div className="nav-footer">
        <div className="nav-status-card">
          <div className="status-row">
            <span className="status-dot status-dot-live" />
            <span className="status-label">SQLite Local</span>
            <span className="status-meta">{counts.links} 软连接</span>
          </div>
          <p className="status-tip">单点事实来源 · 零副本写回</p>
        </div>

        <button
          type="button"
          className="nav-refresh-button"
          disabled={busy || loading}
          onClick={() => void reload(true)}
          title="只读扫描所有已登记目录"
        >
          <IconRefresh className={`nav-refresh-icon ${loading ? "icon-spin" : ""}`} />
          <span>{loading ? "扫描中…" : "重新扫描"}</span>
        </button>
      </div>
    </aside>
  );
}
