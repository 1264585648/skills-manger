import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  LoaderCircle,
  Square,
  Search,
  RotateCcw,
  X,
} from "lucide-react";
import type { AgentNavigationContext } from "../types/agentCenter";
import type { ApplyOperationRecord } from "../types/bundlePlanner";
import {
  agentCenterService as service,
  commandMessage,
  desktop,
} from "../services/agentCenterService";
import {
  filterSkills,
  sessionView,
  rememberSession,
  scopeKey,
} from "../services/agentWorkspaceState";
import { AgentSelector } from "../components/agents/AgentSelector";
import { ScopeSelector } from "../components/agents/ScopeSelector";
import { SkillList } from "../components/agents/SkillList";
import {
  Drawer,
  Menu,
  InlineError,
  Loading,
} from "../components/agents/Drawer";
import { AddSkillsDrawer } from "../components/agents/AddSkillsDrawer";
import { SkillDetailDrawer } from "../components/agents/SkillDetailDrawer";
import { DirectoryManagerDrawer } from "../components/agents/DirectoryManagerDrawer";
import { OperationHistoryDrawer } from "../components/agents/OperationHistoryDrawer";
import { ImportSkillEditor } from "../components/agents/ImportSkillEditor";
import { useAgentWorkspace } from "../components/agents/useAgentWorkspace";
import "../agents.css";

type Panel =
  | { kind: "add"; ids?: string[]; bundleId?: string }
  | { kind: "update"; ids: string[] }
  | { kind: "detail"; id: string }
  | { kind: "import"; instanceId: string }
  | { kind: "directories"; returnToAdd?: string[] }
  | { kind: "history"; restoreId?: string }
  | { kind: "issues" };
