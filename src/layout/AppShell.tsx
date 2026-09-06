import type { ReactNode } from "react";
import type { PageKey } from "../types/domain";

const navigation: Array<{ id: PageKey; label: string; icon: string }> = [
  { id: "home", label: "我的环境", icon: "⌂" },
  { id: "skills", label: "Skills", icon: "S" },
  { id: "bundles", label: "工作流", icon: "W" },
  { id: "agents", label: "Agents", icon: "A" },
  { id: "sync", label: "环境更新", icon: "↻" },
  { id: "settings", label: "设置", icon: "⚙" },
];

export function AppShell({ activePage, onNavigate, children }: { activePage: PageKey; onNavigate: (page: PageKey) => void; children: ReactNode }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✦</span><div><strong>AI Environment</strong><span>Skills Manager</span></div></div>
      <nav className="primary-nav" aria-label="Primary">
        {navigation.map((item) => <button className={activePage === item.id ? "nav-item nav-item-active" : "nav-item"} key={item.id} onClick={() => onNavigate(item.id)} type="button"><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-footer"><span className="mini-badge">V2</span><div><strong>Environment</strong><span>Local-first</span></div></div>
    </aside>
    <main className="app-content">{children}</main>
  </div>;
}
