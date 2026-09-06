import type { ReactNode } from "react";
import type { PageKey } from "../types/domain";

const navigation: Array<{ id: PageKey; label: string; icon: string }> = [
  { id: "skills", label: "Skills", icon: "S" },
  { id: "bundles", label: "Bundles", icon: "B" },
  { id: "agents", label: "Agents", icon: "A" },
  { id: "sync", label: "Sync", icon: "↻" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function AppShell({ activePage, onNavigate, children }: { activePage: PageKey; onNavigate: (page: PageKey) => void; children: ReactNode }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✦</span><div><strong>Skills</strong><span>Control Center</span></div></div>
      <nav className="primary-nav" aria-label="Primary">
        {navigation.map((item) => <button className={activePage === item.id ? "nav-item nav-item-active" : "nav-item"} key={item.id} onClick={() => onNavigate(item.id)} type="button"><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-section">
        <span className="sidebar-label">Collections</span>
        <button type="button"><i className="collection-dot dot-blue" />研发效率 <span>8</span></button>
        <button type="button"><i className="collection-dot dot-violet" />文档方案 <span>5</span></button>
        <button type="button"><i className="collection-dot dot-green" />代码评审 <span>4</span></button>
        <button type="button"><i className="collection-dot dot-amber" />数据分析 <span>3</span></button>
      </div>
      <div className="sidebar-footer"><span className="mini-badge">M1</span><div><strong>UI Baseline</strong><span>Local-first</span></div></div>
    </aside>
    <main className="app-content">{children}</main>
  </div>;
}
