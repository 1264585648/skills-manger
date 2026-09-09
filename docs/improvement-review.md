# Skills Control Center — 功能 / 体验 / UI 改进评审

评审范围：`src/`（前端 1952 行）、`src-tauri/src/commands.rs`（22 个 command）、`docs/ui/index.html`（高保真原型）、`docs/e2e-test-report.md`。
结论先说：**后端能力（M0–M6）明显跑在前端前面**，前端存在一批"看得见但点不动 / 数据恒为空 / 从未接线的死功能"，以及一条"Sync 遇到冲突后无处置路径"的死胡同。

---

## 落地进度

| 批次 | 内容 | commit |
|---|---|---|
| 第一批 | Settings 分区真实切换、Sources 去 mock、首页真实概览、Bundle→Sync 带参导航 | `5a06ff9` |
| 第二批 | Sync 冲突处置面板（F1）、当前 Root 部署视图（F7） | `dc1e0a7` |

已关闭：**F1 冲突无处置路径**、**F7 部署视图从未接线**、**F4/F5 中的 Settings 假分区与 Sources mock**、**首页硬编码**。
仍开放：F13 Diff 预览、Adopt 接管、回滚入口（后端 `safe_apply::restore_operation` 已实现但未注册 command）、Settings 开关持久化、Library Skill 删除、多选 root 批量同步。

---

## 一、功能缺口（按严重度）

### P0 — 断头路 & 假交互

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| ~~F1~~ ✅ | **Sync 冲突无处置路径** | 已于 `dc1e0a7` 修复：`src/components/ConflictResolver.tsx` 复用现成 `.conflict-card` 样式，按 reason 分四类并给出「从 Bundle 排除 / 打开目录 / 复制路径」三个处置 | 已关闭 |
| F2 | **Settings 左侧 4 个分区切换是假交互**。`activeSection` 只改了 eyebrow 标题，四个区块（Sources / Git Source / 发现目录 / 更新策略）永远一起渲染 | `SettingsPage.tsx:14,80,82` | 分区导航看起来能用，实际是装饰 |
| F3 | **Settings 两个开关不持久化、无副作用**。`scanOnStart` / `autoCheck` 只有 `useState`，既没落到 SQLite 也没影响启动流程 | `SettingsPage.tsx:15-16,98` | 用户以为设置了，重启即失效 |
| F4 | **Settings 的 Sources 列表是 mock**，`getSources()` 直接返回 `mockSources`，"3 repositories / 4 roots" 是写死的数字 | `workspaceService.ts:359` | 桌面上显示假数据，严重损害可信度 |
| F5 | **首页完全硬编码**，`demoEnvironment` 写死 "12 Skills / 2026-09-06"，标题还是 `<h1>我的 AI 环境</h1>` 里套 `<h2>` | `HomePage.tsx:3-27` | 作为默认落地页毫无价值；真实环境概览散落在其它页 |
| F6 | **Skills 分组侧栏永远只有"全部"**。`groups` 字段在 `mapLibrarySkill` 与 `mapSkillInstance` 里恒为 `[]`，后端也没有 group 表 | `workspaceService.ts:73`、`discoveryMappers.ts:47` | 一整个左侧栏 + V1 原则第 4 条（"Group 只分类"）是空的 |
| ~~F7~~ ✅ | **`list_deployments` 已实现但 UI 从未调用** | 已于 `dc1e0a7` 修复：Sync 页 inspector 新增"当前 Root 已部署"，按所选 Root 过滤并按更新时间排序 | 已关闭 |
| F8 | **Bundles 页 "前往 Sync 预览" 永久 disabled**，Inspector 里"目标"硬编码 `Claude Code` | `BundlesPage.tsx:105` | 唯一能把 Bundle → Sync 串起来的入口是断的 |

### P1 — 能力缺口

