import type {
  AgentTargetRecord,
  DiscoveryRootRecord,
  GroupRecord,
  LinkRecord,
  ScanSnapshot,
  SkillInstanceRecord,
  SkillNoteRecord,
  TagRecord,
} from "../types/discovery";
import type { AgentCatalogEntry, AssignmentRecord } from "./workspaceService";

export const MOCK_CATALOG: AgentCatalogEntry[] = [
  { id: "claude-code", name: "Claude Code", provider: "Anthropic", projectRoots: [".claude/skills"] },
  { id: "cursor", name: "Cursor", provider: "Anysphere", projectRoots: [".cursor/skills", ".agents/skills"] },
  { id: "github-copilot", name: "GitHub Copilot", provider: "GitHub", projectRoots: [".github/copilot/skills"] },
  { id: "windsurf", name: "Windsurf", provider: "Codeium", projectRoots: [".codeium/skills"] },
  { id: "codex", name: "Codex", provider: "OpenAI", projectRoots: [".agents/skills"] },
  { id: "gemini-cli", name: "Gemini CLI", provider: "Google", projectRoots: [".gemini/skills"] },
  { id: "trae", name: "TRAE", provider: "ByteDance", projectRoots: [".trae/skills"] },
  { id: "cline", name: "Cline", provider: "Roo / Cline", projectRoots: [".cline/skills"] },
];

