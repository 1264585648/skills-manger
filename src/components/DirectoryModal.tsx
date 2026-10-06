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
    onPathChange,
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
            直接粘贴本地项目仓库中的 skills 目录路径，或点击「浏览」进行选择，系统将自动扫描其中的 SKILL.md 并在本地库建档。
          </p>

          <div className="root-add-card">
            <div className="root-add-row-stacked">
              <div className="root-path-input-group">
                <input
                  className="input-custom root-path-input"
                  value={pickedPath ?? ""}
                  onChange={(e) => onPathChange(e.target.value)}
                  placeholder="在此直接粘贴或输入目录路径（如 D:\my-repo\.agents\skills）…"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addRoot();
                  }}
                />
                <Button onClick={() => void pickDirectory()} disabled={busy} title="打开系统资源管理器选择文件夹">
                  <IconFolder style={{ marginRight: 6 }} />
                  浏览…
                </Button>
              </div>

              <div className="root-bind-actions-group">
                <span className="root-bind-label">绑定目标 Agent:</span>
                <select
                  className="select-custom root-agent-select"
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
                  disabled={busy}
                >
                  登记并扫描
                </Button>
              </div>
            </div>
            {pickedPath ? (
              <p className="root-picked-path">规范化预览: <code>{displayPath(pickedPath)}</code></p>
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
