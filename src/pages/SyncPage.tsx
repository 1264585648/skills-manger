import { useEffect, useState } from "react";
import { Button, EmptyState, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { Bundle } from "../types/domain";
import type { SyncPlanRecord } from "../types/bundlePlanner";
import type { DiscoveryRootRecord } from "../types/discovery";

const actionMeta = {
  add: { label: "新增", tone: "blue" as const },
  unchanged: { label: "无变化", tone: "gray" as const },
  conflict: { label: "冲突", tone: "red" as const },
};

export function SyncPage() {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [roots, setRoots] = useState<DiscoveryRootRecord[]>([]);
  const [bundleId, setBundleId] = useState("");
  const [rootId, setRootId] = useState("");
  const [plan, setPlan] = useState<SyncPlanRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void Promise.all([workspaceService.getBundles(), workspaceService.getDiscoveryRoots()])
      .then(([nextBundles, nextRoots]) => {
        const enabledRoots = nextRoots.filter((root) => root.enabled);
        setBundles(nextBundles);
        setRoots(enabledRoots);
        setBundleId(nextBundles[0]?.id ?? "");
        setRootId(enabledRoots[0]?.id ?? "");
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "读取 Planner 输入失败"))
      .finally(() => setLoading(false));
  }, []);

  const generate = async () => {
    if (!bundleId || !rootId) return;
    setGenerating(true);
    setConfirmed(false);
    setError(null);
    try {
      setPlan(await workspaceService.generateSyncPlan(bundleId, rootId));
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "生成 Sync Plan 失败");
    } finally {
      setGenerating(false);
    }
  };

  const conflicts = plan?.items.filter((item) => item.action === "conflict").length ?? 0;
  const changes = plan?.items.filter((item) => item.action !== "unchanged").length ?? 0;

  return <section className="page">
    <PageHeader title="Sync" subtitle="比较 Bundle 与发现实例；M4 只生成计划，不写入 Agent。" />
    {error ? <div className="inline-notice notice-error">{error}</div> : null}
    {confirmed ? <div className="inline-notice notice-success">已确认对计划的审阅；未执行任何 Agent 写入。</div> : null}
    <div className="sync-context panel-surface">
      <label><span>目标 Root</span><select value={rootId} onChange={(event) => { setRootId(event.target.value); setPlan(null); }}>{roots.map((root) => <option key={root.id} value={root.id}>{root.scope} · {root.configuredPath}</option>)}</select></label>
      <label><span>Bundle</span><select value={bundleId} onChange={(event) => { setBundleId(event.target.value); setPlan(null); }}>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}</select></label>
      <div className="sync-context-spacer" />
      <Button variant="primary" disabled={loading || generating || !bundleId || !rootId} onClick={() => void generate()}>{generating ? "生成中…" : "生成计划"}</Button>
    </div>
    <div className="workbench sync-workbench">
      <section className="panel-surface sync-plan">
        <div className="bundle-heading compact"><div><span className="eyebrow">Read-only Sync Plan</span><h2>{plan ? `这次涉及 ${changes} 个变更` : "尚未生成计划"}</h2></div>{plan ? <span className="plan-hash">plan · {plan.id.slice(0, 12)}</span> : null}</div>
        {loading ? <EmptyState title="正在读取 Planner 输入" body="加载 Bundle 与已登记发现目录。" /> : !bundleId || !rootId ? <EmptyState title="缺少 Planner 输入" body="请先创建 Bundle，并在 Settings 中登记可用的发现目录。" /> : !plan ? <EmptyState title="准备生成只读计划" body="选择 Bundle 和目标 Root 后点击“生成计划”。" /> : <div className="sync-list">{plan.items.map((item) => { const meta = actionMeta[item.action]; return <div className="sync-row" key={item.id}><span className="sync-skill"><i className="skill-glyph">✦</i><span><strong>{item.skillName}</strong><small>{item.mode} · {item.reason}</small></span></span><span className="version-flow"><small>{item.currentHash?.slice(0, 12) ?? "—"}</small><b>→</b><small>{item.libraryHash.slice(0, 12)}</small></span><StatusPill tone={meta.tone}>{meta.label}</StatusPill></div>; })}</div>}
        {plan?.warnings.map((warning) => <div className="discovery-warning" key={warning}>{warning}</div>)}
        <div className="sync-steps"><span className="done">Resolve</span><b>→</b><span className="done">Drift Check</span><b>→</b><span>Snapshot</span><b>→</b><span>Apply</span><b>→</b><span>Verify</span></div>
      </section>
      <aside className="panel-surface inspector"><div className="inspector-title simple"><div><h2>同步摘要</h2><p>名称匹配不授予 ownership；hash 不同一律冲突。</p></div></div><dl className="detail-list spacious"><div><dt>计划</dt><dd>{plan?.id.slice(0, 12) ?? "—"}</dd></div><div><dt>变更</dt><dd>{changes}</dd></div><div><dt>冲突</dt><dd>{conflicts}</dd></div></dl><div className="verify-box"><span className="section-label">执行边界</span><p>✓ Planner 不写目标目录</p><p>✓ 不生成 remove 动作</p><p>○ Snapshot / Apply / Verify 属于 M5</p></div><div className="inspector-actions"><Button variant="primary" disabled={!plan || conflicts > 0} onClick={() => setConfirmed(true)}>确认已审阅</Button><Button disabled>执行 Agent 写入（M5）</Button></div></aside>
    </div>
  </section>;
}
