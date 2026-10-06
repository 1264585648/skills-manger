import { useState, useCallback } from "react";
import { workspaceService } from "../services/workspaceService";
import type { SkillEntry } from "../types/domain";

interface Props {
  withBusy: (action: () => Promise<void>) => Promise<void>;
  reload: (force?: boolean) => Promise<void>;
  setNotice: (msg: string | null) => void;
}

export function useSkillVault({ withBusy, reload, setNotice }: Props) {
  const [conflictEntry, setConflictEntry] = useState<SkillEntry | null>(null);

  const incorporateToVault = useCallback(
    (entry: SkillEntry) =>
      withBusy(async () => {
        await workspaceService.incorporateToVault(entry.path);
        setNotice(`「${entry.name}」已成功纳管入中央库`);
        await reload(true);
      }),
    [withBusy, reload, setNotice],
  );

  const autoMergeIdentical = useCallback(
    () =>
      withBusy(async () => {
        const report = await workspaceService.autoMergeIdentical();
        if (report.mergedNames.length > 0) {
          setNotice(`已自动合并 ${report.mergedNames.length} 个完全一致的技能为中央库标准版`);
        } else {
          setNotice("未检测到可自动合并的完全一致副本");
        }
        await reload(true);
      }),
    [withBusy, reload, setNotice],
  );

  const manualMergeKeepOne = useCallback(
    (skillName: string, winnerPath: string) =>
      withBusy(async () => {
        await workspaceService.manualMergeKeepOne(skillName, winnerPath);
        setNotice(`已保留选定版本作为「${skillName}」的唯一标准库`);
        setConflictEntry(null);
        await reload(true);
      }),
    [withBusy, reload, setNotice],
  );

  const forkSkill = useCallback(
    (sourcePath: string, newName: string) =>
      withBusy(async () => {
        await workspaceService.forkSkill(sourcePath, newName);
        setNotice(`已成功分叉创建新技能「${newName}」入中央库`);
        setConflictEntry(null);
        await reload(true);
      }),
    [withBusy, reload, setNotice],
  );

  return {
    conflictEntry,
    setConflictEntry,
    incorporateToVault,
    autoMergeIdentical,
    manualMergeKeepOne,
    forkSkill,
  };
}
