import { Modal, StatusPill } from "./ui";
import type { WorkspaceController } from "../hooks/useWorkspace";

interface Props {
  open: boolean;
  onClose: () => void;
  controller: WorkspaceController;
}

export function AgentMatrixModal({ open, onClose, controller }: Props) {
  const { catalog, snapshot } = controller;

  // Map agentId to installed target info and links count
  const targetMap = new Map(snapshot.targets.map((t) => [t.id, t]));
  const linkCountByAgent = new Map<string, number>();

  for (const link of snapshot.links) {
    const root = snapshot.roots.find((r) => r.id === link.targetRootId);
    if (root) {
      linkCountByAgent.set(root.agentId, (linkCountByAgent.get(root.agentId) ?? 0) + 1);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Agent 矩阵与探测状态">
      <div className="agent-matrix-intro">
        <p>
          本工具支持 15 个主流 AI Coding Agent。系统会自动探测本机 PATH 与用户目录，支持将
          Skill 通过 Windows Junction 原生软连接安全分发至目标 Agent。
        </p>
      </div>

      <div className="agent-matrix-grid">
        {catalog.map((agent) => {
          const target = targetMap.get(agent.id);
          const isInstalled = target?.installed ?? false;
          const isDetected = target?.detected ?? false;
          const links = linkCountByAgent.get(agent.id) ?? 0;

          return (
            <div
              key={agent.id}
              className={`agent-card ${isInstalled ? "agent-card-installed" : isDetected ? "agent-card-detected" : ""}`}
            >
              <div className="agent-card-head">
                <div className="agent-avatar">
                  {agent.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="agent-info">
                  <strong>{agent.name}</strong>
                  <span className="agent-provider">{agent.provider}</span>
                </div>
                <div className="agent-status-badge">
                  {isInstalled ? (
                    <StatusPill tone="green">PATH 已安装</StatusPill>
                  ) : isDetected ? (
                    <StatusPill tone="amber">目录残留</StatusPill>
                  ) : (
                    <StatusPill tone="gray">未安装</StatusPill>
                  )}
                </div>
              </div>

              <div className="agent-card-body">
                <div className="agent-meta-line">
                  <span className="meta-label">可执行文件:</span>
                  <code title={target?.executablePath ?? "PATH 未检测到"}>
                    {target?.executablePath ? target.executablePath.split(/[\/\\]/).pop() : "未在 PATH 中"}
                  </code>
                </div>
                <div className="agent-meta-line">
                  <span className="meta-label">项目目录约定:</span>
                  <code title={agent.projectRoots.join(" / ")}>
                    {agent.projectRoots[0] || "-"}
                  </code>
                </div>
                <div className="agent-meta-line">
                  <span className="meta-label">分发软连接:</span>
                  <span className="meta-value">{links > 0 ? `${links} 条已建立` : "0"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
