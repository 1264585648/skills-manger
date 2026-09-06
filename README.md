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
- `workspaceService` 作为页面数据访问边界，M1 使用 mock，M2 可替换为 Tauri/Rust 实现；
- M0 Diagnostics 已迁入 `Settings`，页面不直接访问 SQLite；
- 1024px 附近自动收敛 Inspector，宽屏保持三栏工作台布局。

M1 CI 已通过 TypeScript strict typecheck、Vite production build、Rust regression tests、Windows Tauri installer build 与 artifact upload。

## 本地开发

前置条件：

- Node.js 24（CI 使用版本）；
- Rust stable；
- Tauri 2 对应平台依赖，Windows 需要 WebView2 / Build Tools 等。

```bash
npm install

# 浏览器预览 UI；Settings 中的 Tauri Diagnostics 在浏览器不可用
npm run dev

# 正式桌面调试
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
├── data/             # M1 mock data
├── layout/           # App Shell
├── pages/            # 五个一级页面
├── services/         # 页面数据访问 / Tauri Diagnostics 边界
├── types/            # 前端领域类型
├── App.tsx
└── styles.css
```

原则：页面只依赖 service，不直接操作 SQLite 或任意文件系统。M2 接真实数据时优先替换 service / Rust command，而不是重写页面。

## CI

`.github/workflows/m0-checks.yml` 目前同时作为 M0/M1 基础回归：

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

进入 **M2 — Skill Discovery + Canonical Library**：实现标准 `SKILL.md` 解析、受控目录导入、Skill identity/content hash、Library 数据模型与 SQLite 持久化，并让 `Skills` 页面从 mock service 切换到真实本地数据。
