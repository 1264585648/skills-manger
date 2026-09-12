import { useEffect, useState } from "react";
import { Copy, FolderOpen, RefreshCw } from "lucide-react";
import type { ManagedSkill } from "../../types/agentCenter";
import type { Skill } from "../../types/domain";
import {
  agentCenterService as service,
  commandMessage,
} from "../../services/agentCenterService";
import { workspaceService } from "../../services/workspaceService";
import { Drawer, InlineError } from "./Drawer";
import { stateLabels } from "./SkillList";
export function SkillDetailDrawer({
  skill,
  onClose,
  onUpdate,
  onImport,
  onRescan,
  onAdvanced,
}: {
  skill: ManagedSkill | null;
  onClose: () => void;
  onUpdate: (ids: string[]) => void;
  onImport: (id: string) => void;
  onRescan: () => Promise<void>;
  onAdvanced?: () => void;
}) {
  const [content, setContent] = useState<string | null>(null),
    [library, setLibrary] = useState<Skill[]>([]),
    [binding, setBinding] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    setContent(null);
    setError(null);
    let live = true;
    void workspaceService
      .getSkills()
      .then((items) => {
        if (live)
          setLibrary(items.filter((s) => !s.id.startsWith("instance:")));
      })
      .catch((e) => live && setError(commandMessage(e)));
    return () => {
      live = false;
    };
  }, [skill?.id]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(commandMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={skill?.name ?? "技能已不存在"} onClose={onClose} busy={busy}>
      <InlineError message={error} />
      {skill ? (
        <>
          <div className="ux-detail-state">
            <span className={`ux-state ux-state-${skill.state}`}>
              {stateLabels[skill.state]}
            </span>
            {skill.readonly ? (
              <span className="ux-muted">由插件或系统管理，仅供查看</span>
            ) : null}
          </div>
          <p className="ux-detail-description">
            {skill.description || "暂无简介"}
          </p>
          {skill.reason ? (
            <div className="ux-warning">{skill.reason}</div>
          ) : null}
          <div className="ux-inline-actions">
            {skill.canUpdate ? (
              <button
                className="ux-primary"
                onClick={() => onUpdate([skill.id])}
              >
                从技能库更新
              </button>
            ) : null}
            {skill.canImport ? (
              <button
                className="ux-primary"
                onClick={() => onImport(skill.instanceIds[0])}
              >
                加入技能库
              </button>
            ) : null}
            {skill.state !== "added" ? (
              <button
                className="ux-secondary"
                disabled={busy}
                onClick={() => void run(onRescan)}
              >
                <RefreshCw size={15} />
                重新检查
              </button>
            ) : null}
            <button
              className="ux-secondary"
              onClick={() =>
                void run(() => service.openSkill(skill.instanceIds[0], true))
              }
            >
              <FolderOpen size={15} />
              定位入口
            </button>
          </div>
          <section className="ux-detail-section">
            <h3>来源与位置</h3>
            <p>
              {skill.libraryId
                ? `已关联技能库：${library.find((s) => s.id === skill.libraryId)?.name ?? "关联已保存"}`
                : "外部技能，尚未关联技能库"}
            </p>
            {skill.paths.map((path) => (
              <div className="ux-copy-path" key={path}>
                <code>{path}</code>
                <button
                  className="ux-icon"
                  title={copied ? "已复制" : "复制路径"}
                  aria-label="复制技能路径"
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(path);
                      setCopied(true);
                    })
                  }
                >
                  <Copy size={15} />
                </button>
              </div>
            ))}
            {skill.linked ? (
              <details>
                <summary>链接实际位置</summary>
                <code>{skill.resolvedPath}</code>
              </details>
            ) : null}
          </section>
          {skill.diagnostics.length ? (
            <section className="ux-detail-section">
              <h3>需要处理</h3>
              {skill.diagnostics.map((d, i) => (
                <div key={i}>
                  <p>{d.suggestion}</p>
                  <details>
                    <summary>技术详情</summary>
                    <p>{d.message}</p>
                    <code>{d.path}</code>
                    <small>{d.code}</small>
                  </details>
                </div>
              ))}
            </section>
          ) : null}
          {!skill.libraryId && library.length ? (
            <details className="ux-detail-section">
              <summary>关联已有技能库内容</summary>
              <p className="ux-muted">选择明确的来源，之后可查看并确认更新。</p>
              <select
                aria-label="关联技能库"
                value={binding}
                onChange={(e) => setBinding(e.target.value)}
              >
                <option value="">选择对应的技能</option>
                {library.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name} · {s.sourcePath ?? s.source}
                  </option>
                ))}
              </select>
              <button
                className="ux-secondary"
                disabled={!binding || busy}
                onClick={() =>
                  void run(async () => {
                    await service.bind(skill.instanceIds[0], binding);
                    await onRescan();
                  })
                }
              >
                确认关联
              </button>
            </details>
          ) : null}
          <details
            className="ux-detail-section"
            onToggle={(e) => {
              if (e.currentTarget.open && content === null)
                void run(async () =>
                  setContent(await service.content(skill.instanceIds[0])),
                );
            }}
          >
            <summary>查看技能内容</summary>
            {content ? <pre className="ux-content">{content}</pre> : null}
          </details>
          {onAdvanced && skill.libraryId ? (
            <button className="ux-link" onClick={onAdvanced}>
              前往环境更新
            </button>
          ) : null}
        </>
      ) : (
        <p className="ux-muted">该技能已从当前范围移除，请重新检查列表。</p>
      )}
    </Drawer>
  );
}
