import { useCallback, useState } from "react";
import { workspaceService, type AgentCatalogEntry } from "../services/workspaceService";
import { displayPath } from "../types/domain";
import type { DiscoveryRootRecord } from "../types/discovery";

interface RegistryDeps {
  catalog: AgentCatalogEntry[];
  withBusy: (action: () => Promise<void>) => Promise<void>;
  reload: (force?: boolean) => Promise<void>;
  setNotice: (value: string) => void;
  setError: (value: unknown) => void;
}

const matchesConvention = (path: string, patterns: string[]): boolean => {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return patterns.some((pattern) => normalized.endsWith(pattern.toLowerCase()));
};

/**
 * 目录登记：把「项目里的 skills 目录」加进扫描范围。
 *
 * 用户级目录由 Agent 约定自动推导，不需要登记；这里只管用户显式添加的项目目录，
 * 所以移除操作也只针对非默认登记（`root.isDefault` 的那批不可删）。
 */
export function useDirectoryRegistry({
  catalog,
  withBusy,
  reload,
  setNotice,
  setError,
}: RegistryDeps) {
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState("claude-code");

  const pickDirectory = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const path = await workspaceService.pickSkillsDirectory();
      if (!path) return;
      setPickedPath(path);
      // 目录名符合某个 Agent 的项目约定时自动选上，省一次手动切换。
      const matched = catalog.find((agent) => matchesConvention(path, agent.projectRoots));
      if (matched) setPickedAgentId(matched.id);
    });
  }, [catalog, withBusy]);

  const addRoot = useCallback((): void => {
    if (!pickedPath) return;
    void withBusy(async () => {
      await workspaceService.addProjectRoot(pickedAgentId, pickedPath);
      setNotice(`已登记项目目录：${displayPath(pickedPath)}`);
      setPickedPath(null);
      await reload(true);
    });
  }, [pickedPath, pickedAgentId, withBusy, reload, setNotice]);

  /** 只摘掉登记记录与它可能创建的连接；源目录里的 Skill 本体不受影响。 */
  const removeRoot = useCallback(
    (root: DiscoveryRootRecord): void =>
      void withBusy(async () => {
        await workspaceService.removeProjectRoot(root.id);
        setNotice(`已移除登记：${displayPath(root.configuredPath)}`);
        await reload(true);
      }),
    [withBusy, reload, setNotice],
  );

  const copyPath = useCallback(
    async (path: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(displayPath(path));
        setNotice("路径已复制");
      } catch {
        setError(new Error("剪贴板不可用"));
      }
    },
    [setNotice, setError],
  );

  return { pickedPath, pickedAgentId, setPickedAgentId, pickDirectory, addRoot, removeRoot, copyPath };
}
