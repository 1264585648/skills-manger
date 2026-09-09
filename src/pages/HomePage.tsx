import { useEffect, useState } from "react";
import { Button, EmptyState, PageHeader, StatusPill } from "../components/ui";
import { workspaceService } from "../services/workspaceService";
import type { ApplyOperationRecord } from "../types/bundlePlanner";
import type { Agent, Bundle, PageKey, Skill, SkillStatus } from "../types/domain";

const operationMeta = {
  running: { label: "执行中", tone: "blue" as const },
  succeeded: { label: "已完成", tone: "green" as const },
  rolled_back: { label: "已回滚", tone: "amber" as const },
  rollback_failed: { label: "回滚失败", tone: "red" as const },
};

const attentionTone = (status: SkillStatus): "green" | "amber" | "red" | "gray" => {
  if (status === "clean") return "green";
  if (status === "unmanaged") return "gray";
  if (status === "conflict" || status === "missing" || status === "local_modified" || status === "target_drift") return "red";
  return "amber";
};

export function HomePage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [operations, setOperations] = useState<ApplyOperationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      workspaceService.getSkills(),
      workspaceService.getAgents(),
      workspaceService.getBundles(),
      workspaceService.getApplyOperations(),
    ])
      .then(([nextSkills, nextAgents, nextBundles, nextOperations]) => {
        setSkills(nextSkills);
        setAgents(nextAgents);
        setBundles(nextBundles);
        setOperations(nextOperations);
        setError(null);
      })
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "读取环境概览失败"),
      )
      .finally(() => setLoading(false));
  }, []);

  const libraryCount = skills.filter((skill) => !skill.id.startsWith("instance:")).length;
  const discoveredCount = skills.filter((skill) => skill.status === "unmanaged").length;
  const attention = skills.filter((skill) => skill.status !== "clean");
  const readyAgents = agents.filter((agent) => agent.status === "ready").length;
  const lastOperation = operations[0];

  return <section className="page">
    <PageHeader
      title="概览"
      subtitle="本机 Skill 资产、Agent 与最近部署操作的实时状态。"
      actions={<Button variant="primary" onClick={() => onNavigate("skills")}>＋ 导入 Skill</Button>}
    />
    {error ? <div className="inline-notice notice-error" role="alert">{error}</div> : null}

    <div className="summary-row summary-three">
      <article><span>Library Skills</span><strong>{libraryCount}</strong></article>
      <article><span>只读发现</span><strong>{discoveredCount}</strong></article>
      <article><span>需要关注</span><strong>{attention.length}</strong></article>
    </div>

    <div className="workbench sync-workbench">
      <section className="panel-surface" style={{ padding: 18 }}>
        <div className="panel-title" style={{ paddingLeft: 0 }}>需要关注</div>
        {loading ? (
          <EmptyState title="正在读取环境" body="从本地 SQLite 加载 Skill 与 Agent 状态。" />
        ) : attention.length === 0 ? (
          <EmptyState
            title="全部处于 Clean 状态"
            body="没有待处理的更新、冲突或漂移；可在 Settings 中登记更多来源。"
          />
        ) : attention.slice(0, 8).map((skill) => (
          <div className="operation-row" key={skill.id} title={skill.sourcePath}>
            <span><strong>{skill.name}</strong><small>{skill.source}</small></span>
            <StatusPill tone={attentionTone(skill.status)}>{skill.status}</StatusPill>
          </div>
        ))}
      </section>

      <aside className="panel-surface inspector">
        <div className="inspector-title simple">
          <div><h2>环境状态</h2><p>Canonical Library 是唯一事实源，Agent 目录只是部署目标。</p></div>
        </div>
        <dl className="detail-list spacious">
          <div><dt>已检测 Agent</dt><dd>{readyAgents} / {agents.length}</dd></div>
          <div><dt>Bundle</dt><dd>{bundles.length}</dd></div>
          <div><dt>写入操作</dt><dd>{operations.length}</dd></div>
          <div>
            <dt>最近操作</dt>
            <dd>
              {lastOperation
                ? `${operationMeta[lastOperation.status].label} · ${lastOperation.items.length} items`
                : "暂无"}
            </dd>
          </div>
        </dl>
        <div className="inspector-actions">
          <Button variant="primary" onClick={() => onNavigate("sync")}>前往环境更新</Button>
          <Button onClick={() => onNavigate("agents")}>检测 Agent</Button>
          <Button onClick={() => onNavigate("bundles")}>管理 Bundle</Button>
        </div>
      </aside>
    </div>
  </section>;
}
