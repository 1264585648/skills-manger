import { useState } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { AppNavRail } from "../components/AppNavRail";
import { SkillCatalog } from "../components/SkillCatalog";
import { SkillInspector } from "../components/SkillInspector";
import { AgentMatrixModal } from "../components/AgentMatrixModal";
import { DirectoryModal } from "../components/DirectoryModal";
import { SkillConflictModal } from "../components/SkillConflictModal";
import { ErrorNotice } from "../components/ui";

/**
 * 现代三栏式技能工作台：
 * 1. 左栏 (AppNavRail): 宏观导航、Agent 探测状态、目录登记入口与本地数据库状态；
 * 2. 中栏 (SkillCatalog - 占据绝对主体): 技能卡片阵列 (Card Grid) / 紧凑列表、即时过滤、全局搜索与浮动批量操作；
 * 3. 右栏 (SkillInspector - 治理与分发看板): 选中 Skill 的健康状态、Agent 分发 Toggle 开关、零拷贝写回拓扑与就地治理。
 */
export function WorkspacePage() {
  const controller = useWorkspace();
  const [agentsModalOpen, setAgentsModalOpen] = useState(false);
  const [directoriesModalOpen, setDirectoriesModalOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const handleSelectSkill = (path: string) => {
    controller.setSelectedPath(path);
    setInspectorOpen(true);
  };

  return (
    <div className={`workspace-layout ${inspectorOpen && controller.selected ? "inspector-expanded" : "inspector-collapsed"}`}>
      {/* 顶部全局错误通知 */}
      {controller.error ? (
        <div className="workspace-error-banner">
          <ErrorNotice
            error={controller.error}
            onRetry={() => void controller.reload(true)}
            onDismiss={() => controller.setError(null)}
          />
        </div>
      ) : null}

      {/* 1. 左侧导航控制台 */}
      <AppNavRail
        controller={controller}
        onOpenAgentsModal={() => setAgentsModalOpen(true)}
        onOpenDirectoriesModal={() => setDirectoriesModalOpen(true)}
      />

      {/* 2. 中央主舞台：Skill 资产管理中心（占据主体） */}
      <main className="workspace-main-stage">
        <SkillCatalog
          controller={controller}
          onOpenDirectoriesModal={() => setDirectoriesModalOpen(true)}
          onSelectSkill={handleSelectSkill}
        />
      </main>

      {/* 3. 右侧治理与分发看板（可自由折叠与展开） */}
      {inspectorOpen && controller.selected ? (
        <SkillInspector
          controller={controller}
          onClose={() => setInspectorOpen(false)}
        />
      ) : null}

      {/* 全局浮动操作反馈 Toast */}
      {controller.notice ? (
        <div className="toast" role="status" key={controller.notice}>
          <span className="toast-dot" />
          <span>{controller.notice}</span>
        </div>
      ) : null}

      {/* 弹窗：Agent 矩阵状态探测 */}
      <AgentMatrixModal
        open={agentsModalOpen}
        onClose={() => setAgentsModalOpen(false)}
        controller={controller}
      />

      {/* 弹窗：登记项目目录与扫描告警 */}
      <DirectoryModal
        open={directoriesModalOpen}
        onClose={() => setDirectoriesModalOpen(false)}
        controller={controller}
      />

      {/* 弹窗：技能冲突裁决与合并 */}
      <SkillConflictModal
        entry={controller.conflictEntry}
        onClose={() => controller.setConflictEntry(null)}
        onKeepOne={controller.manualMergeKeepOne}
        onFork={controller.forkSkill}
        agentName={controller.agentName}
        busy={controller.busy}
      />
    </div>
  );
}
