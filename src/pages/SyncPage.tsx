import { useEffect, useMemo, useState } from "react";
import { agentCenterService } from "../services/agentCenterService";
import { PlanReview } from "../components/agents/PlanReview";
import type { AgentNavigationContext,AgentInstallPlan,AgentCenterSnapshot } from "../types/agentCenter";
import { Button, EmptyState, ErrorNotice, PageHeader, StatusPill } from "../components/ui";
import { ConflictResolver } from "../components/ConflictResolver";
import { workspaceService } from "../services/workspaceService";
import { formatTimestamp } from "../services/formatTimestamp";
import { baseName } from "../services/conflictRules";
import { openAgentRootDirectory } from "../services/agentPathService";
import type { Bundle } from "../types/domain";
import type {
  ApplyOperationRecord,
  DeploymentRecord,
  SyncPlanItemRecord,
  SyncPlanRecord,
} from "../types/bundlePlanner";
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

export function SyncPage({ initialBundleId,initialContext,onReturnToAgent }: { initialBundleId?: string | null;initialContext?:AgentNavigationContext;onReturnToAgent?:()=>void }) {
  const direct=Boolean(initialContext?.skillIds?.length||initialContext?.managedIds?.length);
  const [reviewed,setReviewed]=useState(false);
  const [agentSnapshot,setAgentSnapshot]=useState<AgentCenterSnapshot|null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [roots, setRoots] = useState<DiscoveryRootRecord[]>([]);
  const [operations, setOperations] = useState<ApplyOperationRecord[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [bundleId, setBundleId] = useState("");
  const [rootId, setRootId] = useState("");
  const [plan, setPlan] = useState<SyncPlanRecord | null>(null);
  const [lastOperation, setLastOperation] = useState<ApplyOperationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void agentCenterService.snapshot().then(setAgentSnapshot).catch(()=>{});
    void Promise.all([
      workspaceService.getBundles(),
      workspaceService.getDiscoveryRoots(),
      workspaceService.getApplyOperations(),
      workspaceService.getDeployments(),
    ])
      .then(([nextBundles, nextRoots, nextOperations, nextDeployments]) => {
        const enabledRoots = nextRoots.filter((root) => root.enabled);
        setBundles(nextBundles);
        setRoots(enabledRoots);
        setOperations(nextOperations);
        setDeployments(nextDeployments);
        const preferred = initialBundleId && nextBundles.some((bundle) => bundle.id === initialBundleId)
          ? initialBundleId
          : nextBundles[0]?.id ?? "";
        setBundleId(preferred);
        setRootId(initialContext?.rootId ? enabledRoots.some(r=>r.id===initialContext.rootId)?initialContext.rootId:"" : enabledRoots[0]?.id ?? "");
      })
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError : new Error("读取同步数据失败")),
      )
      .finally(() => setLoading(false));
  }, []);

  const selectedRoot = useMemo(
    () => roots.find((root) => root.id === rootId) ?? null,
    [rootId, roots],
  );
  const conflictItems = useMemo(
    () => plan?.items.filter((item) => item.action === "conflict") ?? [],
    [plan],
  );
  const conflicts = conflictItems.length;
  const changes = plan?.items.filter((item) => item.action !== "unchanged").length ?? 0;
  const requiresReview=Boolean(plan&&(plan.items.some(i=>i.action==="update")||((plan as AgentInstallPlan).affectedAgents?.length??0)>1));
  const canApply = Boolean(plan && changes > 0 && conflicts === 0 && !applying && !generating && (!requiresReview||reviewed));
  const makePlan=async()=>{
    if(initialContext?.managedIds?.length&&initialContext.agentId&&initialContext.scopeId){const plans=await agentCenterService.updates(initialContext.agentId,initialContext.scopeId,initialContext.managedIds);return plans.find(p=>p.rootId===rootId)??plans[0];}
    if(direct)return (await agentCenterService.preview(initialContext!.skillIds??[],[rootId]))[0];
    return workspaceService.generateSyncPlan(bundleId,rootId);
  };
  const rootDeployments = useMemo(
    () =>
      deployments
        .filter((deployment) => deployment.rootId === rootId)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [deployments, rootId],
  );

  const generate = async (): Promise<void> => {
    if ((!bundleId&&!direct) || !rootId) return;
    setGenerating(true);
    setLastOperation(null);
    setError(null);
    try {
      setReviewed(false);
      setPlan(await makePlan());
    } catch (planError) {
      setError(planError instanceof Error ? planError : new Error("生成同步计划失败"));
    } finally {
      setGenerating(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!plan || !canApply) return;
    setApplying(true);
    setError(null);
    try {
      const operation = await workspaceService.applySyncPlan(plan.id);
      setLastOperation(operation);
      setOperations(await workspaceService.getApplyOperations());
      setPlan(null);setReviewed(false);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError : new Error("应用同步计划失败"));
      setOperations(await workspaceService.getApplyOperations().catch(() => operations));
    } finally {
      setApplying(false);
    }
  };

  const excludeFromBundle = async (item: SyncPlanItemRecord): Promise<void> => {
    if (!bundleId) return;
    setResolvingId(item.skillId);
    setError(null);
    try {
      const records = await workspaceService.getBundleRecords();
      const record = records.find((candidate) => candidate.id === bundleId);
      if (!record) {
        setError("未找到当前 Bundle，无法排除该 Skill");
        return;
      }
      const nextItems = record.items
        .filter((bundleItem) => bundleItem.skillId !== item.skillId)
        .map((bundleItem) => ({ skillId: bundleItem.skillId, mode: bundleItem.mode }));
      await workspaceService.saveBundle({
        id: record.id,
        name: record.name,
        description: record.description,
        items: nextItems,
      });
      setPlan(await workspaceService.generateSyncPlan(bundleId, rootId));
    } catch (excludeError) {
      setError(excludeError instanceof Error ? excludeError : new Error("排除 Skill 失败"));
    } finally {
      setResolvingId(null);
    }
  };

  const openDirectory = async (): Promise<void> => {
    setError(null);
    try {
      await openAgentRootDirectory(rootId);
    } catch (openError) {
      setError(
        `${openError instanceof Error ? openError.message : "打开目录失败"}（可改用“复制路径”手动定位）`,
      );
    }
  };

  return (
    <section className="page">
      <PageHeader title="Sync" subtitle={direct?"已带入所选技能和目标范围。":"先生成不可变计划，再经漂移检查、快照和哈希验证安全写入 Agent。"} actions={initialContext?.agentId&&onReturnToAgent?<Button onClick={onReturnToAgent}>返回 Agent</Button>:undefined}/>
      {error ? <ErrorNotice error={error} onRetry={bundleId && rootId ? () => void generate() : undefined} onDismiss={() => setError(null)} /> : null}
      {lastOperation?.status === "succeeded" ? (
        <div className="inline-notice notice-success" aria-live="polite">
          操作 {lastOperation.id.slice(0, 12)} 已完成；{lastOperation.items.length} 个 Skill 已验证。
        </div>
      ) : null}

      <div className="sync-context panel-surface">
        <label><span>目标位置</span><select value={rootId} disabled={direct} onChange={(event) => { setRootId(event.target.value); setPlan(null); setLastOperation(null); }}>{roots.map((root) => <option key={root.id} value={root.id}>{root.scope} · {root.configuredPath}</option>)}</select></label>
        {direct?<span>已选择 {initialContext?.managedIds?.length??initialContext?.skillIds?.length??0} 个技能</span>:<label><span>Bundle</span><select value={bundleId} onChange={(event) => { setBundleId(event.target.value); setPlan(null); setLastOperation(null); }}>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}</select></label>}
        <div className="sync-context-spacer" />
        <Button variant="primary" disabled={loading || generating || applying || (!bundleId&&!direct) || !rootId} onClick={() => void generate()}>{generating ? "校验中…" : "生成计划"}</Button>
      </div>

      <div className="workbench sync-workbench">
        <section className="panel-surface sync-plan">
          <div className="bundle-heading compact"><div><span className="eyebrow">Safe Apply Plan</span><h2>{plan ? `本次包含 ${changes} 项变更` : "尚未生成计划"}</h2></div>{plan ? <span className="plan-hash">plan · {plan.id.slice(0, 12)}</span> : null}</div>
          {loading ? (
            <EmptyState title="正在读取同步数据" body="加载 Bundle、目标 Root 和操作记录。" />
          ) : (!bundleId&&!direct) || !rootId ? (
            <EmptyState title="缺少同步输入" body="请先创建 Bundle，并在 Settings 中登记可用的 Agent Root。" />
          ) : !plan ? (
            <EmptyState title="准备生成安全计划" body="计划阶段只读取 Library 和目标目录，不会写入任何文件。" />
          ) : (
            <div className="sync-list">{plan.items.map((item) => {
              const meta = actionMeta[item.action];
              return <div className="sync-row" key={item.id}><span className="sync-skill"><i className="skill-glyph">S</i><span><strong>{item.skillName}</strong><small>{item.mode} · {item.reason}</small></span></span><span className="version-flow"><small>{item.currentHash?.slice(0, 12) ?? "—"}</small><b>→</b><small>{item.libraryHash.slice(0, 12)}</small></span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></div>;
            })}</div>
          )}
          {conflicts > 0 && selectedRoot ? (
            <ConflictResolver
              items={conflictItems}
              rootPath={selectedRoot.configuredPath}
              busySkillId={resolvingId}
              onExclude={(item) => void excludeFromBundle(item)}
              onOpenDirectory={() => void openDirectory()}
            />
          ) : null}
          {plan?.warnings.map((warning) => <div className="discovery-warning" key={warning}>{warning}</div>)}
          {plan?<PlanReview plans={[plan]} snapshot={agentSnapshot??undefined} reviewed={reviewed} onReviewed={setReviewed}/>:null}
        </section>

        <aside className="panel-surface inspector">
          <div className="inspector-title simple"><div><h2>同步摘要</h2><p>{direct?"以技能库覆盖所选内容，写入前备份。":"只有本应用拥有且无漂移的目标，才允许更新。"}</p></div></div>
          <dl className="detail-list spacious"><div><dt>计划</dt><dd>{plan?.id.slice(0, 12) ?? "—"}</dd></div><div><dt>变更</dt><dd>{changes}</dd></div><div><dt>冲突</dt><dd>{conflicts}</dd></div></dl>
          <div className="verify-box"><span className="section-label">执行边界</span><p>✓ 应用前重新校验计划与目标漂移</p><p>✓ 脚本仅复制，绝不执行</p><p>✓ 同盘原子替换、哈希验证和反向回滚</p></div>
          <div className="inspector-actions"><Button variant="primary" disabled={!canApply} onClick={() => void apply()}>{applying ? "正在安全应用…" : conflicts > 0 ? `先处置 ${conflicts} 项冲突` : changes === 0 ? "目标已是最新" : `应用 ${changes} 项变更`}</Button><Button disabled={!plan || applying} onClick={() => void generate()}>重新校验</Button></div>

          <div className="deployment-panel">
            <span className="section-label">当前 Root 已部署 {rootDeployments.length}</span>
            {rootDeployments.length === 0 ? (
              <p className="operation-empty">该 Root 下还没有本应用部署的 Skill。</p>
            ) : (
              <div className="deployment-list">
                {rootDeployments.slice(0, 6).map((deployment) => (
                  <div className="deployment-row" key={deployment.id} title={deployment.destinationPath}>
                    <span>
                      <strong>{baseName(deployment.destinationPath)}</strong>
                      <small>{formatTimestamp(deployment.updatedAt)}</small>
                    </span>
                    <code className="plan-hash">{deployment.deployedHash.slice(0, 12)}</code>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="operation-history"><span className="section-label">最近操作</span>{operations.length === 0 ? <p className="operation-empty">暂无写入记录</p> : operations.slice(0, 3).map((operation) => {
            const meta = operationMeta[operation.status];
            return <div className="operation-row" key={operation.id} title={operation.error ?? undefined}><span><strong>{operation.id.slice(0, 10)}</strong><small>{operation.items.length} items</small></span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></div>;
          })}</div>
        </aside>
      </div>
    </section>
  );
}
