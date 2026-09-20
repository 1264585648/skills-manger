# skills-manger

Local-first 桌面工具：把散落在各 Agent / 项目里的 Skill **发现**出来，就地**治理**（分组、标签、中文简介），再以**软连接写回**到其他 Agent —— 全程不复制文件，Skill 源目录始终是唯一事实来源。

核心流程只有三步：

```
发现（Discovery） → 治理（Governance） → 写回（Write-back）
```

## 三步分别做什么

| 步骤 | 行为 | 关键约束 |
| --- | --- | --- |
| 发现 | 只读扫描 15 个 Agent（Claude Code / Codex / Cursor / Windsurf / Copilot / Gemini CLI / OpenCode / Cline / TRAE / CodeBuddy / Qoder / Qwen Code / Kimi Code 等）的用户目录与显式登记的项目目录 | 只读、绝不执行 scripts/、跳过本应用创建的软连接 |
| 治理 | 以 Skill 真实路径为键记录分组（单选）、标签（多选，含内置四标签）、中文简要描述 | 元数据独立入库，不改动 Skill 本体 |
| 写回 | 在目标 Agent 的 skills 目录创建指向真实目录的软连接（Windows 用目录联接 junction，无需管理员权限） | 不覆盖已存在的真实目录；只移除本应用创建的连接 |

## 安全边界

- 扫描阶段不复制、不执行、不写入任何 Skill 内容；
- `SKILL.md` 必须是普通文件（拒绝 symlink），`name` 必须与父目录一致；
- 单个 Skill 限制 2000 文件 / 100 MB，内容树内禁止 symlink；
- 写回目标位置存在真实目录时直接拒绝，不做覆盖；
- 消费方看到的内容改变时，哈希可被发现（SHA-256 content hash）。

## 本地开发

前置条件：Node.js 24、Rust stable、Windows 需 WebView2 Runtime。

```bash
npm install

npm run dev          # 浏览器 UI 预览（Tauri command 不可用）
npm run desktop:dev  # 正式桌面调试（MSVC 工具链）
npm run build        # 前端 typecheck + vite build

# Rust 侧
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

> 注意：本机默认工具链是 `x86_64-pc-windows-gnu`，`cargo test` 链接测试可执行文件时可能因
> `WebView2Loader.dll` 缺失而无法启动（STATUS_ENTRYPOINT_NOT_FOUND）。桌面构建用
> `npm run desktop:dev`（内部固定 `stable-x86_64-pc-windows-msvc`）。

## 代码结构

```text
src/
├── components/       # 公共 UI primitives（Button / StatusPill / EmptyState / ErrorNotice …）
├── layout/           # App Shell（三步导航）
├── pages/            # DiscoverPage / GovernPage / WriteBackPage
├── services/         # workspaceService（唯一 Tauri command 边界）、tagSuggestions
├── types/            # 前端类型（discovery / domain）
├── App.tsx
└── styles.css

src-tauri/src/
├── agent_catalog.rs   # 15 个 Agent 的静态目录约定（user_roots / project_roots）
├── agent_discovery.rs # target 登记、项目 root 注册校验、只读扫描与 reconcile
├── commands.rs        # Tauri command 层（唯一 invoke 出口）
├── db.rs              # SQLite schema + repository + 测试
├── linker.rs          # 软连接 / junction 创建、幂等与卸载保护
├── skills.rs          # SKILL.md 解析、校验、安全上限、content hash
├── error.rs / logging.rs / lib.rs
```

原则：页面只依赖 `workspaceService`，不直接触碰 SQLite 或文件系统；后端所有写操作集中在 `linker.rs` 且带幂等与占位保护。

## 数据落点

- 数据库：`<AppData>/skills-manager.sqlite3`（本地 SQLite，WAL 模式）
- 日志：`<AppData>/skills-manager.log`（JSON Lines）
- 开发期可用环境变量 `SKILLS_MANAGER_QA_DATA_DIR` 覆盖数据目录

## CI

`.github/workflows/m0-checks.yml`：

- Ubuntu：TypeScript typecheck + Vite production build；
- Windows：typecheck + `cargo fmt` / `clippy` / `test` + Tauri debug installer 构建并上传 artifact。
