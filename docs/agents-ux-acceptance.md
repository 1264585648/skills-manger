# Agents 交互改造验收

状态：Windows 本地验收通过。以下证据对应 `agents-ux-redesign.md`，包括自动化、真实 Tauri 回放及构建检查。

## 交付范围

- P0：顶部 Agent 切换、全局/项目范围、单一技能列表、筛选和会话上下文、按需抽屉。
- P1：默认位置解析、可信技能库关联、自动预览、覆盖/共享影响确认、就近导入、单项及批量更新。
- P2：局部问题处理、目录重定位、撤销与记录恢复、过期计划重试、跨页面上下文。

## 需求与证据

| 需求 | 实现 | 验证证据 |
| --- | --- | --- |
| 首屏减负与主操作明确 | AgentSelector、ScopeSelector、SkillList；移除常驻二级列表、统计和详情标签页 | 主流程回放检查旧元素不存在；原生主页面截图 |
| 初始选择、上次 Agent 不可用 | useAgentWorkspace、initialAgent | 前端状态测试；异常回放的不可用 Agent 与重新加载 |
| 范围隔离、项目消失不改写其他范围 | ManagementView.scopeAvailable、scope_options | Rust 全局/项目隔离与失效项目测试；异常回放 |
| 唯一默认位置和只确认一次 | 产品首选目录、已确认目标、TargetOption | Rust 目标歧义/偏好持久化测试；异常回放 |
| 同名不同来源不误关联 | 部署位置、明确绑定及原来源匹配，未使用名称自动绑定 | Rust 同名不同来源测试；SkillList 来源标识 |
| 共享位置归并与只读限制 | 规范化路径归并、RootInfo、assert_writable_root | 路径归并前端测试、Rust 只读保护测试、原生共享确认与只读详情 |
| 自动摘要、最新选择生效 | AddSkillsDrawer 300ms 防抖和请求身份；PlanReview | 主流程快速勾选回放；LatestRequest 单元测试 |
| 覆盖、共享影响在执行前确认 | 清单展开及确认勾选；固定操作区提供查看入口 | 主流程更新/共享确认、窄窗口抽屉截图 |
| 外部/本地导入保留原件 | prepare_agent_import、import_agent_skill、暂存副本规范化 | Rust 原件、身份及过期源测试；两条原生导入流程 |
| 同一技能多个副本批量更新 | 计划按目标位置区分；部署按目录和位置唯一；操作明细按位置记录 | Rust 多副本更新、再次更新、整批恢复、第二项失败回滚；原生批量更新 |
| 旧数据与备份兼容 | deployment_location_version 迁移，保留历史主键、路径及归属 | Rust 旧记录迁移、外键完整性与恢复测试 |
| 执行中关闭与重复确认 | 按钮忙碌状态、原生 dialog 取消拦截、客户端防重复与后端计划领取 | 异常回放双击/关闭；Rust 重复计划拒绝 |
| 过期计划保留选择并重新确认 | 服务器二次校验、重试重新预览、清空旧确认 | 原生过期计划重试；Rust 源和目标变化测试 |
| 文件操作与刷新分别反馈 | onDone 单独反馈文件结果和刷新失败，重试触发刷新 | 异常回放故障注入，检查实际目标文件和调用次数 |
| 单个断链不阻断其他技能 | 问题详情、定位入口、修复后重扫 | 真实 Junction 回放；Rust 断链/循环/有效链接测试 |
| 可撤销且不覆盖后续修改 | OperationHistoryDrawer、restore_operation | 原生单项/批量撤销；Rust 后续修改保护 |
| 低频操作与目录设置可达 | 更多菜单、DirectoryManagerDrawer、OperationHistoryDrawer | 原生目录开关、历史入口、取消扫描及偏好重新加载 |
| 跨页面不重新选择 | Skills/工作流携带选择；高级更新携带 Agent/范围/位置并可返回 | 主流程跨页回放；异常回放高级更新 |
| 筛选、滚动、焦点、排序 | 会话状态按 Agent/范围隔离；SQLite 保存偏好；原生 dialog | 前端会话测试，原生切换/滚动/键盘回放 |
| 文字、缩放和视觉资源 | 固定按钮尺寸、单表格、滚动抽屉、本地产品图标 | 5 组主页面视口、2 组抽屉视口；图片加载及溢出断言 |

## 真实桌面回放

主流程：`scripts/qa-agents-ux.mjs`，结构化结果为 `output/agents-ux/report.json`。

异常流程：`scripts/qa-agents-ux-faults.mjs`，结构化结果为 `output/agents-ux/fault-report.json`。

两者通过 CDP 操作真实 Tauri WebView，业务读取、安装、备份和恢复由 Rust 实现执行。测试数据保存在独立 QA 数据库，业务文件变更落在 `output/agents-ux/fixtures`。项目失效用例另建系统临时项目并重命名，验证后清理，不更改用户项目。

原生文件选择器的返回路径作为测试输入注入；未宣称操作系统文件选择窗口本身已经自动化验收。延迟、刷新失败场景在客户端服务边界注入故障，其余业务命令调用真实后端。

## 构建与回归

```powershell
npm run build
npm run test:frontend
$testFiles = Get-ChildItem -LiteralPath tests -Filter '*.test.ts' | Select-Object -ExpandProperty FullName
node --test $testFiles
cargo +stable-x86_64-pc-windows-msvc fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo +stable-x86_64-pc-windows-msvc clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo +stable-x86_64-pc-windows-msvc test --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:build -- --debug --no-bundle
```

最终结果：

- `npm run build`：通过，含 TypeScript 类型检查和生产前端构建。
- `npm run test:frontend`：16 项通过；执行仓库全部前端测试文件时共 21 项通过，包含现有功能回归。
- Rust：55 项通过、0 失败；1 项真实目录盘点测试按设计默认忽略。
- Rust 格式检查、Clippy `-D warnings`：通过。
- 主流程原生回放：12 组通过，控制台错误 0。
- 异常与恢复原生回放：10 组通过，控制台错误 0。
- 视口：5 组主页面、2 组抽屉尺寸/DPI 等效视口通过；无页面横向溢出或按钮文字溢出，15 款本地图标正常加载。
- 所有修改文本文件：UTF-8 严格解码与替换字符检查通过；中文截图正常。
- `npm run desktop:build -- --debug --no-bundle`：通过，生成内置前端资源的桌面程序。

原生回放已经读取本机实际目录；普通单元测试保持与开发者真实数据隔离。完整结构化结果和截图保存在 `output/agents-ux/`，其中 `final-main.png` 为主页面，`add-auto-preview.png` 为添加流程，`history-drawer.png` 为操作记录。

## 体验核对口径

本次使用本地任务走查检查“添加、更新、处理问题、恢复”以及首屏三要素。普通添加的页面流程为打开、选择、确认；危险变更保留审阅。未开展多用户研究，因此不将“10 秒识别”写成经过用户样本验证的统计结果。

## 运行与兼容

- 默认保留原有 Library、用户文件、目录登记、部署记录和备份；新偏好在本地数据库保存。
- 扫描仍不执行技能脚本，默认保留原目录配置；用户显式选择位置或确认操作后才修改登记或目标文件。
- 更新记录现在允许同一技能在一个范围拥有多个独立位置；旧记录可迁移并保留恢复能力。
- QA 的 CDP 配置位于 `output`，不写入正常应用配置。正常构建内置前端资源，浏览器开发地址仅用于 UI 预览。
