import { Button, Modal } from "./ui";
import { IconFolder } from "./icons";
import type { WorkspaceController } from "../hooks/useWorkspace";
import { displayPath } from "../types/domain";

interface Props {
  open: boolean;
  onClose: () => void;
  controller: WorkspaceController;
}

export function DirectoryModal({ open, onClose, controller }: Props) {
  const {
    snapshot,
    catalog,
    agentName,
    busy,
    pickedPath,
    pickedAgentId,
    setPickedAgentId,
    pickDirectory,
    addRoot,
    removeRoot,
    uniqueWarnings,
  } = controller;

  return (
    <Modal open={open} onClose={onClose} title="登记目录与环境管理">
      <div className="directory-modal-content">
        <section className="modal-sub-section">
          <h4>添加项目 Skills 目录</h4>
          <p className="modal-sub-tip">
            选择你本地仓库中的 skills 目录并绑定目标 Agent，系统将自动扫描其中的 SKILL.md
            并在本地库建档。
          </p>

          <div className="root-add-card">
            <div className="root-add-row">
              <Button onClick={() => void pickDirectory()} disabled={busy}>
                <IconFolder style={{ marginRight: 6 }} />
                {pickedPath ? "重新选择…" : "选择本地目录…"}
              </Button>
              <select
                className="select-custom"
                aria-label="目标 Agent"
                value={pickedAgentId}
                onChange={(event) => setPickedAgentId(event.target.value)}
              >
                {catalog.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}（{agent.projectRoots.join(" / ")}）
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                onClick={() => {
                  void addRoot();
                }}
                disabled={busy || !pickedPath}
              >
                登记并扫描
              </Button>
            </div>
            {pickedPath ? (
              <p className="root-picked-path">已选目录: <code>{displayPath(pickedPath)}</code></p>
            ) : null}
          </div>
        </section>

        <section className="modal-sub-section">
          <h4>已登记的目录 ({snapshot.roots.length})</h4>
          <div className="registered-roots-list">
            {snapshot.roots.length === 0 ? (
              <p className="muted-empty">尚未登记任何自定义目录，默认仅扫描 Agent 用户目录。</p>
            ) : (
              snapshot.roots.map((root) => (
                <div key={root.id} className="root-card-item">
                  <div className="root-card-main">
                    <div className="root-card-header">
                      <strong>{agentName(root.agentId)}</strong>
                      <span className="root-badge">{root.scope === "user" ? "用户全局" : "项目"}</span>
                      {root.isDefault ? <span className="root-badge badge-default">默认目录</span> : null}
                    </div>
                    <code className="root-card-path" title={displayPath(root.configuredPath)}>
                      {displayPath(root.configuredPath)}
                    </code>
                  </div>
                  {!root.isDefault ? (
                    <Button
                      variant="ghost"
                      className="button-danger"
                      title="移除该登记，源目录不受影响"
                      onClick={() => void removeRoot(root)}
                      disabled={busy}
                    >
                      移除
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        {uniqueWarnings.length > 0 ? (
          <section className="modal-sub-section">
            <h4>扫描告警 ({uniqueWarnings.length})</h4>
            <div className="modal-warnings-box">
              {uniqueWarnings.map((warning) => (
                <div key={warning} className="warning-line">
                  <span className="warning-bullet">⚠</span>
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
