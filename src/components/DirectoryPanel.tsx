import { Button } from "./ui";
import type { WorkspaceController } from "../hooks/useWorkspace";
import { displayPath } from "../types/domain";

interface Props {
  controller: WorkspaceController;
}

/** 登记的目录 + 扫描告警：都属于「环境配置」，收在列表底部，默认折叠。 */
export function DirectoryPanel({ controller }: Props) {
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
    <>
      <details className="fold">
        <summary className="fold-summary">
          登记的目录
          <span className="panel-count">{snapshot.roots.length}</span>
        </summary>
        <div className="fold-body">
          {snapshot.roots.length === 0 ? (
            <p className="muted-help">尚未登记任何目录，默认用户目录不存在时会静默跳过。</p>
          ) : (
            <ul className="root-list">
              {snapshot.roots.map((root) => (
                <li key={root.id}>
                  <span className="root-main">
                    <span className="root-heading">
                      <strong>{agentName(root.agentId)}</strong>
                      <span className="root-scope">{root.scope === "user" ? "用户" : "项目"}</span>
                      {root.isDefault ? <span className="root-scope">默认</span> : null}
                    </span>
                    <code title={displayPath(root.configuredPath)}>
                      {displayPath(root.configuredPath)}
                    </code>
                  </span>
                  {!root.isDefault ? (
                    <Button onClick={() => void removeRoot(root)} disabled={busy}>
                      移除
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="root-add">
            <span className="section-label">添加项目 Skills 目录</span>
            <div className="root-add-controls">
              <Button onClick={() => void pickDirectory()} disabled={busy}>
                {pickedPath ? "重新选择…" : "选择目录…"}
              </Button>
              <select
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
              <Button variant="primary" onClick={addRoot} disabled={busy || !pickedPath}>
                登记并扫描
              </Button>
            </div>
            {pickedPath ? (
              <p className="root-add-path mono-cell">已选：{displayPath(pickedPath)}</p>
            ) : null}
          </div>
        </div>
      </details>

      {uniqueWarnings.length > 0 ? (
        <details className="fold">
          <summary className="fold-summary">
            扫描告警
            <span className="panel-count">{uniqueWarnings.length}</span>
          </summary>
          <div className="fold-body">
            <ul className="warning-list-flat">
              {uniqueWarnings.slice(0, 12).map((warning) => (
                <li key={warning} title={warning}>
                  {warning}
                </li>
              ))}
            </ul>
            {uniqueWarnings.length > 12 ? (
              <p className="muted-help">还有 {uniqueWarnings.length - 12} 条同类告警未显示。</p>
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
}
