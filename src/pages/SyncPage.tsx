import { useEffect, useMemo, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Button, EmptyState, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Bundle } from "../types/domain";
import type { ApplyOperationRecord, SyncPlanRecord } from "../types/bundlePlanner";
import type { DiscoveryRootRecord } from "../types/discovery";

const actionMeta = {
  add: { label: "新增", tone: "blue" as const },
  update: { label: "更新", tone: "amber" as const },
  unchanged: { label: "无变化", tone: "gray" as const },
  conflict: { label: "冲突", tone: "red" as const },
};

const operationMeta = {
  running: { label: "执行中", tone: "blue" as const },
  succeeded: { label: "已完成", tone: "green" as const },
  rolled_back: { label: "已回滚", tone: "amber" as const },
  rollback_failed: { label: "回滚失败", tone: "red" as const },
};

export function SyncPage({ initialBundleId }: { initialBundleId?: string | null }) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [roots, setRoots] = useState<DiscoveryRootRecord[]>([]);
  const [operations, setOperations] = useState<ApplyOperationRecord[]>([]);
  const [bundleId, setBundleId] = useState("");
  const [rootId, setRootId] = useState("");
  const [plan, setPlan] = useState<SyncPlanRecord | null>(null);
  const [lastOperation, setLastOperation] = useState<ApplyOperationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      workspaceService.getBundles(),
      workspaceService.getDiscoveryRoots(),
      workspaceService.getApplyOperations(),
    ])
      .then(([nextBundles, nextRoots, nextOperations]) => {
        const enabledRoots = nextRoots.filter((root) => root.enabled);
        setBundles(nextBundles);
        setRoots(enabledRoots);
        setOperations(nextOperations);
        const preferred = initialBundleId && nextBundles.some((bundle) => bundle.id === initialBundleId)
          ? initialBundleId
          : nextBundles[0]?.id ?? "";
        setBundleId(preferred);
        setRootId(enabledRoots[0]?.id ?? "");
      })
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "读取同步数据失败"),
      )
      .finally(() => setLoading(false));
  }, []);

  const selectedRoot = useMemo(
    () => roots.find((root) => root.id === rootId) ?? null,
    [rootId, roots],
  );
  const conflicts = plan?.items.filter((item) => item.action === "conflict").length ?? 0;
  const changes = plan?.items.filter((item) => item.action !== "unchanged").length ?? 0;
  const canApply = Boolean(plan && changes > 0 && conflicts === 0 && !applying && !generating);

  const generate = async (): Promise<void> => {
    if (!bundleId || !rootId) return;
    setGenerating(true);
    setLastOperation(null);
    setError(null);
    try {
      setPlan(await workspaceService.generateSyncPlan(bundleId, rootId));
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "生成同步计划失败");
    } finally {
      setGenerating(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!plan || !canApply) return;
    const confirmed = await confirm(
      `即将向 ${selectedRoot?.configuredPath ?? "所选 Agent Root"} 写入 ${changes} 个 Skill。\n\n应用前会再次校验计划、创建快照，并在失败时回滚。是否继续？`,
    );
    if (!confirmed) return;
    setApplying(true);
    setError(null);
    try {
      const operation = await workspaceService.applySyncPlan(plan.id);
      setLastOperation(operation);
      setOperations(await workspaceService.getApplyOperations());
      setPlan(await workspaceService.generateSyncPlan(bundleId, rootId));
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "应用同步计划失败");
      setOperations(await workspaceService.getApplyOperations().catch(() => operations));
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="page">
      <PageHeader title="Sync" subtitle="先生成不可变计划，再经漂移检查、快照和哈希验证安全写入 Agent。" />
      {error ? <div className="inline-notice notice-error" role="alert">{error}</div> : null}
      {lastOperation?.status === "succeeded" ? (
        <div className="inline-notice notice-success" aria-live="polite">
          操作 {lastOperation.id.slice(0, 12)} 已完成；{lastOperation.items.length} 个 Skill 已验证。
        </div>
      ) : null}

      <div className="sync-context panel-surface">
        <label><span>目标 Root</span><select value={rootId} onChange={(event) => { setRootId(event.target.value); setPlan(null); setLastOperation(null); }}>{roots.map((root) => <option key={root.id} value={root.id}>{root.scope} · {root.configuredPath}</option>)}</select></label>
        <label><span>Bundle</span><select value={bundleId} onChange={(event) => { setBundleId(event.target.value); setPlan(null); setLastOperation(null); }}>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}</select></label>
        <div className="sync-context-spacer" />
        <Button variant="primary" disabled={loading || generating || applying || !bundleId || !rootId} onClick={() => void generate()}>{generating ? "校验中…" : "生成计划"}</Button>
      </div>

      <div className="workbench sync-workbench">
        <section className="panel-surface sync-plan">
          <div className="bundle-heading compact"><div><span className="eyebrow">Safe Apply Plan</span><h2>{plan ? `本次包含 ${changes} 项变更` : "尚未生成计划"}</h2></div>{plan ? <span className="plan-hash">plan · {plan.id.slice(0, 12)}</span> : null}</div>
          {loading ? (
            <EmptyState title="正在读取同步数据" body="加载 Bundle、目标 Root 和操作记录。" />
          ) : !bundleId || !rootId ? (
            <EmptyState title="缺少同步输入" body="请先创建 Bundle，并在 Settings 中登记可用的 Agent Root。" />
          ) : !plan ? (
            <EmptyState title="准备生成安全计划" body="计划阶段只读取 Library 和目标目录，不会写入任何文件。" />
          ) : (
            <div className="sync-list">{plan.items.map((item) => {
              const meta = actionMeta[item.action];
              return <div className="sync-row" key={item.id}><span className="sync-skill"><i className="skill-glyph">S</i><span><strong>{item.skillName}</strong><small>{item.mode} · {item.reason}</small></span></span><span className="version-flow"><small>{item.currentHash?.slice(0, 12) ?? "—"}</small><b>→</b><small>{item.libraryHash.slice(0, 12)}</small></span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></div>;
            })}</div>
          )}
          {plan?.warnings.map((warning) => <div className="discovery-warning" key={warning}>{warning}</div>)}
          <div className="sync-steps" aria-label="安全应用流程"><span className="done">Resolve</span><b>→</b><span className="done">Drift Check</span><b>→</b><span className={applying ? "current" : ""}>Snapshot</span><b>→</b><span className={applying ? "current" : ""}>Apply</span><b>→</b><span className={lastOperation ? "done" : ""}>Verify</span></div>
        </section>

        <aside className="panel-surface inspector">
          <div className="inspector-title simple"><div><h2>同步摘要</h2><p>只有本应用拥有且无漂移的目标，才允许自动更新。</p></div></div>
          <dl className="detail-list spacious"><div><dt>计划</dt><dd>{plan?.id.slice(0, 12) ?? "—"}</dd></div><div><dt>变更</dt><dd>{changes}</dd></div><div><dt>冲突</dt><dd>{conflicts}</dd></div></dl>
          <div className="verify-box"><span className="section-label">执行边界</span><p>✓ 应用前重新校验计划与目标漂移</p><p>✓ 脚本仅复制，绝不执行</p><p>✓ 同盘原子替换、哈希验证和反向回滚</p></div>
          <div className="inspector-actions"><Button variant="primary" disabled={!canApply} onClick={() => void apply()}>{applying ? "正在安全应用…" : conflicts > 0 ? "存在冲突，禁止应用" : changes === 0 ? "目标已是最新" : `应用 ${changes} 项变更`}</Button><Button disabled={!plan || applying} onClick={() => void generate()}>重新校验</Button></div>

          <div className="operation-history"><span className="section-label">最近操作</span>{operations.length === 0 ? <p className="operation-empty">暂无写入记录</p> : operations.slice(0, 3).map((operation) => {
            const meta = operationMeta[operation.status];
            return <div className="operation-row" key={operation.id} title={operation.error ?? undefined}><span><strong>{operation.id.slice(0, 10)}</strong><small>{operation.items.length} items</small></span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></div>;
          })}</div>
        </aside>
      </div>
    </section>
  );
}
