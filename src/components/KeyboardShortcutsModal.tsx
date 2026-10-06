import { Modal } from "./ui";
import { IconKeyboard } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: "导航与选择" | "批量与操作" | "全局与检索";
}

const SHORTCUTS: ShortcutItem[] = [
  {
    keys: ["↑", "↓", "或", "J", "K"],
    description: "在主舞台上下快速切换选中的 Skill 技能",
    category: "导航与选择",
  },
  {
    keys: ["Enter"],
    description: "快速展开或聚焦选中的 Skill 治理看板",
    category: "导航与选择",
  },
  {
    keys: ["Space"],
    description: "切换当前聚焦 Skill 的多选勾选状态",
    category: "批量与操作",
  },
  {
    keys: ["Shift", "+", "Click"],
    description: "区域多选：连续勾选两个 Skill 之间的全部项",
    category: "批量与操作",
  },
  {
    keys: ["/"],
    description: "快速聚焦全局搜索输入框进行即时过滤",
    category: "全局与检索",
  },
  {
    keys: ["Esc"],
    description: "关闭当前弹窗、清除搜索输入焦点或收起看板",
    category: "全局与检索",
  },
  {
    keys: ["?"],
    description: "打开或关闭本键盘快捷键指南速查表",
    category: "全局与检索",
  },
];

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  const categories = ["导航与选择", "批量与操作", "全局与检索"] as const;

  return (
    <Modal open={open} onClose={onClose} title="键盘快捷键速查指南">
      <div className="shortcuts-modal-content">
        <div className="shortcuts-modal-head">
          <div className="shortcuts-modal-badge">
            <IconKeyboard style={{ marginRight: 6 }} />
            全键盘极速流 · Pro Navigation
          </div>
          <p className="shortcuts-modal-desc">
            无须离开键盘，即可在数十个本地 Agent 技能中实现极速流转、批量编排与治理。
          </p>
        </div>

        <div className="shortcuts-list-container">
          {categories.map((category) => (
            <div key={category} className="shortcut-category-group">
              <h4 className="shortcut-category-title">{category}</h4>
              <div className="shortcut-items-grid">
                {SHORTCUTS.filter((s) => s.category === category).map((item, idx) => (
                  <div key={idx} className="shortcut-item-row">
                    <div className="shortcut-keys-wrapper">
                      {item.keys.map((key, kIdx) =>
                        key === "或" || key === "+" ? (
                          <span key={kIdx} className="shortcut-key-separator">
                            {key}
                          </span>
                        ) : (
                          <kbd key={kIdx} className="shortcut-key-kbd">
                            {key}
                          </kbd>
                        ),
                      )}
                    </div>
                    <span className="shortcut-desc-text">{item.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
