import { Button } from "./ui";
import type { WorkspaceController } from "../hooks/useWorkspace";
import type { SkillEntry } from "../types/domain";

/** 分组 / 标签超过这个数量就折叠，否则详情区被 chip 淹没。 */
const FOLD_THRESHOLD = 12;

interface Props {
  controller: WorkspaceController;
  entry: SkillEntry;
}

/**
 * 治理区：分组、标签、中文简介。
 *
 * 元数据全部落在本地库，不写回 Skill 本体；简介失焦即存，治 100 个 Skill 不用点
 * 100 次「保存」。标签数量多时折叠，但「当前已选」永远留在外面 —— 用户最常看的是
 * 这个 Skill 现在有什么标签，而不是全部可选标签。
 */
export function GovernancePanel({ controller, entry }: Props) {
  const {
    snapshot,
    suggestions,
    busy,
    changeGroup,
    toggleTag,
    saveNote,
    createGroup,
    createTag,
    noteDraft,
    setNoteDraft,
    newGroupName,
    setNewGroupName,
    newTagName,
    setNewTagName,
  } = controller;

  const groupNeedsFold = snapshot.groups.length > FOLD_THRESHOLD;
  const tagNeedsFold = snapshot.tags.length > FOLD_THRESHOLD;

  const groupChips = (
    <>
      <button
        type="button"
        className={!entry.groupId ? "chip chip-active" : "chip"}
        onClick={() => changeGroup(entry, null)}
        disabled={busy}
      >
        未分组
      </button>
      {snapshot.groups.map((group) => (
        <button
          key={group.id}
          type="button"
          className={entry.groupId === group.id ? "chip chip-active" : "chip"}
          onClick={() => changeGroup(entry, group.id)}
          disabled={busy}
        >
          {group.name}
          <span className="chip-count">{group.skillCount}</span>
        </button>
      ))}
    </>
  );

  const tagChips = snapshot.tags.map((tag) => (
    <button
      key={tag.id}
      type="button"
      className={entry.tagIds.includes(tag.id) ? "chip chip-active" : "chip"}
      onClick={() => toggleTag(entry, tag.id)}
      disabled={busy}
    >
      {tag.name}
      <span className="chip-count">{tag.skillCount}</span>
    </button>
  ));

  const suggestionChips =
    suggestions.length > 0 ? (
      <div className="chip-row">
        <span className="section-label">建议</span>
        {suggestions.map((name) => {
          const tag = snapshot.tags.find((item) => item.name === name);
          return tag ? (
            <button
              key={name}
              type="button"
              className="chip chip-suggest"
              onClick={() => toggleTag(entry, tag.id)}
              disabled={busy}
            >
              + {name}
            </button>
          ) : null;
        })}
      </div>
    ) : null;

  const currentTags = entry.tagIds
    .map((id) => snapshot.tags.find((tag) => tag.id === id))
    .filter((tag): tag is (typeof snapshot.tags)[number] => Boolean(tag));

  return (
    <section className="detail-section">
      <div className="section-head">
        <h3>治理</h3>
        <span className="section-hint">元数据存本地库，不改动 Skill 本体</span>
      </div>
      <div className="govern-grid">
        <div className="govern-block">
          <span className="section-label">分组</span>
          {groupNeedsFold ? (
            <>
              <div className="chip-row">
                <span className="chip chip-active" title={entry.groupName ?? "未分组"}>
                  {entry.groupName ?? "未分组"}
                </span>
              </div>
              <details className="fold">
                <summary className="fold-summary">
                  全部分组
                  <span className="panel-count">{snapshot.groups.length}</span>
                </summary>
                <div className="fold-body">
                  <div className="chip-row">{groupChips}</div>
                </div>
              </details>
            </>
          ) : (
            <div className="chip-row">{groupChips}</div>
          )}
          <div className="inline-create">
            <input
              value={newGroupName}
              placeholder="新建分组"
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createGroup();
              }}
            />
            <Button onClick={createGroup} disabled={busy || !newGroupName.trim()}>
              新建
            </Button>
          </div>
        </div>

        <div className="govern-block">
          <span className="section-label">标签</span>
          {tagNeedsFold ? (
            <div className="chip-row">
              {currentTags.length === 0 ? (
                <span className="chip chip-active">未加标签</span>
              ) : (
                currentTags.map((tag) => (
                  <span key={tag.id} className="chip chip-active">
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          ) : null}
          <div className="inline-create">
            <input
              value={newTagName}
              placeholder="新建标签"
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createTag();
              }}
            />
            <Button onClick={createTag} disabled={busy || !newTagName.trim()}>
              新建
            </Button>
          </div>
          {tagNeedsFold ? (
            <details className="fold">
              <summary className="fold-summary">
                全部标签
                <span className="panel-count">{snapshot.tags.length}</span>
              </summary>
              <div className="fold-body">
                <div className="chip-row">{tagChips}</div>
                {suggestionChips}
              </div>
            </details>
          ) : (
            <>
              <div className="chip-row">{tagChips}</div>
              {suggestionChips}
            </>
          )}
        </div>

        <div className="govern-block">
          <span className="section-label">中文简介</span>
          <textarea
            className="note-input"
            value={noteDraft}
            placeholder="用一句中文说明这个 Skill 做什么"
            onChange={(event) => setNoteDraft(event.target.value)}
            onBlur={saveNote}
          />
          <span className="muted-help">失焦自动保存</span>
        </div>
      </div>
    </section>
  );
}
