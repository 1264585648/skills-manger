import { useEffect, useState } from "react";
import { FolderOpen, ArrowLeft, LoaderCircle } from "lucide-react";
import {
  agentCenterService as service,
  commandMessage,
} from "../../services/agentCenterService";
import type { AgentImportPreview } from "../../types/agentCenter";
import { InlineError, Loading } from "./Drawer";

export function ImportSkillEditor({
  instanceId,
  path,
  onImported,
  onCancel,
  onBusy,
}: {
  instanceId?: string;
  path?: string;
  onImported: (id: string) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<AgentImportPreview | null>(null),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setError(null);
    try {
      const p = await service.prepareImport(path ?? null, instanceId ?? null);
      setPreview(p);
      setName(p.name);
      setDescription(p.description);
    } catch (e) {
      setError(commandMessage(e));
    }
  };
  useEffect(() => {
    let live = true;
    void service
      .prepareImport(path ?? null, instanceId ?? null)
      .then((p) => {
        if (live) {
          setPreview(p);
          setName(p.name);
          setDescription(p.description);
        }
      })
      .catch((e) => live && setError(commandMessage(e)));
    return () => {
      live = false;
    };
  }, [path, instanceId]);
  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const result = await service.importPrepared(
        preview.id,
        name.trim(),
        description.trim(),
      );
      onImported(result.skill.id);
    } catch (e) {
      setError(commandMessage(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <section className="ux-import-editor">
      <button className="ux-link" disabled={busy} onClick={onCancel}>
        <ArrowLeft size={15} />
        返回
      </button>
      <h3>加入技能库</h3>
      <InlineError message={error} retry={() => void load()} />
      {preview ? (
        <>
          <div className="ux-location">
            <FolderOpen size={16} />
            <code>{preview.path}</code>
          </div>
          <label>
            技能名称
            <input
              aria-label="导入技能名称"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            技能简介
            <textarea
              aria-label="导入技能简介"
              value={description}
              maxLength={1024}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="ux-muted">原文件保留；名称和简介将写入技能库副本。</p>
          {preview.changes.map((c) => (
            <p className="ux-warning" key={c}>
              {c}
            </p>
          ))}
          <button
            className="ux-primary"
            disabled={busy || !name.trim() || !description.trim()}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="ac-spin" size={16} /> : null}
            确认导入
          </button>
        </>
      ) : !error ? (
        <Loading text="正在读取导入信息" />
      ) : null}
    </section>
  );
}
