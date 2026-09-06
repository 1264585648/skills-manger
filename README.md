# skills-manger

桌面端 Skills 分组、组合、维护与多 Agent 分发工具。

当前产品定义为一个 **local-first Skills Control Center**：统一发现本机 Skill 与 Agent，在 Canonical Library 中管理 Skill、Group、Bundle、版本和关系，再通过 Agent Adapter 安全同步到不同目标环境。

## 当前进度

### M0 — Engineering Foundation

M0 已落地工程骨架：

- Tauri 2 + React + TypeScript + Vite；
- Rust command 层，前端通过 `invoke` 调用；
- SQLite（`rusqlite` + bundled SQLite）本地读写；
- App Data 目录中的 JSON Lines 本地日志；
- 基础内部错误模型 + 可序列化 command error；
- Windows 桌面构建与 installer CI；
- M0 启动页可直接验证 Tauri Bridge 和 SQLite 持久化写入。

M0 **不提前实现 M1 的正式五页面 UI**。高保真原型仍作为下一阶段视觉基线。

## 本地开发

前置条件：

- Node.js 24（CI 使用版本）；
- Rust stable；
- Tauri 2 对应平台依赖，Windows 需要 WebView2 / Build Tools 等。

```bash
npm install

# 浏览器仅预览前端壳；Tauri invoke 不会生效
npm run dev

# 正式桌面调试
npm run desktop:dev

# 类型检查 + 前端构建
npm run build

# 桌面安装包
npm run desktop:build
```

启动桌面应用后，M0 页面应显示：

1. `Rust Command = Connected`；
2. `SQLite = Ready`；
3. SQLite 数据文件与日志文件的本地路径；
4. 点击“写入 SQLite +1”后计数增加；
5. 关闭并重新打开应用后，计数仍保留。

## CI

`.github/workflows/m0-checks.yml`：

- Ubuntu：TypeScript typecheck + Vite build；
- Windows：Rust tests + Tauri debug installer build；
- Windows installer bundle 作为 Actions artifact 上传。

## 技术方案与 UI

- [人类阅读版技术方案](docs/technical-solution.html)
- [结构化方案源 `solution.json`](docs/solution.json)
- [高保真交互 UI 原型](docs/ui/index.html)

技术方案重点覆盖：

- 5 个一级页面：Skills、Groups & Bundles、Agents、Sync、Settings；
- Agent / Skill Discovery；
- Canonical Library 与 SkillInstance 分离；
- Group 与 Bundle 的职责边界；
- Agent Adapter + Capability Matrix；
- Sync Plan、Diff、Snapshot、Atomic Apply、Verify、Rollback；
- Upstream Update、Local Modified、Target Drift、Conflict、Unmanaged、Missing；
- Git Source、Watcher/Reconcile、安全与文件系统边界。

## V1 核心原则

1. **Discovery ≠ Adopt**：发现 Skill 不代表自动接管。
2. **Sync ≠ Overwrite**：所有写入先生成 Sync Plan。
3. **Agent Directory ≠ Source of Truth**：Canonical Library 是 desired state。
4. **Group 只分类，Bundle 才表达部署组合。**
5. **不同 Agent 通过 Capability 声明能力，不假设都是本地目录复制。**
6. **扫描与同步阶段绝不执行第三方 Skill 内 scripts。**

## 下一步

进入 **M1 — UI 基线**：把 `docs/ui/index.html` 中已经确认的 5 个页面视觉基线拆成真实 React 组件，并保持 M0 的 Rust / SQLite 边界不被 UI 直接绕过。
