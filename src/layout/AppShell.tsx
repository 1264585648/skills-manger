import type { ReactNode } from "react";
import type { PageKey } from "../types/domain";

const navigation: Array<{ id: PageKey; label: string; icon: string; hint: string }> = [
  { id: "discover", label: "发现", icon: "⌕", hint: "扫描 Agent 与项目目录" },
  { id: "govern", label: "治理", icon: "☰", hint: "分组 / 标签 / 中文简介" },
  { id: "writeback", label: "写回", icon: "↔", hint: "软连接跨 Agent 写入" },
];

export function AppShell({ activePage, onNavigate, children }: { activePage: PageKey; onNavigate: (page: PageKey) => void; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <div>
            <strong>Skills Manager</strong>
            <span>发现 → 治理 → 写回</span>
          </div>
        </div>
        <nav className="primary-nav" aria-label="Primary">
          {navigation.map((item) => (
            <button
              className={activePage === item.id ? "nav-item nav-item-active" : "nav-item"}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="nav-text">
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="mini-badge">Local-first</span>
          <span>软连接写回 · 不复制文件</span>
        </div>
      </aside>
      <main className="app-content">{children}</main>
    </div>
  );
}
