import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, LoaderCircle, Search } from "lucide-react";
import {
  agentCenterService as service,
  commandMessage,
} from "../../services/agentCenterService";
import { workspaceService } from "../../services/workspaceService";
import type {
  AgentCenterSnapshot,
  AgentInstallPlan,
  ManagementView,
} from "../../types/agentCenter";
import type {
  ApplyOperationRecord,
  BundleRecord,
} from "../../types/bundlePlanner";
import type { Skill } from "../../types/domain";
import { Drawer, InlineError, Loading } from "./Drawer";
import { ImportSkillEditor } from "./ImportSkillEditor";
import { PlanReview } from "./PlanReview";

export function AddSkillsDrawer({
  snapshot,
  view,
  initialSkillIds = [],
  managedIds = [],
  mode = "add",
  initialBundleId,
  onClose,
  onDone,
  onRememberTarget,
  onConfigure,
}: {
  snapshot: AgentCenterSnapshot;
  view: ManagementView;
  initialSkillIds?: string[];
  managedIds?: string[];
  mode?: "add" | "update";
  initialBundleId?: string;
  onClose: () => void;
  onDone: (
    operations: ApplyOperationRecord[],
    skillIds: string[],
    complete: boolean,
  ) => Promise<void>;
  onRememberTarget: (id: string) => Promise<void>;
  onConfigure: (selected: string[]) => void;
}) {
  const [library, setLibrary] = useState<Skill[]>([]),
    [bundles, setBundles] = useState<BundleRecord[]>([]),
    [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(initialSkillIds),
    [updates, setUpdates] = useState(managedIds),
    [target, setTarget] = useState(view.targetId ?? ""),
    [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{
      key: string;
      plans: AgentInstallPlan[];
    } | null>(null),
    [revision, setRevision] = useState(0),
    [checking, setChecking] = useState(false),
    [error, setError] = useState<string | null>(null),
    [reviewed, setReviewed] = useState(false),
    [executing, setExecuting] = useState(false),
    [importing, setImporting] = useState(false),
    [importPath, setImportPath] = useState<string | null>(null),
    [result, setResult] = useState<string | null>(null);
  const sequence = useRef(0);
  const reviewElement = useRef<HTMLDivElement>(null);
  const duplicateNames = useMemo(() => {
    const result = new Map<string, number>();
    library.forEach((s) => result.set(s.name, (result.get(s.name) ?? 0) + 1));
    return result;
  }, [library]);
  const localCounter = useRef(0);
  const scope = view.scopes.find((s) => s.id === view.scopeId);
  const agentName =
    snapshot.catalog.find((a) => a.id === view.agentId)?.name ?? view.agentId;
  const loadLibrary = async () => {
    const [skills, items] = await Promise.all([
      workspaceService.getSkills(),
      workspaceService.getBundleRecords(),
    ]);
    setLibrary(skills.filter((s) => !s.id.startsWith("instance:")));
    setBundles(items);
    return items;
  };
  useEffect(() => {
    let active = true;
    void Promise.all([
      workspaceService.getSkills(),
      workspaceService.getBundleRecords(),
    ])
      .then(([skills, items]) => {
        if (active) {
          setLibrary(skills.filter((s) => !s.id.startsWith("instance:")));
          setBundles(items);
          if (initialBundleId)
            setSelected(
              items
                .find((b) => b.id === initialBundleId)
                ?.items.map((i) => i.skillId) ?? initialSkillIds,
            );
        }
      })
      .catch((e) => active && setError(commandMessage(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);
  const requestKey = useMemo(
    () =>
      JSON.stringify([
        mode,
        view.agentId,
        view.scopeId,
        target,
        [...selected].sort(),
        [...updates].sort(),
        revision,
      ]),
    [mode, view.agentId, view.scopeId, target, selected, updates, revision],
  );
  const ready = preview?.key === requestKey;
  const plans = ready ? preview.plans : [];
  useEffect(() => {
    const id = ++sequence.current;
    setReviewed(false);
    setError(null);
    setChecking(true);
    if (
      importPath ||
      (mode === "add" && (!selected.length || !target)) ||
      (mode === "update" && !updates.length)
    ) {
      setChecking(false);
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void (
        mode === "update"
          ? service.updates(view.agentId, view.scopeId, updates)
          : service.preview(selected, [target])
      )
        .then((plans) => {
          if (id === sequence.current) setPreview({ key: requestKey, plans });
        })
        .catch((e) => {
          if (id === sequence.current) setError(commandMessage(e));
        })
        .finally(() => {
          if (id === sequence.current) setChecking(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [requestKey, importPath]);
  const dangerous = plans.some(
    (p) =>
      p.items.some((i) => i.action === "update") || p.affectedAgents.length > 1,
  );
  const changes = plans
    .flatMap((p) => p.items)
    .filter((i) => i.action !== "unchanged").length;
  const canConfirm =
    !executing &&
    !importing &&
    !checking &&
    ready &&
    changes > 0 &&
    (!dangerous || reviewed) &&
    !plans.some((p) => p.items.some((i) => i.action === "conflict"));
  const execute = async () => {
    if (!canConfirm || localCounter.current) return;
    localCounter.current++;
    setExecuting(true);
    setError(null);
    const operations: ApplyOperationRecord[] = [];
    const failures: string[] = [];
    for (const plan of plans.filter((p) => p.requiresConfirmation)) {
      try {
        operations.push(await service.apply(plan.id));
      } catch (e) {
        failures.push(commandMessage(e));
      }
    }
    const completedIds = operations.flatMap((o) =>
      o.items.map((i) => i.skillId),
    );
    try {
      await onDone(operations, completedIds, failures.length === 0);
    } catch (e) {
      failures.push(`文件操作已完成，但列表刷新失败：${commandMessage(e)}`);
    }
    if (failures.length) {
      setResult(
        `已完成 ${operations.reduce((n, o) => n + o.items.length, 0)} 项，剩余操作未完成`,
      );
      setError(failures.join("；"));
      setUpdates((ids) =>
        ids.filter(
          (id) =>
            !operations.some((o) =>
              o.items.some(
                (item) =>
                  view.skills.find((s) => s.id === id)?.libraryId ===
                    item.skillId &&
                  view.skills
                    .find((s) => s.id === id)
                    ?.rootIds.some(
                      (root) =>
                        plans.find((p) => p.id === o.planId)?.rootId === root,
                    ),
              ),
            ),
        ),
      );
      setPreview(null);
    }
    setExecuting(false);
    localCounter.current = 0;
  };
  const rememberTarget = async (id: string) => {
    setTarget(id);
    try {
      await onRememberTarget(id);
    } catch (e) {
      setError(`本次位置已选择，但偏好保存失败：${commandMessage(e)}`);
    }
  };
  const pickImport = async () => {
    try {
      const path = await service.pickDirectory("选择包含 SKILL.md 的技能目录");
      if (path) setImportPath(path);
    } catch (e) {
      setError(commandMessage(e));
    }
  };
  const footer = importPath ? undefined : (
    <>
      <div className="ux-footer-status">
        {checking ? (
          <>
            <LoaderCircle className="ac-spin" size={15} />
            正在检查变更
          </>
        ) : !target && mode === "add" ? (
          "请选择保存位置"
        ) : !selected.length && mode === "add" ? (
          "选择需要添加的技能"
        ) : dangerous && !reviewed ? (
          <button
            className="ux-link"
            onClick={() => {
              const details = reviewElement.current?.querySelector("details");
              if (details) details.open = true;
              reviewElement.current?.scrollIntoView({ block: "nearest" });
            }}
          >
            查看覆盖与共享影响
          </button>
        ) : ready && !changes ? (
          "内容已是最新"
        ) : (
          "确认后执行，覆盖前保留备份"
        )}
      </div>
      <button
        className="ux-primary"
        disabled={!canConfirm}
        onClick={() => void execute()}
      >
        {executing ? <LoaderCircle className="ac-spin" size={16} /> : null}
        {executing
          ? "正在执行"
          : mode === "update"
            ? `确认更新${changes ? ` ${changes} 项` : ""}`
            : `确认添加${changes ? ` ${changes} 项` : ""}`}
      </button>
    </>
  );
  return (
    <Drawer
      title={mode === "update" ? "更新技能" : "添加技能"}
      subtitle={`${agentName} · ${scope?.name ?? "原范围不可用"}`}
      onClose={onClose}
      busy={executing || importing}
      footer={footer}
    >
      <InlineError message={error} retry={() => setRevision((v) => v + 1)} />
      {result ? <p className="ux-warning">{result}</p> : null}
      {importPath ? (
        <ImportSkillEditor
          path={importPath}
          onCancel={() => setImportPath(null)}
          onBusy={setImporting}
          onImported={(id) => {
            void loadLibrary()
              .then(() => {
                setSelected((ids) => [...new Set([...ids, id])]);
                setQuery("");
                setImportPath(null);
              })
              .catch((e) => setError(commandMessage(e)));
          }}
        />
      ) : (
        <>
          {mode === "add" ? (
            <>
              <section className="ux-target-summary">
                <strong>保存到 {scope?.name ?? "所选范围"}</strong>
                {target ? (
                  <details>
                    <summary>查看或更改保存位置</summary>
                    <select
                      aria-label="保存位置"
                      value={target}
                      disabled={executing}
                      onChange={(e) => void rememberTarget(e.target.value)}
                    >
                      {view.targets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.path}
                          {t.recommended ? "（推荐）" : ""}
                        </option>
                      ))}
                    </select>
                  </details>
                ) : view.targets.length ? (
                  <label>
                    选择保存位置
                    <select
                      aria-label="保存位置"
                      value=""
                      onChange={(e) => void rememberTarget(e.target.value)}
                    >
                      <option value="" disabled>
                        请选择，仅需确认一次
                      </option>
                      {view.targets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.path}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <button
                    className="ux-link"
                    onClick={() => onConfigure(selected)}
                  >
                    配置保存位置
                  </button>
                )}
              </section>
              <div className="ux-library-tools">
                <label className="ux-search">
                  <Search size={16} />
                  <input
                    autoFocus
                    aria-label="搜索技能库"
                    placeholder="搜索技能库"
                    value={query}
                    disabled={executing}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button
                  className="ux-secondary"
                  disabled={executing}
                  onClick={() => void pickImport()}
                >
                  <FolderPlus size={15} />
                  从本地导入
                </button>
              </div>
              {bundles.length ? (
                <select
                  className="ux-bundle-select"
                  aria-label="选择技能组合"
                  defaultValue=""
                  disabled={executing}
                  onChange={(e) =>
                    setSelected(
                      bundles
                        .find((b) => b.id === e.target.value)
                        ?.items.map((i) => i.skillId) ?? [],
                    )
                  }
                >
                  <option value="">按技能组合选择</option>
                  {bundles.map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="ux-picked-summary">
                已选 {selected.length} 项
                {selected.length ? (
                  <button
                    className="ux-link"
                    disabled={executing}
                    onClick={() => setSelected([])}
                  >
                    清空
                  </button>
                ) : null}
              </div>
              {loading ? (
                <Loading />
              ) : (
                <div className="ux-library-list">
                  {library
                    .filter((s) =>
                      `${s.name} ${s.description}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((skill) => (
                      <label key={skill.id}>
                        <input
                          type="checkbox"
                          aria-label={`添加 ${skill.name}${(duplicateNames.get(skill.name) ?? 0) > 1 ? `，${skill.sourcePath ?? skill.source}` : ""}`}
                          checked={selected.includes(skill.id)}
                          disabled={executing}
                          onChange={() =>
                            setSelected((ids) =>
                              ids.includes(skill.id)
                                ? ids.filter((id) => id !== skill.id)
                                : [...ids, skill.id],
                            )
                          }
                        />
                        <span>
                          <strong>{skill.name}</strong>
                          <small>{skill.description}</small>
                          <small className="ux-muted" title={skill.sourcePath}>
                            {(duplicateNames.get(skill.name) ?? 0) > 1
                              ? (skill.sourcePath ?? skill.source)
                              : skill.source}
                          </small>
                        </span>
                      </label>
                    ))}
                  {!library.length ? (
                    <div className="ux-empty">
                      <h3>技能库还没有内容</h3>
                      <button
                        className="ux-link"
                        onClick={() => void pickImport()}
                      >
                        从本地导入
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div className="ux-update-selection">
              {view.skills
                .filter((s) => updates.includes(s.id))
                .map((s) => (
                  <div key={s.id}>
                    <strong>{s.name}</strong>
                    {s.localModified ? (
                      <p className="ux-warning">将覆盖本地修改</p>
                    ) : null}
                    <button
                      className="ux-link"
                      disabled={executing}
                      onClick={() =>
                        setUpdates((ids) => ids.filter((id) => id !== s.id))
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
            </div>
          )}
          {ready ? (
            <div ref={reviewElement}>
              <PlanReview
                plans={plans}
                snapshot={snapshot}
                reviewed={reviewed}
                onReviewed={setReviewed}
              />
            </div>
          ) : null}
        </>
      )}
    </Drawer>
  );
}
