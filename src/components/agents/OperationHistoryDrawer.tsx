import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type {
  AgentCenterSnapshot,
  ManagementView,
} from "../../types/agentCenter";
import type { ApplyOperationRecord } from "../../types/bundlePlanner";
import {
  agentCenterService as service,
  commandMessage,
} from "../../services/agentCenterService";
import { workspaceService } from "../../services/workspaceService";
import { formatTimestamp } from "../../services/formatTimestamp";
import { Drawer, InlineError, Loading } from "./Drawer";
const normalize = (path: string) =>
  path
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
export function OperationHistoryDrawer({
  snapshot,
  view,
  onClose,
  onRestored,
  initialRestoreId,
}: {
  snapshot: AgentCenterSnapshot;
  view: ManagementView;
  onClose: () => void;
  onRestored: () => Promise<void>;
  initialRestoreId?: string;
}) {
  const [items, setItems] = useState<ApplyOperationRecord[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [restoreId, setRestoreId] = useState(initialRestoreId ?? null),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setItems(await workspaceService.getApplyOperations());
    } catch (e) {
      setError(commandMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const roots = snapshot.roots.filter((r) => r.agentId === view.agentId);
  const operations = items.filter((o) =>
    o.items.some((i) =>
      roots.some((r) =>
        normalize(i.destinationPath).startsWith(
          normalize(r.canonicalPath ?? r.configuredPath) + "/",
        ),
      ),
    ),
  );
  const restore = async () => {
    if (!restoreId) return;
    setBusy(true);
    setError(null);
    try {
      await service.restore(restoreId);
      setRestoreId(null);
      await load();
      await onRestored();
    } catch (e) {
      setError(commandMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      title="操作记录"
      subtitle={snapshot.catalog.find((a) => a.id === view.agentId)?.name}
      onClose={onClose}
      busy={busy}
    >
      <InlineError message={error} retry={() => void load()} />
      {restoreId ? (
        <section className="ux-restore-confirm">
          <h3>恢复安装前的内容</h3>
          <p>
            将撤销这次操作的{" "}
            {items.find((o) => o.id === restoreId)?.items.length ?? "全部"}{" "}
            项变更。之后修改过的文件将停止恢复并保留。
          </p>
          <div className="ux-inline-actions">
            <button
              className="ux-secondary"
              disabled={busy}
              onClick={() => setRestoreId(null)}
            >
              取消
            </button>
            <button
              className="ux-primary"
              disabled={busy}
              onClick={() => void restore()}
            >
              {busy ? "正在恢复" : "确认恢复"}
            </button>
          </div>
        </section>
      ) : null}
      {loading ? (
        <Loading />
      ) : operations.length ? (
        operations.map((operation) => (
          <article className="ux-operation" key={operation.id}>
            <header>
              <strong>
                {operation.status === "succeeded"
                  ? "已完成"
                  : operation.status === "rolled_back"
                    ? "已恢复"
                    : operation.status === "running"
                      ? "执行中"
                      : "需要处理"}
              </strong>
              <time>{formatTimestamp(operation.startedAt)}</time>
            </header>
            <p>
              {operation.items
                .map((i) => i.destinationPath.split(/[\\/]/).at(-1))
                .join("、")}
            </p>
            <details><summary>文件与备份位置</summary>{operation.items.map(item=><div className="ux-plan-group" key={item.position}><code>{item.destinationPath}</code>{item.snapshotPath?<p className="ux-muted">备份：<code>{item.snapshotPath}</code></p>:null}</div>)}</details>
            {operation.status === "succeeded" ? (
              <small
                className={
                  operation.backupState === "missing"
                    ? "ux-warning"
                    : "ux-muted"
                }
              >
                {operation.backupState === "available"
                  ? "覆盖备份可用"
                  : operation.backupState === "missing"
                    ? "备份文件已不可用"
                    : "新增技能，无覆盖备份"}
              </small>
            ) : null}
            {operation.error ? (
              <details>
                <summary>查看未完成原因</summary>
                <p>{operation.error}</p>
              </details>
            ) : null}
            {operation.canRestore ? (
              <button
                className="ux-link"
                disabled={busy}
                onClick={() => setRestoreId(operation.id)}
              >
                <RotateCcw size={15} />
                恢复这 {operation.items.length} 项变更
              </button>
            ) : operation.status === "succeeded" &&
              operation.backupState !== "missing" ? (
              <small className="ux-muted">此记录缺少完整恢复信息</small>
            ) : null}
          </article>
        ))
      ) : (
        <div className="ux-empty">
          <h3>暂无操作记录</h3>
        </div>
      )}
    </Drawer>
  );
}
