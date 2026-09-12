# Agents 管理中心

交互改版已完成：顶部切换 Agent 与作用范围，主区域保留技能列表；目录、详情与历史按需打开抽屉。添加流程使用默认位置和自动变更摘要，覆盖及共享影响由用户确认。详见 [改造方案](agents-ux-redesign.md) 与 [验收报告](agents-ux-acceptance.md)。

Agents 页提供本机 Agent 发现、Skills 索引、目录管理、安装同步和恢复。扫描只读取文件与安装信息，不启动 Agent，不执行 Skill 脚本。

## 产品与目录

产品规则统一位于 `src-tauri/src/agent_catalog.rs`，包含 15 款产品、官方文档地址、用户及项目目录。运行时同时读取 Windows 安装信息、PATH 和 IDE 扩展元数据；仅存在配置目录时显示“发现配置”。共享目录不能证明对应产品已安装。

支持 Codex、Claude、Kimi、OpenCode 和 OpenClaw 的目录环境变量；Kimi 额外目录使用 TOML 解析，OpenClaw 的状态目录与工作区使用 JSON5 配置解析。插件缓存、系统技能只读。TRAE 国内、国际及 CLI 目录分别匹配。

启动自动刷新索引，扫描任务可取消。项目区默认深度 6，可设为 1–12，跳过依赖和构建目录；单项目区最多 20,000 个目录或 20 秒，单 Skills 根目录最多 10,000 个目录或 8 秒。达到上限保留历史结果并提示未完成。元数据文件上限 1 MB；完整内容哈希仅在导入、规划和部署时计算。

Junction 和符号链接保留入口与真实路径；同一物理根目录在一次任务中只扫描一次。断链、循环、无效 YAML 独立报告。Claude 缺省 `name` 使用目录名。发现不等于目标 Agent 已启用或实际调用了该 Skill。

## 安装与恢复

从技能库或现有技能组合选择 Skills，再选择用户/项目目录；预览后执行。所选同名目标以技能库覆盖，不修改未选中的技能。多个目标指向同一物理目录时只写入一次，并显示关联 Agent。

预览记录源哈希、目标指纹和真实根路径。执行前重新校验，过期计划拒绝写入。目标原内容保存在同盘 `.skills-manager-backup-*` 目录中，操作记录维护备份与原部署归属。覆盖链接时移动链接入口，不改写链接指向的共享内容。

每个目标目录内任一项失败会回滚。成功记录可恢复安装前状态；若安装后目标或备份被修改，恢复停止。早期缺少恢复元数据的记录不提供恢复按钮。

SQLite 保留原有 Library、目录、部署与操作记录；`agent_center_version` 管理发现索引升级，`selection_plan_version` 管理无 Bundle 的直接安装计划。发现索引可以重建。

`deployment_location_version` 将部署和操作明细按实际位置区分，支持一个技能在同一范围的多个副本更新与整批恢复。迁移保留原记录及备份；备份缺失时不提供恢复按钮。

## 开发与验证

Windows 需要 Node.js、MSVC Rust 工具链和 WebView2。`npm run desktop:dev` 与 `desktop:build` 默认使用本机 MSVC 工具链；显式设置的 `RUSTUP_TOOLCHAIN` 优先。

```powershell
npm run desktop:dev
npm run build
npm run test:frontend
cargo +stable-x86_64-pc-windows-msvc fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo +stable-x86_64-pc-windows-msvc clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo +stable-x86_64-pc-windows-msvc test --manifest-path src-tauri/Cargo.toml --lib
```

`inventory_current_user` 是默认忽略的真实目录只读检查，可通过 `AGENT_CENTER_QA_DIR` 指定结果目录后显式执行。普通测试使用临时目录，包括有效/失效/循环 Junction、共享归属、取消、深度限制、覆盖与恢复。

`scripts/qa-agent-center.mjs <playwright-package-path> <CDP-address>` 对真实 Tauri WebView 执行界面回放。调试构建可用 `SKILLS_CENTER_QA_DATA_DIR` 隔离数据库；该变量在发布构建中无效。QA 输出位于 `output/playwright/`，覆盖 1024×680、1280×800、1920×1080，以及 125%/150% DPI 等效视口，另验证真实安装和恢复。CDP 仅通过临时 QA 配置开启，不包含在正式应用配置中。

浏览器开发服务器仅预览 UI；目录发现和文件写入需要 Tauri 桌面端。
