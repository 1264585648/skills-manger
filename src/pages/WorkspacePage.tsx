import { useWorkspace } from "../hooks/useWorkspace";
import { SkillDetail } from "../components/SkillDetail";
import { SkillList } from "../components/SkillList";
import { ErrorNotice } from "../components/ui";

/**
 * 单页工作区：左侧 Skill 列表，右侧同屏完成分发与治理。
 *
 * 发现 / 治理 / 写回不再是三个页面，而是同一屏里的三个区域 —— 选中状态、筛选、
 * 数据全部共享，切换区域不产生任何跳转或重新加载。
 */
export function WorkspacePage() {
  const controller = useWorkspace();

  return (
    <div className="workspace">
      {controller.error ? (
        <ErrorNotice
          error={controller.error}
          onRetry={() => void controller.reload(true)}
          onDismiss={() => controller.setError(null)}
        />
      ) : null}
      <SkillList controller={controller} />
      <SkillDetail controller={controller} />
    </div>
  );
}
