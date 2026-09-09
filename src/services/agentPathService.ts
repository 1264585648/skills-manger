import { invoke } from "@tauri-apps/api/core";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const formatCommandError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "打开目录失败";
};

/**
 * 在系统文件管理器中打开 Agent Root 目录。
 *
 * 依赖 Agent Center 开发线提供的 `open_agent_path` command；该 command 可能被改名或移除，
 * 因此这里只做薄封装并把失败转成可读错误，调用方降级为"复制路径"即可。
 */
export const openAgentRootDirectory = async (rootId: string): Promise<void> => {
  if (!isTauriRuntime()) {
    throw new Error("打开目录需要在桌面应用中执行");
  }
  try {
    await invoke("open_agent_path", { rootId, skillId: null });
  } catch (error) {
    throw new Error(formatCommandError(error));
  }
};