export function AgentsPage({
  initialContext,
  onNavigateToSync,
}: {
  initialContext?: AgentNavigationContext;
  onNavigateToSync?: (context: AgentNavigationContext) => void;
}) {
  const state = useAgentWorkspace(initialContext);
  const { snapshot, view, agentId, scopeId, prefs } = state;
  const [panel, setPanel] = useState<Panel | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [scroll, setScroll] = useState(0),
    [operationBusy, setOperationBusy] = useState(false);
  const [notice, setNotice] = useState<{
      text: string;
      operation?: ApplyOperationRecord;
      refreshFailed?: boolean;
    } | null>(null),
    [highlight, setHighlight] = useState<string[]>([]),
    [initialOpened, setInitialOpened] = useState(false);
  const key = scopeKey(agentId, scopeId),
    sort = prefs.sorts[key] ?? "name";
  useEffect(() => {
    const value = sessionView(key);
    setQuery(value.query);
    setFilter(value.filter);
    setScroll(value.scroll);
    setSelected([]);
  }, [key]);
  useEffect(() => {
    if (
      view &&
      !initialOpened &&
      (initialContext?.openAdd || initialContext?.openHistory)
    ) {
      setInitialOpened(true);
      setPanel(
        initialContext.openHistory
          ? { kind: "history" }
          : view.scopeAvailable === false
            ? {
                kind: "directories",
                returnToAdd: initialContext.skillIds ?? [],
              }
            : {
                kind: "add",
                ids: initialContext.skillIds,
                bundleId: initialContext.bundleId,
              },
      );
    }
  }, [view, initialOpened, initialContext]);
  const items = useMemo(
    () => filterSkills(view?.skills ?? [], query, filter, sort),
    [view, query, filter, sort],
  );
  const changeQuery = (value: string) => {
    setQuery(value);
    setScroll(0);
    rememberSession(key, { query: value, filter, scroll: 0 });
  };
  const changeFilter = (value: string) => {
    setFilter(value);
    setScroll(0);
    rememberSession(key, { query, filter: value, scroll: 0 });
  };
  const reportError = (error: unknown) => state.setError(commandMessage(error));
  const refresh = async () => {
    try {
      if (snapshot?.scan.running) {
        await service.cancel();
        await state.reload();
      } else {
        await state.scan();
      }
    } catch (e) {
      reportError(e);
    }
  };
  const pickProject = async (path?: string) => {
    try {
      const chosen =
        path ?? (await service.pickDirectory("选择需要管理的项目"));
      if (chosen) {
        setSelected([]);
        await state.pickProject(chosen);
      }
    } catch (e) {
      reportError(e);
    }
  };
  const onDone = async (
    operations: ApplyOperationRecord[],
    ids: string[],
    complete: boolean,
  ) => {
    const count = operations.reduce((n, o) => n + o.items.length, 0);
    if (count) {
      setNotice({
        text: `已完成 ${count} 项技能变更`,
        operation: operations.length === 1 ? operations[0] : undefined,
      });
      setHighlight(ids);
      setSelected([]);
      setQuery("");
      setFilter("all");
      setScroll(0);
      rememberSession(key, { query: "", filter: "all", scroll: 0 });
    }
    if (complete) setPanel(null);
    try {
      await service.scan(agentId);
      await state.reload();
    } catch (e) {
      setNotice({
        text: `已完成 ${count} 项技能变更，列表刷新失败`,
        operation: operations.length === 1 ? operations[0] : undefined,
        refreshFailed: true,
      });
    }
  };
  const local =
    snapshot?.detections[agentId]?.status === "installed" ||
    snapshot?.roots.some((r) => r.agentId === agentId && r.canonicalPath);
  const rootIssues =
    snapshot?.roots
      .filter(
        (r) =>
          r.agentId === agentId &&
          view?.scopes.find((s) => s.id === scopeId)?.rootIds.includes(r.id),
      )
      .flatMap((r) => snapshot.rootDetails[r.id]?.diagnostics ?? []) ?? [];
  const close = () => setPanel(null);
  const viewOrEmpty = view ?? {
    agentId,
    scopeId,
    scopes: [],
    targets: [],
    targetId: null,
    skills: [],
    checkedAt: 0,
  };
  return (
    <section className="ux-agents">
      <header className="ux-header">
        {snapshot ? (
          <AgentSelector
            snapshot={snapshot}
            value={agentId}
            onChange={(id) => {
              setSelected([]);
              setPanel(null);
              state.chooseAgent(id);
            }}
          />
        ) : (
          <h1>Agents</h1>
        )}
        <div className="ux-header-actions">
          {snapshot?.scan.running ? (
            <small className="ux-muted" role="status">
              检查中 {snapshot.scan.completed}/{snapshot.scan.total || "…"}
            </small>
          ) : null}
          <button
            className="ux-primary"
            disabled={
              !view ||
              !desktop() ||
              view.scopeAvailable === false ||
              (!local && !view.targets.length)
            }
            onClick={() => setPanel({ kind: "add" })}
          >
            <Plus size={17} />
            添加技能
          </button>
          <button
            className="ux-icon"
            aria-label={snapshot?.scan.running ? "取消检查" : "刷新技能"}
            title={snapshot?.scan.running ? "取消检查" : "刷新技能"}
            disabled={!desktop()}
            onClick={() => void refresh()}
          >
            {snapshot?.scan.running ? (
              <Square size={16} />
            ) : state.loading ? (
              <LoaderCircle className="ac-spin" size={18} />
            ) : (
              <RefreshCw size={18} />
            )}
          </button>
          <Menu label="更多操作">
            <button
              role="menuitem"
              onClick={() => setPanel({ kind: "directories" })}
            >
              管理目录
            </button>
            <button
              role="menuitem"
              onClick={() => setPanel({ kind: "history" })}
            >
              操作记录
            </button>
            <button
              role="menuitem"
              onClick={() => setPanel({ kind: "issues" })}
            >
              查看检查结果
            </button>
          </Menu>
        </div>
      </header>
      <div className="ux-context-row">
        <ScopeSelector
          scopes={
            view?.scopes ?? [
              { id: "user", name: "所有项目", path: null, rootIds: [] },
            ]
          }
          value={scopeId}
          onChange={(id) => {
            setSelected([]);
            state.chooseScope(id);
          }}
          onPickProject={() => void pickProject()}
        />
        {snapshot?.detections[agentId]?.status === "configured" ? (
          <span className="ux-muted">仅发现配置，未确认安装</span>
        ) : null}
        {!desktop() ? <span className="ux-muted">浏览器预览</span> : null}
      </div>
      <InlineError
        message={state.error}
        retry={() => void state.reload().catch(reportError)}
      />
      {view?.scopeAvailable === false ? (
        <div className="ux-context-notice">
          <span>原项目当前不可用，已保留上次结果</span>
          <button className="ux-link" onClick={() => void pickProject()}>
            重新选择项目
          </button>
          <button className="ux-link" onClick={() => state.chooseScope("user")}>
            所有项目
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="ux-result" role="status">
          <span>{notice.text}</span>
          {notice.refreshFailed ? (
            <button
              className="ux-link"
              onClick={() =>
                void state
                  .scan()
                  .then(() =>
                    setNotice((n) =>
                      n
                        ? {
                            ...n,
                            text: n.text.replace("，列表刷新失败", ""),
                            refreshFailed: false,
                          }
                        : null,
                    ),
                  )
                  .catch(reportError)
              }
            >
              重试刷新
            </button>
          ) : null}
          {notice.operation?.canRestore ? (
            <button
              className="ux-link"
              onClick={() =>
                setPanel({ kind: "history", restoreId: notice.operation!.id })
              }
            >
              <RotateCcw size={14} />
              撤销本次变更
            </button>
          ) : (
            <button
              className="ux-link"
              onClick={() => setPanel({ kind: "history" })}
            >
              查看记录
            </button>
          )}
          <button
            className="ux-icon"
            aria-label="关闭结果提示"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {rootIssues.length ? (
        <div className="ux-context-notice">
          <span>有目录尚未完成检查，已保留上次结果</span>
          <button
            className="ux-link"
            onClick={() => setPanel({ kind: "issues" })}
          >
            查看原因
          </button>
        </div>
      ) : null}
      <div className="ux-toolbar">
        <label className="ux-search">
          <Search size={17} />
          <input
            aria-label="搜索技能"
            placeholder="搜索技能名称或简介"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
          />
        </label>
        <div className="ux-filters">
          {[
            ["all", "全部"],
            ["update", "有更新"],
            ["issues", "需处理"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              aria-pressed={filter === id}
              onClick={() => changeFilter(id)}
            >
              {label}
              {id === "update" && view?.skills.some((s) => s.canUpdate) ? (
                <small>{view.skills.filter((s) => s.canUpdate).length}</small>
              ) : null}
            </button>
          ))}
        </div>
        <select
          className="ux-sort"
          aria-label="技能排序"
          value={sort}
          onChange={(e) =>
            void state
              .persist((p) => ({
                ...p,
                sorts: { ...p.sorts, [key]: e.target.value },
              }))
              .catch(reportError)
          }
        >
          <option value="name">按名称</option>
          <option value="recent">最近修改</option>
        </select>
      </div>
      {selected.length ? (
        <div className="ux-batch">
          <span>已选 {selected.length} 项</span>
          <button
            className="ux-link"
            disabled={
              !view?.skills.some((s) => selected.includes(s.id) && s.canUpdate)
            }
            onClick={() =>
              setPanel({
                kind: "update",
                ids: view!.skills
                  .filter((s) => selected.includes(s.id) && s.canUpdate)
                  .map((s) => s.id),
              })
            }
          >
            更新所选
          </button>
          <button className="ux-link" onClick={() => setSelected([])}>
            取消选择
          </button>
        </div>
      ) : filter === "update" && items.length ? (
        <div className="ux-list-caption">
          <span>{items.length} 项有更新</span>
          <button
            className="ux-secondary"
            onClick={() =>
              setPanel({
                kind: "update",
                ids: items.filter((s) => s.canUpdate).map((s) => s.id),
              })
            }
          >
            更新全部
          </button>
        </div>
      ) : (
        <div className="ux-list-caption">
          <span>{items.length} 个技能</span>
          {snapshot?.scan.cancelled ? (
            <span>上次检查未完成</span>
          ) : state.loading && items.length ? (
            <span>正在检查状态</span>
          ) : null}
        </div>
      )}
      {snapshot &&
      !local &&
      !state.loading &&
      !items.length &&
      !view?.targets.length ? (
        <div className="ux-empty ux-first-run">
          <h2>还没有发现这个 Agent</h2>
          <p>可重新发现，或选择已有的技能目录。</p>
          <div className="ux-inline-actions">
            <button
              className="ux-secondary"
              disabled={!desktop()}
              onClick={() => void refresh()}
            >
              重新发现
            </button>
            <button
              className="ux-primary"
              disabled={!desktop()}
              onClick={() => setPanel({ kind: "directories" })}
            >
              选择保存位置
            </button>
          </div>
        </div>
      ) : (
        <SkillList
          items={items}
          selected={selected}
          onSelect={setSelected}
          onDetail={(id) => setPanel({ kind: "detail", id })}
          onUpdate={(ids) => setPanel({ kind: "update", ids })}
          onImport={(id) => {
            const row = view?.skills.find((s) => s.id === id);
            if (row)
              setPanel({ kind: "import", instanceId: row.instanceIds[0] });
          }}
          onLocate={(id) => {
            const row = view?.skills.find((s) => s.id === id);
            if (row)
              void service
                .openSkill(row.instanceIds[0], true)
                .catch(reportError);
          }}
          loading={state.loading}
          scrollKey={`${key}:${filter}`}
          initialScroll={scroll}
          onScroll={(top) =>
            rememberSession(key, { query, filter, scroll: top })
          }
          highlight={highlight}
          filtered={!!query || filter !== "all"}
          emptyAction={
            query || filter !== "all"
              ? () => {
                  changeQuery("");
                  changeFilter("all");
                }
              : desktop() && view?.scopeAvailable !== false
                ? () => setPanel({ kind: "add" })
                : undefined
          }
        />
      )}
      {panel && snapshot ? (
        panel.kind === "add" || panel.kind === "update" ? (
          <AddSkillsDrawer
            key={panel.kind}
            snapshot={snapshot}
            view={viewOrEmpty}
            initialSkillIds={panel.kind === "add" ? panel.ids : undefined}
            managedIds={panel.kind === "update" ? panel.ids : undefined}
            initialBundleId={panel.kind === "add" ? panel.bundleId : undefined}
            mode={panel.kind}
            onClose={close}
            onDone={onDone}
            onRememberTarget={state.rememberTarget}
            onConfigure={(ids) =>
              setPanel({
                kind: "directories",
                returnToAdd: ids,
              })
            }
          />
        ) : panel.kind === "directories" ? (
          <DirectoryManagerDrawer
            snapshot={snapshot}
            view={viewOrEmpty}
            onClose={() =>
              setPanel(
                panel.returnToAdd
                  ? { kind: "add", ids: panel.returnToAdd }
                  : null,
              )
            }
            onRefresh={state.reload}
            onTarget={state.rememberTarget}
            onProject={pickProject}
          />
        ) : panel.kind === "history" ? (
          <OperationHistoryDrawer
            snapshot={snapshot}
            view={viewOrEmpty}
            initialRestoreId={panel.restoreId}
            onClose={close}
            onRestored={async () => {
              setNotice({ text: "已恢复安装前的内容" });
              await state.scan();
            }}
          />
        ) : panel.kind === "detail" ? (
          <SkillDetailDrawer
            skill={view?.skills.find((s) => s.id === panel.id) ?? null}
            onClose={close}
            onUpdate={(ids) => setPanel({ kind: "update", ids })}
            onImport={(instanceId) => setPanel({ kind: "import", instanceId })}
            onRescan={state.scan}
            onAdvanced={() => {
              const row = view?.skills.find((s) => s.id === panel.id);
              if (row && row.libraryId)
                onNavigateToSync?.({
                  agentId,
                  scopeId,
                  rootId: row.rootIds[0],
                  skillIds: [row.libraryId],
                  managedIds: [row.id],
                });
            }}
          />
        ) : panel.kind === "import" ? (
          <Drawer title="加入技能库" onClose={close} busy={operationBusy}>
            <ImportSkillEditor
              instanceId={panel.instanceId}
              onBusy={setOperationBusy}
              onCancel={close}
              onImported={() => {
                setPanel(null);
                setNotice({ text: "已加入技能库" });
                void state.reload().catch(reportError);
              }}
            />
          </Drawer>
        ) : (
          <Drawer title="检查结果" onClose={close}>
            <section className="ux-settings-section">
              <h3>目录检查</h3>
              {rootIssues.length ? (
                rootIssues.map((d, i) => (
                  <div className="ux-problem" key={i}>
                    <p>{d.message}</p>
                    <details>
                      <summary>技术详情</summary>
                      <code>{d.path}</code>
                      <p>{d.suggestion}</p>
                    </details>
                  </div>
                ))
              ) : (
                <p className="ux-muted">没有目录检查问题</p>
              )}
              <button
                className="ux-link"
                onClick={() => setPanel({ kind: "directories" })}
              >
                管理目录
              </button>
            </section>
            <section className="ux-settings-section">
              <h3>技能检查</h3>
              {view?.skills
                .filter((s) => s.state === "issue" || s.state === "unverified")
                .map((s) => (
                  <button
                    className="ux-problem-link"
                    key={s.id}
                    onClick={() => setPanel({ kind: "detail", id: s.id })}
                  >
                    {s.name}
                    <span>处理</span>
                  </button>
                ))}
            </section>
          </Drawer>
        )
      ) : null}
    </section>
  );
}
