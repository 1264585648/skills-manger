import { AppShell } from "./layout/AppShell";
import { WorkspacePage } from "./pages/WorkspacePage";

/**
 * 单页工作区：发现、治理、写回同屏完成。
 *
 * 三者原本是三个页面，切换即丢失选中状态并重载一遍数据；实际上用户要做的
 * 只有一件事——把某个 Skill 装到某个 Agent 上，不需要一次流程。
 */
export default function App() {
  return (
    <AppShell>
      <WorkspacePage />
    </AppShell>
  );
}
