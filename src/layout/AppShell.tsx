import type { ReactNode } from "react";

/**
 * 桌面应用外壳容器。
 *
 * 采用现代无边框工作台结构，由 WorkspacePage 内部的三栏布局统一编排，
 * 消除多余的顶部空白，将全屏可用空间完整留给技能资产管理。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-window-frame">
      <div className="app-window-content">{children}</div>
    </div>
  );
}