export const MOCK_TARGETS: AgentTargetRecord[] = [
  { id: "claude-code", name: "Claude Code", provider: "Anthropic", detected: true, installed: true, executablePath: "C:\\bin\\claude.exe", lastWarning: null, lastScannedAt: Date.now() },
  { id: "cursor", name: "Cursor", provider: "Anysphere", detected: true, installed: true, executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\cursor\\cursor.exe", lastWarning: null, lastScannedAt: Date.now() },
  { id: "github-copilot", name: "GitHub Copilot", provider: "GitHub", detected: true, installed: true, executablePath: "C:\\Program Files\\Copilot\\copilot.exe", lastWarning: null, lastScannedAt: Date.now() },
  { id: "windsurf", name: "Windsurf", provider: "Codeium", detected: true, installed: true, executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Windsurf\\windsurf.exe", lastWarning: null, lastScannedAt: Date.now() },
  { id: "codex", name: "Codex", provider: "OpenAI", detected: true, installed: false, executablePath: null, lastWarning: null, lastScannedAt: Date.now() },
  { id: "gemini-cli", name: "Gemini CLI", provider: "Google", detected: true, installed: true, executablePath: "C:\\bin\\gemini.exe", lastWarning: null, lastScannedAt: Date.now() },
  { id: "trae", name: "TRAE", provider: "ByteDance", detected: false, installed: false, executablePath: null, lastWarning: null, lastScannedAt: null },
  { id: "cline", name: "Cline", provider: "Roo / Cline", detected: false, installed: false, executablePath: null, lastWarning: null, lastScannedAt: null },
];

export const MOCK_ROOTS: DiscoveryRootRecord[] = [
  { id: "root-claude-user", agentId: "claude-code", scope: "user", configuredPath: "C:\\Users\\zhuxuan\\.claude\\skills", canonicalPath: "C:\\Users\\zhuxuan\\.claude\\skills", enabled: true, isDefault: true, lastWarning: null },
  { id: "root-cursor-user", agentId: "cursor", scope: "user", configuredPath: "C:\\Users\\zhuxuan\\.cursor\\skills", canonicalPath: "C:\\Users\\zhuxuan\\.cursor\\skills", enabled: true, isDefault: true, lastWarning: null },
  { id: "root-copilot-user", agentId: "github-copilot", scope: "user", configuredPath: "C:\\Users\\zhuxuan\\.copilot\\skills", canonicalPath: "C:\\Users\\zhuxuan\\.copilot\\skills", enabled: true, isDefault: true, lastWarning: null },
  { id: "root-windsurf-user", agentId: "windsurf", scope: "user", configuredPath: "C:\\Users\\zhuxuan\\.codeium\\skills", canonicalPath: "C:\\Users\\zhuxuan\\.codeium\\skills", enabled: true, isDefault: true, lastWarning: null },
  { id: "root-project-1", agentId: "claude-code", scope: "project", configuredPath: "D:\\vibe-projects\\app\\.claude\\skills", canonicalPath: "D:\\vibe-projects\\app\\.claude\\skills", enabled: true, isDefault: false, lastWarning: null },
];

export const MOCK_GROUPS: GroupRecord[] = [
  { id: "grp-eng", name: "工程研发", skillCount: 6 },
  { id: "grp-arch", name: "架构与设计", skillCount: 3 },
  { id: "grp-qa", name: "测试与质量", skillCount: 2 },
  { id: "grp-ops", name: "DevOps 与自动化", skillCount: 2 },
];

export const MOCK_TAGS: TagRecord[] = [
  { id: "tag-code", name: "代码审查", isSystem: true, skillCount: 4 },
  { id: "tag-docs", name: "文档规范", isSystem: true, skillCount: 3 },
  { id: "tag-git", name: "Git工作流", isSystem: false, skillCount: 2 },
  { id: "tag-test", name: "自动化测试", isSystem: false, skillCount: 2 },
  { id: "tag-sec", name: "安全合规", isSystem: false, skillCount: 2 },
  { id: "tag-db", name: "数据库迁移", isSystem: false, skillCount: 1 },
];

export const MOCK_INSTANCES: SkillInstanceRecord[] = [
  { id: "inst-1", agentId: "claude-code", rootId: "root-claude-user", scope: "user", path: "C:\\Users\\zhuxuan\\.claude\\skills\\technical-writing", name: "Technical Writing", description: "Generate clear, accurate technical documentation, READMEs, and API guides from product context.", contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", scriptCount: 0, state: "unmanaged", firstDiscoveredAt: Date.now() - 86400000, lastDiscoveredAt: Date.now() },
  { id: "inst-2", agentId: "cursor", rootId: "root-cursor-user", scope: "user", path: "C:\\Users\\zhuxuan\\.cursor\\skills\\code-review", name: "Code Review", description: "Analyze pull requests, suggest architectural improvements, and catch potential bugs across TypeScript and Rust.", contentHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", scriptCount: 0, state: "unmanaged", firstDiscoveredAt: Date.now() - 172800000, lastDiscoveredAt: Date.now() },
  { id: "inst-3", agentId: "claude-code", rootId: "root-claude-user", scope: "user", path: "C:\\Users\\zhuxuan\\.claude\\skills\\git-workflow", name: "Git Workflow", description: "Enforce Conventional Commits, auto-generate changelogs, manage release branches and resolve rebase conflicts.", contentHash: "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce", scriptCount: 1, state: "unmanaged", firstDiscoveredAt: Date.now() - 259200000, lastDiscoveredAt: Date.now() },
  { id: "inst-4", agentId: "cursor", rootId: "root-cursor-user", scope: "user", path: "C:\\Users\\zhuxuan\\.cursor\\skills\\api-designer", name: "API Designer", description: "Design type-safe OpenAPI, REST and GraphQL endpoints with automatic input validation and serialization tests.", contentHash: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a", scriptCount: 0, state: "unmanaged", firstDiscoveredAt: Date.now() - 345600000, lastDiscoveredAt: Date.now() },
  { id: "inst-5", agentId: "claude-code", rootId: "root-project-1", scope: "project", path: "D:\\vibe-projects\\app\\.claude\\skills\\test-automator", name: "Test Automator", description: "Generate comprehensive Vitest and Playwright test suites covering boundary cases and error boundaries.", contentHash: "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d", scriptCount: 0, state: "unmanaged", firstDiscoveredAt: Date.now() - 432000000, lastDiscoveredAt: Date.now() },
  { id: "inst-6", agentId: "windsurf", rootId: "root-windsurf-user", scope: "user", path: "C:\\Users\\zhuxuan\\.codeium\\skills\\security-auditor", name: "Security Auditor", description: "Scan dependencies and codebase for secret leaks, injection vulnerabilities, and compliance baselines.", contentHash: "e7f6c011776e8db7cd330b54174fd76f7d0216b612387a5ffcfb81e6f0919683", scriptCount: 0, state: "unmanaged", firstDiscoveredAt: Date.now() - 518400000, lastDiscoveredAt: Date.now() },
  { id: "inst-7", agentId: "github-copilot", rootId: "root-copilot-user", scope: "user", path: "C:\\Users\\zhuxuan\\.copilot\\skills\\db-migration", name: "DB Migration Helper", description: "Write zero-downtime database schema migrations for SQLite and PostgreSQL with automated rollback scripts.", contentHash: "7902699be42c8a8e46fbbb4501726517e86b22c56a189f7625a6da49081b2451", scriptCount: 0, state: "unmanaged", firstDiscoveredAt: Date.now() - 604800000, lastDiscoveredAt: Date.now() },
  { id: "inst-8", agentId: "cursor", rootId: "root-cursor-user", scope: "user", path: "C:\\Users\\zhuxuan\\.cursor\\skills\\refactor-expert", name: "Refactor Expert", description: "Identify code smells, apply clean architecture patterns, and safely decouple tightly coupled modules.", contentHash: "2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef9f8b244ee13", scriptCount: 0, state: "unmanaged", firstDiscoveredAt: Date.now() - 691200000, lastDiscoveredAt: Date.now() },
];

export const MOCK_LINKS: LinkRecord[] = [
  { id: "link-1", skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\technical-writing", skillName: "Technical Writing", targetRootId: "root-cursor-user", targetAgentId: "cursor", targetRootPath: "C:\\Users\\zhuxuan\\.cursor\\skills", linkPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\technical-writing", createdAt: Date.now() - 3600000 },
  { id: "link-2", skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\technical-writing", skillName: "Technical Writing", targetRootId: "root-copilot-user", targetAgentId: "github-copilot", targetRootPath: "C:\\Users\\zhuxuan\\.copilot\\skills", linkPath: "C:\\Users\\zhuxuan\\.copilot\\skills\\technical-writing", createdAt: Date.now() - 3600000 },
  { id: "link-3", skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\code-review", skillName: "Code Review", targetRootId: "root-claude-user", targetAgentId: "claude-code", targetRootPath: "C:\\Users\\zhuxuan\\.claude\\skills", linkPath: "C:\\Users\\zhuxuan\\.claude\\skills\\code-review", createdAt: Date.now() - 7200000 },
  { id: "link-4", skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\code-review", skillName: "Code Review", targetRootId: "root-windsurf-user", targetAgentId: "windsurf", targetRootPath: "C:\\Users\\zhuxuan\\.codeium\\skills", linkPath: "C:\\Users\\zhuxuan\\.codeium\\skills\\code-review", createdAt: Date.now() - 7200000 },
  { id: "link-5", skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\git-workflow", skillName: "Git Workflow", targetRootId: "root-cursor-user", targetAgentId: "cursor", targetRootPath: "C:\\Users\\zhuxuan\\.cursor\\skills", linkPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\git-workflow", createdAt: Date.now() - 10800000 },
];

export const MOCK_NOTES: SkillNoteRecord[] = [
  { skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\technical-writing", note: "高质量技术文档与 README 自动生成", updatedAt: Date.now() },
  { skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\code-review", note: "多语言 PR 架构与潜在 Bug 深度审查", updatedAt: Date.now() },
  { skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\git-workflow", note: "规范化 Commit 提交与版本发布流程", updatedAt: Date.now() },
  { skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\api-designer", note: "OpenAPI 与类型安全接口定义工具", updatedAt: Date.now() },
  { skillPath: "D:\\vibe-projects\\app\\.claude\\skills\\test-automator", note: "Vitest 单元测试与端到端用例编写", updatedAt: Date.now() },
  { skillPath: "C:\\Users\\zhuxuan\\.codeium\\skills\\security-auditor", note: "密钥泄漏与依赖漏洞静态安全审查", updatedAt: Date.now() },
];

export const MOCK_GROUP_ASSIGNMENTS: AssignmentRecord[] = [
  { skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\technical-writing", targetId: "grp-arch" },
  { skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\code-review", targetId: "grp-eng" },
  { skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\git-workflow", targetId: "grp-ops" },
  { skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\api-designer", targetId: "grp-arch" },
  { skillPath: "D:\\vibe-projects\\app\\.claude\\skills\\test-automator", targetId: "grp-qa" },
  { skillPath: "C:\\Users\\zhuxuan\\.codeium\\skills\\security-auditor", targetId: "grp-ops" },
  { skillPath: "C:\\Users\\zhuxuan\\.copilot\\skills\\db-migration", targetId: "grp-eng" },
  { skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\refactor-expert", targetId: "grp-eng" },
];

export const MOCK_TAG_ASSIGNMENTS: AssignmentRecord[] = [
  { skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\technical-writing", targetId: "tag-docs" },
  { skillPath: "C:\\Users\\zhuxuan\\.cursor\\skills\\code-review", targetId: "tag-code" },
  { skillPath: "C:\\Users\\zhuxuan\\.claude\\skills\\git-workflow", targetId: "tag-git" },
  { skillPath: "D:\\vibe-projects\\app\\.claude\\skills\\test-automator", targetId: "tag-test" },
  { skillPath: "C:\\Users\\zhuxuan\\.codeium\\skills\\security-auditor", targetId: "tag-sec" },
  { skillPath: "C:\\Users\\zhuxuan\\.copilot\\skills\\db-migration", targetId: "tag-db" },
];

export const MOCK_SNAPSHOT: ScanSnapshot = {
  targets: MOCK_TARGETS,
  roots: MOCK_ROOTS,
  instances: MOCK_INSTANCES,
  warnings: [],
};
