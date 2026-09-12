import { FileText, Link2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { ManagedSkill } from "../../types/agentCenter";
import { Menu, Loading } from "./Drawer";
export const stateLabels = {
  added: "已添加",
  update: "有更新",
  issue: "需要处理",
  unverified: "状态待确认",
};
export function SkillList({
  items,
  selected,
  onSelect,
  onDetail,
  onUpdate,
  onImport,
  onLocate,
  loading,
  scrollKey,
  initialScroll,
  onScroll,
  highlight,
  emptyAction,
  filtered = false,
}: {
  items: ManagedSkill[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onDetail: (id: string) => void;
  onUpdate: (ids: string[]) => void;
  onImport: (id: string) => void;
  onLocate: (id: string) => void;
  loading: boolean;
  scrollKey: string;
  initialScroll: number;
  onScroll: (top: number) => void;
  highlight?: string[];
  emptyAction?: () => void;
  filtered?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useRef(initialScroll);
  useLayoutEffect(() => {
    position.current = initialScroll;
    if (ref.current) ref.current.scrollTop = initialScroll;
  }, [scrollKey, initialScroll]);
  useLayoutEffect(() => {
    if (!loading && ref.current) ref.current.scrollTop = position.current;
  }, [loading]);
  useLayoutEffect(() => {
    if (highlight?.length)
      ref.current
        ?.querySelector(".ux-highlight")
        ?.scrollIntoView({ block: "nearest" });
  }, [highlight, items]);
  const names = new Map<string, number>();
  items.forEach((s) => names.set(s.name, (names.get(s.name) ?? 0) + 1));
  return (
    <div
      className="ux-table-scroll"
      ref={ref}
      onScroll={(e) => {
        if (items.length) {
          position.current = e.currentTarget.scrollTop;
          onScroll(e.currentTarget.scrollTop);
        }
      }}
    >
      <table className="ux-skill-table">
        <thead>
          <tr>
            <th className="ux-select-col">
              <input
                aria-label="选择全部技能"
                type="checkbox"
                checked={
                  items.length > 0 &&
                  items.every((s) => selected.includes(s.id))
                }
                onChange={(e) =>
                  onSelect(e.target.checked ? items.map((s) => s.id) : [])
                }
              />
            </th>
            <th>技能</th>
            <th className="ux-state-col">状态</th>
            <th className="ux-action-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((skill) => (
            <tr
              key={skill.id}
              data-skill-id={skill.id}
              className={
                skill.libraryId && highlight?.includes(skill.libraryId)
                  ? "ux-highlight"
                  : ""
              }
            >
              <td>
                <input
                  aria-label={`选择 ${skill.name}`}
                  type="checkbox"
                  checked={selected.includes(skill.id)}
                  onChange={() =>
                    onSelect(
                      selected.includes(skill.id)
                        ? selected.filter((id) => id !== skill.id)
                        : [...selected, skill.id],
                    )
                  }
                />
              </td>
              <td>
                <button
                  className="ux-skill-title"
                  onClick={() => onDetail(skill.id)}
                >
                  {skill.name}
                  {skill.linked ? <Link2 size={12} aria-hidden="true" /> : null}
                </button>
                <p className="ux-description" title={skill.description}>
                  {skill.description || "暂无简介"}
                </p>
                {(names.get(skill.name) ?? 0) > 1 ? (
                  <small className="ux-source-context" title={skill.paths[0]}>
                    {skill.paths[0]}
                  </small>
                ) : null}
              </td>
              <td>
                <span className={`ux-state ux-state-${skill.state}`}>
                  {stateLabels[skill.state]}
                </span>
                {skill.readonly ? (
                  <small className="ux-readonly">只读来源</small>
                ) : null}
              </td>
              <td>
                <div className="ux-row-actions">
                  {skill.canUpdate ? (
                    <button
                      className="ux-link"
                      onClick={() => onUpdate([skill.id])}
                    >
                      更新
                    </button>
                  ) : skill.state === "issue" ||
                    skill.state === "unverified" ? (
                    <button
                      className="ux-link"
                      onClick={() => onDetail(skill.id)}
                    >
                      处理
                    </button>
                  ) : (
                    <button
                      className="ux-link ux-quiet"
                      onClick={() => onDetail(skill.id)}
                    >
                      详情
                    </button>
                  )}
                  <Menu label={`${skill.name} 更多操作`}>
                    <button role="menuitem" onClick={() => onDetail(skill.id)}>
                      查看详情
                    </button>
                    {skill.canImport ? (
                      <button
                        role="menuitem"
                        onClick={() => onImport(skill.id)}
                      >
                        加入技能库
                      </button>
                    ) : null}
                    <button role="menuitem" onClick={() => onLocate(skill.id)}>
                      定位入口
                    </button>
                  </Menu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length ? (
        loading ? (
          <Loading text="正在检查技能" />
        ) : (
          <div className="ux-empty">
            <FileText size={31} />
            <h3>{filtered ? "没有匹配的技能" : "这里还没有技能"}</h3>
            {emptyAction ? (
              <button className="ux-link" onClick={emptyAction}>
                {filtered ? "清除筛选" : "添加技能"}
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
