import { useState } from "react";
import { Copy, FolderOpen, FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import type {
  AgentCenterSnapshot,
  ManagementView,
} from "../../types/agentCenter";
import {
  agentCenterService as service,
  commandMessage,
  desktop,
} from "../../services/agentCenterService";
import { Drawer, InlineError } from "./Drawer";

export function DirectoryManagerDrawer({
  snapshot,
  view,
  onClose,
  onRefresh,
  onTarget,
  onProject,
}: {
  snapshot: AgentCenterSnapshot;
  view: ManagementView;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onTarget: (id: string) => Promise<void>;
  onProject: (path: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    [overrides, setOverrides] = useState<Record<string, boolean>>({}),
    [copied, setCopied] = useState<string | null>(null);
  const roots = snapshot.roots.filter((r) => r.agentId === view.agentId);
  const scope = view.scopes.find((s) => s.id === view.scopeId);
  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError(commandMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const copy = async (id: string, path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(id);
    } catch {
      setError("复制失败，可选中路径后复制");
    }
  };
  const addRoot = () =>
    run("add", async () => {
      const path = await service.pickDirectory("选择 Skills 保存目录");
      if (path) {
        const root = await service.registerRoot(
          view.agentId,
          path,
          view.scopeId === "user" ? "user" : "project",
        );
        await onTarget(root.id);
        await service.scan(view.agentId);
      }
    });
  return (
    <Drawer
      title="管理目录"
      subtitle={snapshot.catalog.find((a) => a.id === view.agentId)?.name}
      onClose={onClose}
      busy={!!busy}
    >
      <InlineError message={error} />
      {view.scopeAvailable === false ? (
        <div className="ux-warning">
          原项目不可用，请先重新选择项目。
          <button
            className="ux-link"
            onClick={() =>
              void run("project", async () => {
                const path = await service.pickDirectory("重新选择项目");
                if (path) await onProject(path);
              })
            }
          >
            重新选择项目
          </button>
        </div>
      ) : null}
      <section className="ux-settings-section">
        <h3>默认保存位置</h3>
        {view.targets.length ? (
          <select
            aria-label="默认保存位置"
            value={view.targetId ?? ""}
            disabled={!!busy}
            onChange={(e) => void run("target", () => onTarget(e.target.value))}
          >
            <option value="" disabled>
              请选择保存位置
            </option>
            {view.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.path}
                {t.recommended ? "（推荐）" : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="ux-muted">当前范围还没有可写位置</p>
        )}
        <div className="ux-inline-actions">
          <button
            className="ux-secondary"
            disabled={
              !!busy || !desktop() || !scope || view.scopeAvailable === false
            }
            onClick={() =>
              void run("preferred", async () => {
                const root = await service.preferredRoot(
                  view.agentId,
                  scope?.path ?? null,
                );
                await onTarget(root.id);
              })
            }
          >
            使用产品默认位置
          </button>
          <button
            className="ux-secondary"
            disabled={!!busy || !desktop()}
            onClick={() => void addRoot()}
          >
            <FolderPlus size={15} />
            选择其他目录
          </button>
        </div>
      </section>
      <section className="ux-settings-section">
        <h3>
          扫描目录 <small>{roots.length}</small>
        </h3>
        {roots.map((root) => {
          const info = snapshot.rootDetails[root.id];
          return (
            <div className="ux-directory-row" key={root.id}>
              <div>
                <strong>
                  {root.scope === "user"
                    ? "所有项目"
                    : (view.scopes.find((s) => s.rootIds.includes(root.id))
                        ?.name ?? "项目")}
                </strong>
                <span className="ux-muted">
                  {info?.source === "plugin"
                    ? "插件只读"
                    : info?.source === "system"
                      ? "系统只读"
                      : info?.source === "shared"
                        ? "共享目录"
                        : ""}
                </span>
                <label className="ux-scan-toggle">
                  <input
                    aria-label={`扫描 ${root.configuredPath}`}
                    type="checkbox"
                    checked={overrides[root.id] ?? root.enabled}
                    disabled={busy === root.id || snapshot.scan.running}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setOverrides((v) => ({ ...v, [root.id]: enabled }));
                      void run(root.id, async () => {
                        try {
                          await service.toggleRoot(root.id, enabled);
                        } catch (e) {
                          setOverrides((v) => ({
                            ...v,
                            [root.id]: root.enabled,
                          }));
                          throw e;
                        }
                      });
                    }}
                  />
                  扫描
                </label>
              </div>
              <code>{root.configuredPath}</code>
              <div className="ux-directory-actions">
                <button
                  className="ux-icon"
                  title={copied === root.id ? "已复制" : "复制路径"}
                  aria-label={`复制 ${root.configuredPath}`}
                  onClick={() => void copy(root.id, root.configuredPath)}
                >
                  <Copy size={15} />
                </button>
                <button
                  className="ux-icon"
                  title="定位目录"
                  aria-label={`定位 ${root.configuredPath}`}
                  onClick={() =>
                    void run(root.id, () =>
                      service.openRoot(
                        root.id,
                        info?.status === "absent" ||
                          info?.status === "unavailable",
                      ),
                    )
                  }
                >
                  <FolderOpen size={15} />
                </button>
                <button
                  className="ux-icon"
                  title="重新扫描"
                  aria-label={`重扫 ${root.configuredPath}`}
                  disabled={snapshot.scan.running || !root.enabled}
                  onClick={() =>
                    void run(root.id, () => service.scan(undefined, root.id))
                  }
                >
                  <RefreshCw size={15} />
                </button>
                {info?.writable ? (
                  <button
                    className="ux-link"
                    onClick={() =>
                      void run(root.id, async () => {
                        const path =
                          await service.pickDirectory("重新选择扫描目录");
                        if (path) {
                          const replacement = await service.relocate(
                            root.id,
                            path,
                          );
                          await onTarget(replacement.id);
                          await service.scan(view.agentId);
                        }
                      })
                    }
                  >
                    重新选择位置
                  </button>
                ) : null}
              </div>
              {info?.status === "partial" || info?.status === "unavailable" ? (
                <span className="ux-warning">部分内容尚未完成检查</span>
              ) : null}
            </div>
          );
        })}
      </section>
      <details className="ux-settings-section">
        <summary>项目区与扫描深度</summary>
        <p className="ux-muted">项目区配置影响所有 Agent。</p>
        <button
          className="ux-secondary"
          disabled={!!busy || !desktop()}
          onClick={() =>
            void run("area", async () => {
              const path = await service.pickDirectory("选择项目父目录");
              if (path) {
                await service.saveProject(path);
                await service.scan();
              }
            })
          }
        >
          <FolderPlus size={15} />
          添加项目区
        </button>
        {snapshot.projects.map((project) => (
          <div className="ux-project-row" key={project.id}>
            <code>{project.path}</code>
            <div>
              <label>
                深度
                <input
                  aria-label={`${project.path} 扫描深度`}
                  type="number"
                  min={1}
                  max={12}
                  defaultValue={project.maxDepth}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value !== project.maxDepth)
                      void run(project.id, () =>
                        service.saveProject(
                          project.path,
                          value,
                          project.enabled,
                        ),
                      );
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={project.enabled}
                  onChange={(e) =>
                    void run(project.id, () =>
                      service.saveProject(
                        project.path,
                        project.maxDepth,
                        e.target.checked,
                      ),
                    )
                  }
                />
                启用
              </label>
              <button
                className="ux-icon"
                aria-label={`移除项目区 ${project.path}`}
                onClick={() =>
                  void run(project.id, () => service.removeProject(project.id))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            {snapshot.projectDiagnostics[project.id]?.map((d, i) => (
              <p className="ux-warning" key={i}>
                {d.message}
              </p>
            ))}
          </div>
        ))}
        <button
          className="ux-link"
          onClick={() =>
            void run("project", async () => {
              const path = await service.pickDirectory("选择需要管理的项目");
              if (path) await onProject(path);
            })
          }
        >
          选择单个项目
        </button>
      </details>
    </Drawer>
  );
}
