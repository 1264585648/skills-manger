import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorNotice,
  PageHeader,
  SearchField,
  StatusPill,
} from "../components/ui";
import { suggestTagNames } from "../services/tagSuggestions";
import { workspaceService, type AssignmentRecord } from "../services/workspaceService";
import { displayPath, shortHash, type GovernedSkill } from "../types/domain";
import type { GroupRecord, SkillInstanceRecord, TagRecord } from "../types/discovery";

type FilterKey = "all" | "ungrouped" | "untagged" | "no-note";

interface GovernState {
  instances: SkillInstanceRecord[];
  groups: GroupRecord[];
  tags: TagRecord[];
  notes: Map<string, string>;
  groupByPath: Map<string, string>;
  tagIdsByPath: Map<string, string[]>;
  agentNames: Map<string, string>;
}

const emptyState: GovernState = {
  instances: [],
  groups: [],
  tags: [],
  notes: new Map(),
  groupByPath: new Map(),
  tagIdsByPath: new Map(),
  agentNames: new Map(),
};

export function GovernPage({ onWriteBack }: { onWriteBack: () => void }) {
  const [state, setState] = useState<GovernState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [noteDraft, setNoteDraft] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newTagName, setNewTagName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [instances, groups, tags, noteRecords, groupPairs, tagPairs, targets] = await Promise.all([
        workspaceService.listSkillInstances(),
        workspaceService.listGroups(),
        workspaceService.listTags(),
        workspaceService.listSkillNotes(),
        workspaceService.listGroupAssignments(),
        workspaceService.listTagAssignments(),
        workspaceService.listAgentTargets(),
      ]);
      const agentNames = new Map(targets.map((target) => [target.id, target.name]));
      setState({
        instances: instances.filter((instance) => instance.state !== "missing"),
        groups,
        tags,
        notes: new Map(noteRecords.map((record) => [record.skillPath, record.note])),
        groupByPath: toMap(groupPairs),
        tagIdsByPath: toTagMap(tagPairs),
        agentNames,
      });
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const governed = useMemo<GovernedSkill[]>(() => {
    const groupNames = new Map(state.groups.map((group) => [group.id, group.name]));
    const tagNames = new Map(state.tags.map((tag) => [tag.id, tag.name]));
    return state.instances.map((instance) => {
      const groupId = state.groupByPath.get(instance.path) ?? null;
      const tagIds = state.tagIdsByPath.get(instance.path) ?? [];
      return {
        instance,
        note: state.notes.get(instance.path) ?? "",
        groupId,
        groupName: groupId ? groupNames.get(groupId) ?? null : null,
        tagIds,
        tagNames: tagIds.map((id) => tagNames.get(id) ?? id),
      };
    });
  }, [state]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return governed.filter((skill) => {
      if (filter === "ungrouped" && skill.groupId) return false;
      if (filter === "untagged" && skill.tagIds.length > 0) return false;
      if (filter === "no-note" && skill.note.trim()) return false;
      if (!normalized) return true;
      const haystack = `${skill.instance.name} ${skill.instance.description} ${displayPath(skill.instance.path)} ${skill.note} ${skill.groupName ?? ""} ${skill.tagNames.join(" ")}`;
      return haystack.toLowerCase().includes(normalized);
    });
  }, [governed, query, filter]);

  const selected = useMemo(
    () => governed.find((skill) => skill.instance.path === selectedPath) ?? null,
    [governed, selectedPath],
  );

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedPath !== null) setSelectedPath(null);
      return;
    }
    if (!selectedPath || !filtered.some((skill) => skill.instance.path === selectedPath)) {
      setSelectedPath(filtered[0].instance.path);
    }
  }, [filtered, selectedPath]);

  useEffect(() => {
    setNoteDraft(selected?.note ?? "");
    setNoteDirty(false);
  }, [selected?.instance.path, selected?.note]);

  const withBusy = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = (): void =>
    void withBusy(async () => {
      if (!selected) return;
      await workspaceService.setSkillNote(selected.instance.path, noteDraft);
      await load();
    });

  const changeGroup = (groupId: string | null): void =>
    void withBusy(async () => {
      if (!selected) return;
      await workspaceService.setSkillGroup(selected.instance.path, groupId);
      await load();
    });

  const toggleTag = (tagId: string): void =>
    void withBusy(async () => {
      if (!selected) return;
      const current = selected.tagIds;
      const next = current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId];
      await workspaceService.setSkillTags(selected.instance.path, next);
      await load();
    });

  const createGroup = (): void =>
    void withBusy(async () => {
      const name = newGroupName.trim();
      if (!name) return;
      await workspaceService.upsertGroup(name);
      setNewGroupName("");
      await load();
    });

  const createTag = (): void =>
    void withBusy(async () => {
      const name = newTagName.trim();
      if (!name) return;
      await workspaceService.upsertTag(name);
      setNewTagName("");
      await load();
    });

  const removeGroup = (group: GroupRecord): void =>
    void withBusy(async () => {
      await workspaceService.deleteGroup(group.id);
      await load();
    });

  const removeTag = (tag: TagRecord): void =>
    void withBusy(async () => {
      await workspaceService.deleteTag(tag.id);
      await load();
    });

  const suggestions = selected
    ? suggestTagNames(selected.instance, state.tags).filter(
        (name) => !selected.tagNames.includes(name),
      )
    : [];

  return (
    <div className="page">
      <PageHeader
        title="治理"
        subtitle="以 Skill 的真实路径为键记录分组、标签与中文简介——元数据独立存放，不改动 Skill 本体"
        actions={
          <Button variant="primary" onClick={onWriteBack}>
            下一步：写回 →
          </Button>
        }
      />

      {error ? <ErrorNotice error={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}

      <div className="govern-layout">
        <section className="panel-surface govern-list-panel">
          <div className="panel-toolbar">
            <SearchField value={query} onChange={setQuery} placeholder="搜索 Skill / 简介 / 分组…" />
          </div>
          <div className="filter-row" role="group" aria-label="治理筛选">
            {(
              [
                ["all", `全部 ${governed.length}`],
                ["ungrouped", "未分组"],
                ["untagged", "无标签"],
                ["no-note", "无简介"],
              ] as Array<[FilterKey, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? "filter-chip filter-chip-active" : "filter-chip"}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {loading ? (
            <EmptyState title="加载中" body="读取已发现的 Skill 与治理元数据…" />
          ) : filtered.length === 0 ? (
            <EmptyState title="没有匹配的 Skill" body="调整筛选条件，或先到「发现」页扫描目录。" />
          ) : (
            <ul className="govern-skill-list">
              {filtered.map((skill) => (
                <li key={skill.instance.id}>
                  <button
                    type="button"
                    className={
                      skill.instance.path === selectedPath
                        ? "govern-skill-item govern-skill-item-active"
                        : "govern-skill-item"
                    }
                    onClick={() => setSelectedPath(skill.instance.path)}
                  >
                    <span className="govern-skill-heading">
                      <strong>{skill.instance.name}</strong>
                      {skill.note.trim() ? <span className="note-dot" title="已写中文简介" /> : null}
                    </span>
                    <small>{state.agentNames.get(skill.instance.agentId) ?? skill.instance.agentId}</small>
                    <span className="govern-skill-meta">
                      {skill.groupName ? <StatusPill tone="blue">{skill.groupName}</StatusPill> : null}
                      {skill.tagNames.map((name) => (
                        <span key={name} className="tag-chip">{name}</span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {selected ? (
          <section className="panel-surface govern-inspector">
            <div className="inspector-title">
              <div>
                <h2>{selected.instance.name}</h2>
                <p className="mono-cell" title={displayPath(selected.instance.path)}>
                  {displayPath(selected.instance.path)}
                </p>
              </div>
              <StatusPill tone={selected.instance.scriptCount > 0 ? "amber" : "green"}>
                {selected.instance.scriptCount > 0 ? `scripts/${selected.instance.scriptCount}` : "无 scripts"}
              </StatusPill>
            </div>

            <div className="inspector-section">
              <span className="section-label">中文简要描述</span>
              <textarea
                className="note-input"
                value={noteDraft}
                placeholder="用一句中文说明这个 Skill 做什么，方便团队检索"
                onChange={(event) => {
                  setNoteDraft(event.target.value);
                  setNoteDirty(true);
                }}
              />
              <div className="inspector-actions-inline">
                <Button variant="primary" onClick={saveNote} disabled={busy || !noteDirty}>
                  保存简介
                </Button>
                {noteDirty ? <span className="muted-help">有未保存的修改</span> : null}
              </div>
            </div>

            <div className="inspector-section">
              <span className="section-label">分组（单选）</span>
              <div className="filter-row">
                <button
                  type="button"
                  className={!selected.groupId ? "filter-chip filter-chip-active" : "filter-chip"}
                  onClick={() => changeGroup(null)}
                  disabled={busy}
                >
                  未分组
                </button>
                {state.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={selected.groupId === group.id ? "filter-chip filter-chip-active" : "filter-chip"}
                    onClick={() => changeGroup(group.id)}
                    disabled={busy}
                  >
                    {group.name} · {group.skillCount}
                  </button>
                ))}
              </div>
              <div className="inline-create">
                <input
                  value={newGroupName}
                  placeholder="新建分组名称"
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createGroup();
                  }}
                />
                <Button onClick={createGroup} disabled={busy || !newGroupName.trim()}>新建分组</Button>
              </div>
              <div className="manage-row">
                {state.groups.map((group) => (
                  <span key={group.id} className="manage-token">
                    {group.name}
                    <button type="button" title={`删除分组 ${group.name}`} onClick={() => removeGroup(group)} disabled={busy}>×</button>
                  </span>
                ))}
              </div>
            </div>

            <div className="inspector-section">
              <span className="section-label">标签（多选）</span>
              <div className="filter-row">
                {state.tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={
                      selected.tagIds.includes(tag.id)
                        ? "filter-chip filter-chip-active"
                        : "filter-chip"
                    }
                    onClick={() => toggleTag(tag.id)}
                    disabled={busy}
                  >
                    {tag.name} · {tag.skillCount}
                    {tag.isSystem ? " ★" : ""}
                  </button>
                ))}
              </div>
              {suggestions.length > 0 ? (
                <div className="suggest-row">
                  <span className="muted-help">建议：</span>
                  {suggestions.map((name) => {
                    const tag = state.tags.find((item) => item.name === name);
                    return tag ? (
                      <button
                        key={name}
                        type="button"
                        className="filter-chip filter-chip-suggest"
                        onClick={() => toggleTag(tag.id)}
                        disabled={busy}
                      >
                        + {name}
                      </button>
                    ) : null;
                  })}
                </div>
              ) : null}
              <div className="inline-create">
                <input
                  value={newTagName}
                  placeholder="新建标签名称"
                  onChange={(event) => setNewTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createTag();
                  }}
                />
                <Button onClick={createTag} disabled={busy || !newTagName.trim()}>新建标签</Button>
              </div>
              <div className="manage-row">
                {state.tags.map((tag) => (
                  <span key={tag.id} className="manage-token">
                    {tag.name}
                    {tag.isSystem ? null : (
                      <button type="button" title={`删除标签 ${tag.name}`} onClick={() => removeTag(tag)} disabled={busy}>×</button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            <dl className="detail-list">
              <div><dt>内容哈希</dt><dd className="mono-cell" title={selected.instance.contentHash}>{shortHash(selected.instance.contentHash)}</dd></div>
              <div><dt>来源 Agent</dt><dd>{state.agentNames.get(selected.instance.agentId) ?? selected.instance.agentId}</dd></div>
              <div><dt>首次发现</dt><dd>{formatTimestamp(selected.instance.firstDiscoveredAt)}</dd></div>
              <div><dt>最近扫描</dt><dd>{formatTimestamp(selected.instance.lastDiscoveredAt)}</dd></div>
            </dl>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const toMap = (pairs: AssignmentRecord[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const pair of pairs) map.set(pair.skillPath, pair.targetId);
  return map;
};

const toTagMap = (pairs: AssignmentRecord[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const pair of pairs) {
    const current = map.get(pair.skillPath);
    if (current) current.push(pair.targetId);
    else map.set(pair.skillPath, [pair.targetId]);
  }
  return map;
};

const formatTimestamp = (seconds: number): string => {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
};
