import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Skill } from "../types/domain";
import type { SkillGroupRecord } from "../types/skillGroups";
import { Button, EmptyState } from "./ui";

type DialogMode = "catalog" | "membership";
type PendingAction = "create" | "rename" | "delete" | "save" | null;

interface Props {
  mode: DialogMode;
  skill?: Skill;
  groups: SkillGroupRecord[];
  busy?: boolean;
  onCancel: () => void;
  onCreate: (name: string) => Promise<SkillGroupRecord>;
  onRename: (group: SkillGroupRecord, name: string) => Promise<SkillGroupRecord>;
  onDelete: (group: SkillGroupRecord) => Promise<boolean>;
  onConfirm?: (groupIds: string[]) => Promise<void> | void;
}

export function SkillGroupDialog({
  mode,
  skill,
  groups,
  busy = false,
  onCancel,
  onCreate,
  onRename,
  onDelete,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialIds = useMemo(
    () => skill
      ? groups.filter((group) => group.skillIds.includes(skill.id)).map((group) => group.id)
      : [],
    [groups, skill],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [createName, setCreateName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const blocked = busy || pendingAction !== null;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    setSelectedIds((current) => {
      const validIds = new Set(groups.map((group) => group.id));
      return current.filter((id) => validIds.has(id));
    });
  }, [groups]);

  const toggleGroup = (groupId: string): void => {
    setSelectedIds((current) => current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId]);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const name = createName.trim();
    if (!name || blocked) return;

    setPendingAction("create");
    setError(null);
    try {
      const created = await onCreate(name);
      setCreateName("");
      if (mode === "membership") {
        setSelectedIds((current) => current.includes(created.id)
          ? current
          : [...current, created.id]);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建分组失败");
    } finally {
      setPendingAction(null);
    }
  };

  const beginRename = (group: SkillGroupRecord): void => {
    setEditingId(group.id);
    setEditingName(group.name);
    setError(null);
  };

  const handleRename = async (group: SkillGroupRecord): Promise<void> => {
    const name = editingName.trim();
    if (!name || name === group.name || blocked) {
      if (name === group.name) setEditingId(null);
      return;
    }

    setPendingAction("rename");
    setError(null);
    try {
      await onRename(group, name);
      setEditingId(null);
      setEditingName("");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "重命名分组失败");
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (group: SkillGroupRecord): Promise<void> => {
    if (blocked) return;
    setPendingAction("delete");
    setError(null);
    try {
      const deleted = await onDelete(group);
      if (!deleted) return;
      setSelectedIds((current) => current.filter((id) => id !== group.id));
      if (editingId === group.id) setEditingId(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除分组失败");
    } finally {
      setPendingAction(null);
    }
  };

  const changedCount = mode === "membership"
    ? groups.filter((group) => initialIds.includes(group.id) !== selectedIds.includes(group.id)).length
    : 0;

  const handleConfirm = async (): Promise<void> => {
    if (!onConfirm || blocked || changedCount === 0) return;
    setPendingAction("save");
    setError(null);
    try {
      await onConfirm(selectedIds);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存分组关系失败");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="wizard-backdrop" role="presentation">
      <section
        ref={dialogRef}
        aria-describedby="skill-group-help"
        aria-labelledby="skill-group-title"
        aria-modal="true"
        className="skill-group-dialog panel-surface"
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Escape" && !blocked) onCancel();
        }}
      >
        <header className="wizard-header">
          <div>
            <span className="eyebrow">技能整理</span>
            <h2 id="skill-group-title">
              {mode === "membership" ? "管理所属分组" : "管理分组"}
            </h2>
            <p id="skill-group-help">
              {mode === "membership" && skill
                ? <>为 <strong>{skill.name}</strong> 选择分组。分组只影响整理和筛选，不改变 Bundle 或任何 Agent 文件。</>
                : "创建、重命名或删除整理用分组。删除分组不会删除其中的 Skill。"}
            </p>
          </div>
          <button
            aria-label="关闭分组管理"
            className="wizard-close"
            disabled={blocked}
            onClick={onCancel}
            type="button"
          >×</button>
        </header>

        <form className="skill-group-create" onSubmit={(event) => void handleCreate(event)}>
          <label>
            <span>新建分组</span>
            <input
              autoComplete="off"
              disabled={blocked}
              maxLength={80}
              placeholder="例如：研发效率"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </label>
          <Button disabled={blocked || !createName.trim()} type="submit">
            {pendingAction === "create" ? "创建中…" : "创建"}
          </Button>
        </form>

        {error ? <div className="inline-notice notice-error group-dialog-error">{error}</div> : null}

        <div className="skill-group-list">
          {groups.length === 0 ? (
            <EmptyState title="还没有分组" body="创建第一个分组后，就可以把技能整理到其中。" />
          ) : groups.map((group) => {
            const checked = selectedIds.includes(group.id);
            const editing = editingId === group.id;
            return (
              <article className="skill-group-item" key={group.id}>
                {mode === "membership" ? (
                  <input
                    aria-label={`${checked ? "移出" : "加入"}${group.name}`}
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggleGroup(group.id)}
                    type="checkbox"
                  />
                ) : <span className="skill-group-dot" aria-hidden="true" />}

                <div className="skill-group-item-main">
                  {editing ? (
                    <input
                      autoFocus
                      disabled={blocked}
                      maxLength={80}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleRename(group);
                        }
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : <strong>{group.name}</strong>}
                  <small>{group.skillIds.length} 个 Skill</small>
                </div>

                <div className="skill-group-item-state">
                  {mode === "membership" ? <em>{checked ? "已加入" : "未加入"}</em> : null}
                </div>

                <div className="skill-group-actions">
                  {editing ? (
                    <>
                      <button
                        disabled={blocked || !editingName.trim()}
                        onClick={() => void handleRename(group)}
                        type="button"
                      >保存</button>
                      <button disabled={blocked} onClick={() => setEditingId(null)} type="button">取消</button>
                    </>
                  ) : (
                    <>
                      <button disabled={blocked} onClick={() => beginRename(group)} type="button">重命名</button>
                      <button
                        className="danger"
                        disabled={blocked}
                        onClick={() => void handleDelete(group)}
                        type="button"
                      >删除</button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <footer className="wizard-footer">
          <span>
            {mode === "membership"
              ? changedCount > 0
                ? `将更新 ${changedCount} 个分组关系；不会触发部署。`
                : "所属分组没有变化。"
              : "分组只用于整理；Bundle 和部署关系保持不变。"}
          </span>
          <div>
            {mode === "membership" ? <Button disabled={blocked} onClick={onCancel}>取消</Button> : null}
            {mode === "membership" ? (
              <Button
                variant="primary"
                disabled={blocked || changedCount === 0}
                onClick={() => void handleConfirm()}
              >
                {pendingAction === "save" ? "保存中…" : "保存分组关系"}
              </Button>
            ) : <Button disabled={blocked} onClick={onCancel}>完成</Button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