| # | 改进点 | 说明 |
|---|---|---|
| F9 | **Adopt（把 Unmanaged 纳入 Library）缺失** | M3 明确"Discovery ≠ Adopt"，但 UI 里 Unmanaged 只有一个只读说明，没有"接管"按钮，发现链路无法收口 |
| F10 | **Library Skill 无法删除 / 归档** | 只能加不能减，`skills` 表迟早堆积 |
| F11 | **一次只能同步 1 个 Bundle × 1 个 Root** | 真实场景是"这套 Bundle 推到 Claude + Codex 两个 root"，现在是 N 次手工操作且每次都要重新生成计划 |
| F12 | **无 Skill 内容预览** | 看不到 SKILL.md 正文、文件树、历史 hash 变化；选 Skill 只能看元数据 |
| F13 | **无 Diff** | `update` / `conflict` 时用户无法知道改了什么，只能盲信 hash |
| F14 | **操作历史过弱** | 只显示最近 3 条 + `id.slice(0,10)` + 状态；无详情展开、无耗时、无失败原因、无日志导出 |
| F15 | **回滚不可达** | 后端有 snapshot / rollback（`safe_apply.rs`），UI 完全没有"回滚这次操作"的入口 |
| F16 | **无 Git Source 解绑 / 重新 clone** | 只能登记，不能管理 |

---

## 二、使用体验

| # | 问题 | 证据 / 建议 |
|---|---|---|
| X1 | **无路由、刷新即回首页** | `App.tsx:12` 只有 `useState`；建议引入 `react-router` 的 hash 路由，至少支持深链与刷新保持 |
| X2 | **无全局搜索 / 命令面板** | 6 个页面只能靠逐页点；建议 `Ctrl+K` 快速跳 Skill / Bundle / Agent |
| X3 | **一切靠手动刷新** | Skills 有"刷新/重新读取"两个按钮做同一件事（`:201,264`）；导入后其它页缓存不失效；建议统一缓存失效机制（或上 TanStack Query） |
| X4 | **长任务无进度** | Apply 是全量复制 + hash 校验，前端只有按钮文案变"正在安全应用…"，无分步进度、无取消 |
| X5 | **错误只有单行红条** | 6 个页面各写一遍 `try/catch → setError`；无重试按钮、无"复制错误详情"、无日志定位（日志已在 App Data 里，但用户找不到） |
| X6 | **空状态无行动按钮** | `EmptyState` 只有 title + body，Skills 空态文案说"导入"却没有导入按钮 |
| X7 | **确认全部走原生对话框** | `confirm()` 出现 4 处，重要写入（Apply）建议应用内二次确认 + 变更清单 |
| X8 | **无 Toast / 无撤销** | 成功提示是页面顶部一次性 notice，切页即消失 |
| X9 | **浏览器预览与桌面行为差异巨大** | mock 与真实数据双轨（`isTauriRuntime()` 分支 ×6 处），开发期极易误判；建议加明显的 "Preview Mode" 水印角标 |
| X10 | **批量导入缺失** | `previewSkillFromPicker` 一次只能选一个目录，导入 20 个 Skill 要点 20 次 |

---

## 三、UI / 视觉

