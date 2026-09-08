# skills-manger

桌面端 Skills 分组、组合、维护与多 Agent 分发工具。

当前产品定义为一个 **local-first Skills Control Center**：统一发现本机 Skill 与 Agent，在 Canonical Library 中管理 Skill、Group、Bundle、版本和关系，再通过 Agent Adapter 安全同步到不同目标环境。

## 当前进度

### M0 — Engineering Foundation ✅

已完成：

- Tauri 2 + React + TypeScript + Vite；
- Rust command 层，前端通过 `invoke` 调用；
- SQLite（`rusqlite` + bundled SQLite）本地读写与持久化测试；
- App Data 目录 JSON Lines 本地日志；
- 基础错误模型；
- Windows desktop / installer CI。

### M1 — React UI Baseline ✅

已把确认过的高保真方向落成真实 React UI，而不是继续使用静态 HTML 原型：

- 统一 App Shell 与左侧一级导航；
- `Skills`、`Bundles`、`Agents`、`Sync`、`Settings` 五个真实页面；
- 简洁、高信息层级但不过载的桌面视觉基线；
- Design Tokens 与公共 `Button`、`StatusPill`、`SearchField`、`Toggle`、`EmptyState` 等组件；
- `Skill`、`Bundle`、`Agent`、`SyncItem`、`SourceConfig` 前端领域类型；
- `workspaceService` 作为页面数据访问边界；
- M0 Diagnostics 已迁入 `Settings`，页面不直接访问 SQLite；
- 1024px 附近自动收敛 Inspector，宽屏保持三栏工作台布局。

### M2 — Canonical Skill Library ✅

已把 Skills 页面从“纯 mock 展示”接到真实本地 Library，完成第一条真实数据闭环：

`选择 Skill 目录 → Rust 解析 SKILL.md → 校验 → 计算 identity/content hash → 复制到受管 Library → SQLite 持久化 → Skills 页面读取真实数据`

已完成：

- 使用 Tauri 原生目录选择器导入 Skill；
- 前端只获得目录选择权限，文件读取、Hash、复制和数据库写入全部由 Rust command 完成；
- 按 Agent Skills 规范解析 `SKILL.md` YAML frontmatter；
- 校验必填 `name` / `description`，并要求 `name` 与父目录一致；
- 读取 `license`、`compatibility`、`metadata`、`allowed-tools`；
- 使用 canonical source path 生成稳定 Source identity，再生成稳定 Skill identity；
- 对完整 Skill 目录生成确定性 SHA-256 content hash；
- `.git` 不进入 Library 和 content hash；
- 同一来源重复导入相同内容返回 `unchanged`，不会重复建档；
- 同一来源内容变化返回 `updated`，保持 Skill ID 不变；
- 同名但不同来源的 Skill 可以共存；
- App Data 下建立受管 `library/`，采用 staging + replace 写入；
- SQLite schema 升级为 v2，新增 `skill_sources` / `skills`；
- Skills 页面显示真实来源、版本、content hash、更新时间与 scripts 安全摘要；
- 扫描和导入过程绝不执行 `scripts/`；
- M2 暂不跟随 symlink，并对单个 Skill 设置 2000 文件 / 100 MB 安全上限；
- 浏览器 `npm run dev` 继续使用 mock 方便纯 UI 调试，Tauri 桌面运行时使用真实 Library。

M2 自动化测试覆盖：

- M0 SQLite 持久化回归；
- 重复导入幂等；
- Source 内容变化检测与更新；
- 同名不同来源并存；
- manifest `name` 与目录不一致时拒绝导入。

M2 CI 已通过 TypeScript strict typecheck、Vite production build、Rust tests、Windows Tauri installer build 与 artifact upload。

### M3 — Claude Code Agent Discovery

已实现只读发现链路：

- 启动时登记 Claude Code target 和默认 `~/.claude/skills` User root；
- 仅通过 PATH 元数据检测 Claude Code 可执行文件，不启动任何进程；
- 支持用户显式添加项目 `.claude/skills` root，重复添加保持幂等；
- SQLite schema v3 持久化 Agent target、发现 root 和 SkillInstance；
- 扫描 root 的直接子目录并复用 M2 `SKILL.md` 校验和 SHA-256 hash；
- 有效实例显示为 `Unmanaged`，成功重扫后消失的实例显示为 `Missing`；
- 单个无效 Skill 只产生 warning，不阻断同目录其他 Skill；root 不可读时保留上一次实例状态；
- 拒绝 root、Skill 目录、manifest 或内容树中的 symlink，不访问链接目标；
- Agents、Settings 和 Skills 页面已接入真实 Tauri command，浏览器预览继续使用 mock；
- 移除项目 root 只删除 SQLite 发现记录，不修改 Agent 目录；
- M3 不包含 Adopt、部署、同步或 watcher，不写入 Agent 文件。

本机前端测试与生产构建通过；本机缺少 Rust 工具链，因此 Rust 测试、桌面启动和真实 UI E2E 状态为 `BLOCKED`，不能据此宣称 M3 E2E PASS。

## 本地开发

前置条件：

- Node.js 24（CI 使用版本）；
- Rust stable；
- Tauri 2 对应平台依赖，Windows 需要 WebView2 / Build Tools 等。

```bash
npm install

# 浏览器预览 UI；真实 Library / Tauri Diagnostics 不可用
npm run dev

# 正式桌面调试，可导入真实 Skill
npm run desktop:dev

# 类型检查 + 前端构建
npm run build

# 桌面安装包
npm run desktop:build
```

## 代码结构

```text
src/
├── components/       # 公共 UI primitives
├── data/             # 浏览器预览 / 尚未接真实数据的 mock
├── layout/           # App Shell
├── pages/            # 五个一级页面
├── services/         # 页面数据访问 / Tauri command 边界
├── types/            # 前端领域类型
├── App.tsx
└── styles.css

src-tauri/src/
├── commands.rs       # Tauri commands
├── db.rs             # SQLite schema / repository
├── agent_discovery.rs # Claude Code roots / SkillInstance 扫描与协调
├── claude_code.rs     # 无进程启动的 PATH / 默认 root 检测
├── skills.rs         # SKILL.md 解析、校验、Hash、Library 导入
├── error.rs
├── logging.rs
└── lib.rs
```

原则：页面只依赖 service，不直接操作 SQLite 或任意文件系统。

## CI

`.github/workflows/m0-checks.yml` 当前作为桌面基础质量门禁：

- Ubuntu：TypeScript typecheck + Vite build；
- Windows：Frontend typecheck + Rust tests + Tauri debug installer build；
- Windows installer bundle 作为 Actions artifact 上传。

## 技术方案与 UI

- [人类阅读版技术方案](docs/technical-solution.html)
- [结构化方案源 `solution.json`](docs/solution.json)
- [高保真交互 UI 原型](docs/ui/index.html)

## V1 核心原则

1. **Discovery ≠ Adopt**：发现 Skill 不代表自动接管。
2. **Sync ≠ Overwrite**：所有写入先生成 Sync Plan。
3. **Agent Directory ≠ Source of Truth**：Canonical Library 是 desired state。
4. **Group 只分类，Bundle 才表达部署组合。**
5. **不同 Agent 通过 Capability 声明能力，不假设都是本地目录复制。**
6. **扫描与同步阶段绝不执行第三方 Skill 内 scripts。**

## 下一步

进入 **M4 — Bundle + Sync Planner**：为 Canonical Library 建立可持久化 Bundle / relation，并生成只读 Sync Plan。任何 Agent 写入仍需等待后续 Safe Apply 阶段，且必须先预览和确认。
