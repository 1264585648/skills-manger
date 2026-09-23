import type { ReactNode } from "react";

/**
 * 顶栏 + 内容区。
 *
 * 三步导航被撤掉了：发现/治理/写回不再是三个页面，而是同一屏里的三个区域，
 * 顶栏因此只保留品牌和全局状态，不再承担导航职责。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✦
          </span>
          <strong>Skills Control Center</strong>
        </div>
        <span className="topbar-note">软连接写回 · 不复制文件</span>
      </header>
      <main className="app-content">{children}</main>
    </div>
  );
}
