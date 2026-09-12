import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AgentCenterSnapshot,
  AgentInstallPlan,
  ProjectArea,
  ScanStatus,
} from "../types/agentCenter";
import type {
  AgentPreferences,
  ManagementView,
  AgentImportPreview,
} from "../types/agentCenter";
import type { ApplyOperationRecord } from "../types/bundlePlanner";
export const desktop = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export function commandMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "操作未完成，请重试";
  if (message.includes("sync plan is stale"))
    return "内容已变化，请重新确认变更";
  if (message.includes("unresolved conflicts"))
    return "仍有未处理的冲突，请先处理后重试";
  if (message.includes("does not contain any changes"))
    return "内容已是最新，无需再次写入";
  if (
    message.includes("no longer available for apply") ||
    message.includes("previewed sync plan was not found")
  )
    return "这份计划已执行或已失效，请重新检查";
  return message;
}
async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop()) throw new Error("请在桌面应用中执行此操作");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(commandMessage(error));
  }
}
const names = [
  ["claude-code", "Claude Code", "Anthropic"],
  ["codex", "Codex", "OpenAI"],
  ["cursor", "Cursor", "Anysphere"],
  ["windsurf", "Windsurf", "Cognition"],
  ["github-copilot", "GitHub Copilot", "GitHub"],
  ["gemini-cli", "Gemini CLI", "Google"],
  ["opencode", "OpenCode", "OpenCode"],
  ["openclaw", "OpenClaw", "OpenClaw"],
  ["cline", "Cline", "Cline"],
  ["trae", "TRAE", "ByteDance"],
  ["trae-cn", "TRAE CN", "字节跳动"],
  ["codebuddy", "CodeBuddy", "腾讯"],
  ["qoder", "Qoder", "Qoder"],
  ["qwen-code", "Qwen Code", "阿里云"],
  ["kimi-code", "Kimi Code", "Moonshot AI"],
];
const emptySnapshot = (): AgentCenterSnapshot => ({
  catalog: names.map(([id, name, provider]) => ({
    id,
    name,
    provider,
    commands: [],
    userRoots: [],
    projectRoots: [],
    docs: "",
    verifiedAt: "2026-09-09",
  })),
  agents: names.map(([id, name, provider]) => ({
    id,
    name,
    provider,
    capabilities: [],
    detected: false,
    executablePath: null,
    version: null,
    lastWarning: null,
    lastScannedAt: null,
  })),
  detections: {},
  roots: [],
  rootDetails: {},
  skills: [],
  projects: [],
  projectDiagnostics: {},
  scan: {
    running: false,
    cancelled: false,
    completed: 0,
    total: 0,
    current: "",
    startedAt: null,
    finishedAt: null,
    error: null,
  },
});
export const agentCenterService = {
  preferences: (): Promise<AgentPreferences> =>
    desktop()
      ? call("get_agent_preferences")
      : Promise.resolve({
          lastAgentId: null,
          scopes: {},
          targets: {},
          sorts: {},
        }),
  savePreferences: (preferences: AgentPreferences) =>
    desktop()
      ? call<void>("save_agent_preferences", { preferences })
      : Promise.resolve(),
  management: (agentId: string, scopeId: string): Promise<ManagementView> =>
    desktop()
      ? call("get_agent_management", { agentId, scopeId })
      : Promise.resolve({
          agentId,
          scopeId,
          scopes: [{ id: "user", name: "所有项目", path: null, rootIds: [] }],
          targets: [],
          targetId: null,
          skills: [],
          checkedAt: 0,
        }),
  updates: (agentId: string, scopeId: string, ids: string[]) =>
    call<AgentInstallPlan[]>("preview_agent_updates", {
      agentId,
      scopeId,
      ids,
    }),
  prepareImport: (path: string | null, instanceId: string | null) =>
    call<AgentImportPreview>("prepare_agent_import", { path, instanceId }),
  importPrepared: (id: string, name: string, description: string) =>
    call<{ outcome: string; skill: { id: string; name: string } }>(
      "import_agent_skill",
      { id, name, description },
    ),
  bind: (instanceId: string, libraryId: string) =>
    call<void>("bind_agent_skill", { instanceId, libraryId }),
  preferredRoot: (agentId: string, project: string | null) =>
    call<{ id: string }>("register_preferred_agent_root", { agentId, project }),
  relocate: (id: string, path: string) =>
    call<{ id: string }>("relocate_agent_root", { id, path }),
  async snapshot(): Promise<AgentCenterSnapshot> {
    return desktop() ? call("get_agent_center") : emptySnapshot();
  },
  scan: (agentId?: string, rootId?: string) =>
    call<ScanStatus>("start_agent_scan", {
      agentId: agentId ?? null,
      rootId: rootId ?? null,
    }),
  cancel: () => call<void>("cancel_agent_scan"),
  async pickDirectory(title: string): Promise<string | null> {
    if (!desktop()) throw new Error("请在桌面应用中选择目录");
    const result = await open({ directory: true, multiple: false, title });
    return Array.isArray(result) ? (result[0] ?? null) : result;
  },
  saveProject: (path: string, maxDepth = 6, enabled = true) =>
    call<ProjectArea>("save_project_area", { path, maxDepth, enabled }),
  removeProject: (id: string) => call<void>("remove_project_area", { id }),
  toggleRoot: (id: string, enabled: boolean) =>
    call<void>("set_agent_root_enabled", { id, enabled }),
  registerRoot: (agentId: string, path: string, scope: string) =>
    call<{ id: string }>("register_agent_root", { agentId, path, scope }),
  openRoot: (rootId: string, reveal = false) =>
    call<void>("open_agent_path", { rootId, skillId: null, reveal }),
  openSkill: (skillId: string, reveal = false) =>
    call<void>("open_agent_path", { rootId: null, skillId, reveal }),
  content: (id: string) => call<string>("read_agent_skill", { id }),
  preview: (skillIds: string[], rootIds: string[]) =>
    call<AgentInstallPlan[]>("preview_agent_install", { skillIds, rootIds }),
  apply: (planId: string) =>
    call<ApplyOperationRecord>("apply_agent_install", { planId }),
  restore: (operationId: string) =>
    call<ApplyOperationRecord>("restore_agent_install", { operationId }),
};