| # | 问题 | 建议 |
|---|---|---|
| U1 | **字号普遍过小**：大量 9–10px（`status-pill` 9px、`detail-list dd` 10px、`path-card code` 8px） | 桌面端正文提到 12–13px，辅助信息不低于 11px；8px 的信息基本不可读 |
| U2 | **`styles.css` 是 17 行压缩文件**（第 2 行一条规则链几百个选择器） | 无法 review、无法 diff、无法定位；建议拆分 + Prettier 格式化，与 `m2.css` / `workflow.css` 合并为按模块组织 |
| U3 | **颜色硬编码散落**：`#f0f1f4` `#9aa1ae` `#fafbff` 与 token（`--line` `--muted`）混用 | 建立完整 token（border-subtle、surface-sunken 等），替换字面量 |
| U4 | **无深色模式 / 无主题切换** | `:root` 已用 CSS 变量，加 `[data-theme="dark"]` 成本很低 |
| U5 | **图标用 Unicode 字符拼**：`✦ S W A ↻ ⌂ ⚙ ⌕ ↗ ×` | 跨字体渲染不一致（Windows 上尤其明显）；建议换 lucide 等轻量 SVG 图标集 |
| U6 | **文案中英混杂**：侧栏「工作流」↔ 页头「Bundles」，状态「Clean/Update/Target Drift」↔「已检测/能力受限」 | 统一术语表，主导航与页头对齐 |
| U7 | **响应式断崖**：`≤1030px` 直接 `display:none` 掉 inspector，而 `minWidth` 是 1024 | 那一档窗口下 content hash / 路径 / 操作按钮全部不可达；建议折叠成抽屉或把关键字段并回表格 |
| U8 | **列表无排序、无分页/虚拟滚动** | Skill / 操作记录数量上来后会卡；表头至少给"状态/更新时间"排序 |
| U9 | **无障碍**：列表项是无 `aria-selected` 的 `<button>`；`ImportWizard` 有 `role="dialog"` 但没有 Esc 关闭、无焦点陷阱、无初始焦点 | 补 focus trap + Esc + `aria-selected`；`SettingsPage` 分区加 `role="tablist"` |
| U10 | **视觉层级偏平** | 三栏 workbench 用同一套 `panel-surface`，主从关系不清晰；主内容区可加强（更亮的底 / 更强的 shadow 分层） |

---

## 四、工程与架构

| # | 问题 | 建议 |
|---|---|---|
| E1 | **页面组件逻辑与渲染混写**（SkillsPage 279 行、BundlesPage 108 行全挤在一个 JSX 里） | 抽 `useSkills()` / `useBundles()` / `useSyncPlan()` hooks，页面只保留布局 |
| E2 | **数据获取零缓存、零复用**：每个页面 mount 都重拉全部 4 个 command；切页即丢 | 引入轻量 query 层或自建 store + 失效广播 |
| E3 | **错误/加载状态六份重复实现** | 统一 `useAsyncAction` hook（loading / error / retry） |
| E4 | **`id.startsWith("instance:")` 是字符串魔法**，用来区分 Library Skill 与 Agent 实例，出现在 4 处 | `Skill` 增加 `kind: "library" \| "instance"` 判别字段 |
| E5 | **`status` 与 `updateStatus` 语义重叠** | 合并为单一状态源，避免两处都可能显示状态 |
| E6 | **前端测试只有 7 项，且全是纯 mapper 单测**；无组件测试、无 E2E | 至少补 ImportWizard 冲突分支、SyncPage 冲突禁用分支的组件测试 |
| E7 | **无锁文件**（E2E 报告提到 `npm install` 每次生成未跟踪的 `package-lock.json`） | 提交 lock 文件，保证 CI 与本地一致 |
| E8 | **`typescript` 依赖写的是 7.0.2，`vite` 8.2.2** | 版本号非常规，确认是否为预期渠道，避免 CI 漂移 |

---

## 五、建议的落地顺序

**第一批（把假的和断的补上，成本最低、收益最大）**
1. F2 Settings 分区真实切换 + F3 开关持久化（新增一张 `settings` 表或 key-value）
2. F4/F5 去掉 mock：Sources 接真实登记数据，首页改成真实环境概览（Agent 数 / Library 数 / 待处理冲突数 / 最近操作）
3. F8 打通 Bundle → Sync 跳转（路由起来后顺带解决 X1）
4. U1/U3/U6 字号、token、术语统一

**第二批（补齐闭环）**
5. F1 冲突处置 UI（CSS 已经写好了，直接复用）+ F13 Diff + F7 部署视图
6. F9 Adopt、F10 删除/归档、F15 回滚入口
7. U2 样式文件拆分 + U4 深色模式 + U5 图标

**第三批（规模化）**
8. F11 多选 root 批量同步、F12 内容预览、F14 操作详情
9. E1–E3 hooks 化 + 缓存层，E4/E5 类型治理
10. X2 命令面板、U8 排序与虚拟滚动
