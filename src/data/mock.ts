import type { Agent, Bundle, Skill, SourceConfig, SyncItem } from "../types/domain";

export const mockSkills: Skill[] = [
  { id: "skill-human-read-tech-html", name: "human-read-tech-html", description: "把复杂技术方案整理成人类阅读友好的单页 HTML。", source: "GitHub · main", version: "v1.8.2", status: "update", groups: ["文档方案", "研发效率"], bundles: ["研发通用工具包"], targets: ["Claude Code", "Codex"], lastUpdated: "2 天前", security: "2 个 scripts · 未执行" },
  { id: "skill-archify", name: "archify", description: "从结构化描述生成技术架构图。", source: "Local", version: "v0.9.4", status: "clean", groups: ["文档方案"], bundles: ["研发通用工具包"], targets: ["Claude Code"], lastUpdated: "今天", security: "无可执行脚本" },
  { id: "skill-code-review", name: "code-review", description: "代码评审流程与检查清单。", source: "Claude User", version: "untracked", status: "unmanaged", groups: ["代码评审"], bundles: [], targets: ["Claude Code"], lastUpdated: "5 天前", security: "外部 Skill · 尚未接管" },
  { id: "skill-java-testing", name: "java-testing", description: "Java 测试策略与常用测试模式。", source: "Library", version: "v1.2.0", status: "conflict", groups: ["研发效率"], bundles: ["后端开发"], targets: ["Claude Code"], lastUpdated: "昨天", security: "无可执行脚本" },
  { id: "skill-design-to-code", name: "design-to-code", description: "从设计稿组织前端实现步骤。", source: "GitHub · pinned", version: "v2.1.0", status: "clean", groups: ["研发效率"], bundles: ["前端开发"], targets: ["Claude Code", "Codex"], lastUpdated: "1 周前", security: "1 个 script · 未执行" },
];

export const mockBundles: Bundle[] = [
  { id: "bundle-dev-common", name: "研发通用工具包", description: "方案、架构、评审与提示词检查的常用组合。", skillIds: ["skill-human-read-tech-html", "skill-archify", "skill-code-review", "skill-java-testing"], targets: ["Claude Code", "Codex"], updatedAt: "今天 10:24", conflict: "java-testing 与项目中的 legacy-test-policy 存在规则覆盖。" },
  { id: "bundle-backend", name: "后端开发", description: "面向服务端编码、测试和评审。", skillIds: ["skill-code-review", "skill-java-testing"], targets: ["Claude Code"], updatedAt: "昨天" },
  { id: "bundle-frontend", name: "前端开发", description: "设计落地与前端研发常用能力。", skillIds: ["skill-design-to-code", "skill-code-review"], targets: ["Claude Code", "Codex"], updatedAt: "3 天前" },
];

export const mockAgents: Agent[] = [
  { id: "agent-claude", name: "Claude Code", type: "CLI · Local", status: "ready", version: "2.1.3", path: "~/.claude/skills", scopes: ["User", "Project"], capabilities: ["发现", "安装", "更新", "删除", "验证"], discoveredSkills: 18 },
  { id: "agent-codex", name: "Codex", type: "CLI / Desktop", status: "limited", version: "已检测", path: "由 Adapter 确认", scopes: ["User"], capabilities: ["发现", "导出"], discoveredSkills: 7 },
  { id: "agent-chatgpt", name: "ChatGPT", type: "Remote Surface", status: "limited", version: "Cloud", path: "无本地写入路径", scopes: ["Personal"], capabilities: ["标准导出"], discoveredSkills: 0 },
  { id: "agent-gemini", name: "Gemini CLI", type: "CLI", status: "setup", version: "未配置", path: "—", scopes: [], capabilities: ["待检测"], discoveredSkills: 0 },
];

export const mockSyncItems: SyncItem[] = [
  { id: "sync-human", skillName: "human-read-tech-html", action: "add", current: "—", target: "v1.8.2", reason: "Bundle 新增 required Skill" },
  { id: "sync-archify", skillName: "archify", action: "update", current: "v0.9.2", target: "v0.9.4", reason: "Library 版本更新" },
  { id: "sync-code-review", skillName: "code-review", action: "unchanged", current: "same hash", target: "same hash", reason: "目标内容一致" },
  { id: "sync-java-testing", skillName: "java-testing", action: "conflict", current: "target modified", target: "v1.2.0", reason: "检测到 Target Drift" },
];

export const mockSources: SourceConfig[] = [
  { id: "source-github", name: "GitHub Repository", description: "跟踪仓库、分支与相对路径。", detail: "3 repositories", enabled: true },
  { id: "source-local", name: "本地目录", description: "扫描你主动配置的 Skills 根目录。", detail: "4 roots", enabled: true },
  { id: "source-agent", name: "Agent 导入", description: "从已发现 Agent 中纳入现有 Skills。", detail: "2 adapters", enabled: true },
];
