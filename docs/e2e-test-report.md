# Skills Manager M2 E2E Test Report

测试日期：2026-09-06（Asia/Shanghai）  
原始测试结论（提交 `15de366`）：**M2 E2E FAIL**  
当前工作区修复状态：**3 个已发现缺陷均已完成最小修复；前端复验通过，Rust/桌面复验因本机缺少 Rust 工具链而阻断。**

## 环境

| 项目 | 值 |
|---|---|
| OS | Microsoft Windows 11 专业版 10.0.22621，64 位 |
| Node | v24.14.1 |
| npm | 11.11.0 |
| Rust | 未安装或未加入 PATH；`rustc`、`cargo` 均无法找到 |
| 仓库 | `https://github.com/1264585648/skills-manger.git` |
| 分支 | `main`，与 `origin/main` 一致 |
| 测试提交 | `15de366d5e6a465587e7a95d16f05fee54da4b37` |
| 最近提交 | `15de366`、`d80634a`、`540f4d8`、`f1632f6`、`bf357e2` |

远端更新后重新检查，测试开始时工作区无内容差异。`npm install` 会因仓库未跟踪锁文件而生成未跟踪的 `package-lock.json`；该测试产物已在报告生成前移除。

## 构建与自动化测试

| 命令/检查 | 结果 | 备注 |
|---|---|---|
| `npm install` | PASS | 依赖安装完成 |
| `npm run build` | PASS | TypeScript `tsc --noEmit` 无错误；Vite 8.2.2 构建成功，35 modules transformed |
| `cargo test`（本机） | BLOCKED | 本机无 `cargo`，按要求未安装、未修改环境 |
| `npm run desktop:dev`（本机） | BLOCKED | `cargo metadata ... program not found` |
| 同提交 GitHub Actions | PASS | Run `34032515480`，Windows desktop build 与 frontend job 均成功 |
| CI Rust tests | PASS | 4 passed，0 failed，耗时 1.70s |
| CI Windows installer | PASS | 使用该 run 的 debug MSI 做管理提取，未安装到系统；提取后的应用用于桌面 E2E |

CI 中通过的 Rust 测试：

1. `db::tests::counter_persists_across_database_reopen`
2. `skills::tests::import_is_idempotent_and_detects_updates`
3. `skills::tests::same_name_from_different_sources_can_coexist`
4. `skills::tests::invalid_manifest_name_is_rejected`

CI 证据：[GitHub Actions run 34032515480](https://github.com/1264585648/skills-manger/actions/runs/34032515480)。本机缺少 Rust 属测试环境问题，不视为产品缺陷，但会阻断本地 Rust 回归和 `desktop:dev`。

## 修复复验（当前工作区）

| 缺陷 | 修复状态 | 自动化复验 |
|---|---|---|
| M2-E2E-001 `allowed-tools` 列表无法导入 | 已修复 | 新增 sequence、scalar、非法类型测试；Rust 测试因本机无 `cargo` 未执行 |
| M2-E2E-002 UI 更新时间只有日期 | 已修复 | `npm run test:frontend`：2 passed，0 failed；`npm run build`：PASS |
| M2-E2E-003 staging 内容完整性竞态 | 已修复 | 新增并发修改源目录时以 staging 副本 hash 为准的 Rust 回归测试；因本机无 `cargo` 未执行 |

修复实现保持在 M2 范围内，未新增依赖、未开发 M3：

- preview 与 import 复用同一套完整 manifest 解析、字段校验和目录扫描逻辑。
- `allowed-tools` 同时接受字符串和字符串数组；数组以逗号加空格规范化存入现有 SQLite 文本字段。
- 复制完成后重新解析并计算 staging 副本 hash，SQLite 只记录将要进入 Library 的实际内容。
- UI 时间显示扩展到本地时区的秒级，并加入独立前端单元测试。

当前工作区验证：

| 命令 | 结果 | 备注 |
|---|---|---|
| `npm run test:frontend` | PASS | 2 passed，0 failed |
| `npm run build` | PASS | TypeScript 无错误；Vite 8.2.2 构建成功，36 modules transformed |
| `cargo test` | BLOCKED | `cargo` 不在 PATH；遵循验收约束未安装或修改环境 |

## 测试数据

主规范样例位于：

`C:\Users\Administrator\tmp\skills-manger-e2e\test-skills\demo-skill`

其 `allowed-tools` 严格使用任务给定的 YAML 列表：

```yaml
allowed-tools:
  - read
```

为继续测试其他链路，另建仅将该字段改为当前实现可接受标量的兼容样例：

`C:\Users\Administrator\tmp\skills-manger-e2e\compatible-source\demo-skill`

测试脚本 `scripts/hello.sh` 若被执行会创建 `SCRIPT_EXECUTED.txt` 哨兵。全部测试结束后该哨兵不存在。

## 测试结果

|测试项|结果|备注|
|-|-|-|
|启动|PASS|与 HEAD 完全一致的 CI Windows debug 产物可启动，窗口正常响应；本机 `desktop:dev` 因缺少 Rust 被环境阻断|
|选择 Skill 目录/预览|PASS|原生目录选择器可选目录；Import Plan 正确显示名称、描述、来源、动作及 hash 前缀|
|导入 Skill|FAIL|任务给定的 `allowed-tools` 列表在确认导入时失败；兼容标量样例可成功导入|
|SKILL.md 解析|FAIL|`name`、`description`、`license`、`compatibility`、`metadata` 可解析，但 `allowed-tools` 不接受 YAML sequence|
|Library/UI 展示|PASS|兼容样例显示正确名称、description、本地来源、hash、安全摘要、license、更新时间；SQLite 与托管副本一致|
|重复导入|PASS|Import Plan 显示“无变化 1”；SQLite 仍为 1 行，Skill ID、hash、`imported_at`、`updated_at` 均不变|
|更新检测|PASS|增加 `version update test` 后显示“更新 1”；ID 不变，hash 变更，`updated_at` 更新，`imported_at` 不变|
|同名 Skill|PASS|另一来源同名 Skill 显示“新增”；UI/SQLite 同时存在 2 条，ID、source、hash 不同，未覆盖|
|异常校验|PASS|缺失 `SKILL.md`、name/目录不一致、2001 文件均在预览阶段拒绝，Library 行数不变|
|持久化|PASS|通过窗口关闭应用后重启，UI 与 SQLite 均恢复 2 个 Skill，ID 未变化|
|脚本不执行|PASS|UI 明示扫描不执行脚本；运行期间无脚本进程调用代码路径，哨兵文件始终不存在|
|symlink/junction|PASS|指向根目录外的 Windows junction 在预览阶段被拒绝，外部哨兵文件未复制到 Library|

关键 SQLite 证据：

| 来源 | Skill ID | Content hash | imported_at | updated_at |
|---|---|---|---:|---:|
| `compatible-source\demo-skill` | `ee760f35d0700b6c28dafcab62ba3bf49235ea245003911f2e17e9be720f44a2` | `356b314349598e00d4b49403092f879088ac462e5212a9b7ce969d389bddbc90` | 1788697411 | 1788697549 |
| `another-location\demo-skill` | `1943bb12651af7965320f2927dcd524569097794077ca554a7b7846a2362bfec` | `7f7dfe6d007340b4b1e00cb3de2f1a09e46c1e7fe7512ce54f0f8c57e2ee35bc` | 1788697577 | 1788697577 |

对两个 Library 副本按项目算法重新计算 hash，均与 SQLite `content_hash` 完全一致。

## 异常用例明细

| 用例 | 实际结果 | 判定 |
|---|---|---|
| 目录缺少 `SKILL.md` | `invalid skill: selected directory does not contain SKILL.md` | PASS |
| 目录 `abc`，manifest `name: xyz` | `SKILL.md name 'xyz' must match parent directory 'abc'` | PASS |
| 2001 个文件 | `skill contains more than 2000 files; import is blocked for safety` | PASS |
| 根目录内 junction 指向外部目录 | `symbolic links are not supported during import preview` | PASS |
| 规范样例 `allowed-tools` 为列表 | 预览为“新增”，确认后 `invalid type: sequence, expected a string` | FAIL |

## 安全边界检查

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| 扫描/导入是否执行 scripts | PASS | Rust 生产代码未发现 `Command::new`、spawn、shell/exec 调用；脚本哨兵未生成 |
| 是否访问 Skill 外部目录 | PASS | 遍历从 canonical root 开始；外链 junction 被拒绝；Library 未出现外部哨兵内容 |
| 是否跟随 symlink | PASS | preview 与 import/copy 两阶段均检查 `file_type.is_symlink()`；Windows junction 实测拒绝 |
| 路径穿越 | PASS | source 与 library 先 canonicalize；禁止从 managed library 反向导入；相对路径使用 `strip_prefix(root)`；目标目录名为 SHA-256 Skill ID，复制目标仅拼接 `entry.file_name()` |
| 任意文件写入 | PASS | 生产写入范围为 App Data 下的 SQLite、日志、`library/<skill-id>`、staging/backup；未发现用户可控绝对写入目标 |
| 内容完整性 | PASS（本次） | 两个托管副本重算 hash 均与数据库一致 |

静态审计发现一个低概率完整性竞态：当前顺序为“扫描并计算 source hash → 再复制 source 到 staging”。若源目录在两步之间被并发修改，数据库 hash 可能与最终托管副本不一致。本次实测未触发，详见 P2。

## Bug 列表

### P0

无。

### P1

#### M2-E2E-001：合法的 `allowed-tools` YAML 列表无法导入

- 复现：选择任务给定的 `demo-skill`，预览显示“新增 1”，点击“确认导入”。
- 期望：成功解析并写入 Library/SQLite。
- 实际：`YAML parse error: allowed-tools: invalid type: sequence, expected a string at line 8 column 3`；Library 不新增。
- 根因：`src-tauri/src/skills.rs` 的 `SkillFrontmatter.allowed_tools` 为 `Option<String>`，只接受标量；而 `src-tauri/src/skill_preview.rs` 的预览 frontmatter 只读取 name/description，忽略该字段，导致预览和执行验证不一致。
- 修复：已增加兼容字符串/字符串数组的 serde 表达并统一规范化存储；preview 与 import 已复用同一 manifest 解析/校验函数；已补充 sequence、scalar、非法类型三个 Rust 测试。
- 复验状态：代码审查完成；本机 Rust 执行验证被环境阻断。

### P2

#### M2-E2E-002：UI 更新时间只有日期精度

- 实际：数据库 `updated_at` 已从 `1788697411` 更新为 `1788697549`，但 UI 前后都显示 `2026/09/06`，用户无法从界面确认同日更新。
- 根因：`workspaceService.formatTimestamp` 只格式化 year/month/day。
- 修复：抽取可测试的时间格式化函数，UI 改为显示本地日期和时分秒。
- 复验状态：前端单元测试与生产构建均通过；待 Rust 环境可用后进行桌面 UI 复验。

#### M2-E2E-003：扫描 hash 与复制之间存在 TOCTOU 完整性窗口

- 实际：本次托管副本 hash 一致，未复现数据损坏。
- 风险：源目录在 `inspect_skill/hash_tree` 完成后、`copy_tree` 结束前若被并发修改，已记录的 hash 可能不代表 Library 中实际内容。
- 修复：复制后重新解析并计算 staging 副本 hash，数据库写入 staging 的 metadata、脚本摘要和 content hash；解析失败会清理 staging。
- 复验状态：已增加并发修改源目录的确定性回归测试；本机 Rust 执行验证被环境阻断。

## 建议

1. 在具备 Rust stable 的环境运行新增 Rust 回归并重新构建桌面应用；重点复验规范 `allowed-tools` sequence 样例和 staging hash 一致性。
2. 后续可继续补齐 100 MB、symlink/junction 的自动化回归；本次已新增 `allowed-tools` sequence/scalar/非法类型及 staging hash 一致性测试。
3. 提交并维护 lockfile，或明确采用不提交 lockfile 的版本策略，避免 `npm install` 后工作区天然变脏并降低可复现性。
4. 开发机补齐 Rust stable 后再本地重跑 `cargo test` 与 `npm run desktop:dev`；本报告未自行修改环境。
5. 使用修复后的桌面二进制和最初规范样例完整复跑本报告所有用例；全部通过后才可输出 `M2 E2E PASS`。

---

# Skills Manager M3 Discovery Verification

测试日期：2026-09-08（Asia/Shanghai）

分支：`codex/m3-agent-discovery`

结论：**实现、前端验证、CI Rust tests 与 Windows 安装包构建通过；本机真实 UI E2E 因缺少 Rust 工具链仍为 BLOCKED。未输出 M3 E2E PASS。**

## M3 范围

M3 仅实现 Claude Code 的只读发现：PATH 检测、默认 User root、显式 Project root、`SKILL.md` 检查、SkillInstance SQLite 持久化及 UI 展示。不包含 Adopt、部署、同步、watcher 或任何 Agent 文件写入。

## 自动化与构建结果

| 命令/检查 | 结果 | 备注 |
|---|---|---|
| `npm run test:frontend` | PASS | 5 passed，0 failed；包含 timestamp 和 discovery mapper |
| `npm run build` | PASS | TypeScript 无错误；Vite 8.2.2，37 modules transformed |
| `git diff --check` | PASS | 无 whitespace error；仅有 Git 的 CRLF 提示 |
| `cargo test` | BLOCKED | `cargo` 不在 PATH，按项目验收约束未安装或修改环境 |
| `cargo fmt --check` / `cargo clippy` | BLOCKED | 同上 |
| `npm run desktop:dev` | BLOCKED | `cargo metadata --no-deps --format-version 1: program not found` |
| GitHub Actions Rust tests | PASS | Run `34243701885`：23 passed，0 failed |
| GitHub Actions Windows installer | PASS | debug MSI/NSIS 均构建并上传，artifact SHA-256 `260a8d800d1d5dcb7cd4c7651b64513bf12a127f21fa04b54500b3f8fa0c8db7` |

## M3 测试矩阵

| 测试项 | 实现/静态检查 | 本机运行验证 | 备注 |
|---|---|---|---|
| Claude Code PATH 检测 | PASS | BLOCKED | 仅检查候选文件 metadata/canonical path，不启动进程 |
| 默认 User root | PASS | BLOCKED | 登记 `~/.claude/skills`；不存在时记录 warning |
| Project root 添加/重复添加 | PASS | BLOCKED | 只接受真实 `.claude/skills` 目录，稳定 ID 保证幂等 |
| Skill 只读发现 | PASS | BLOCKED | 复用 M2 manifest、hash、文件数和大小边界 |
| 无效 sibling 隔离 | PASS | BLOCKED | 单个无效 Skill 转为 root warning，不隐藏有效 sibling |
| Missing reconciliation | PASS | BLOCKED | 仅成功读取 root 后标记消失实例；root 失败保留旧状态 |
| SQLite v3 持久化 | PASS | BLOCKED | target/root/instance repository 与重开数据库测试已加入 |
| UI 展示与映射 | PASS | PASS | Agent ready/setup、Unmanaged/Missing、Library 合并测试通过 |
| scripts 不执行 | PASS | BLOCKED | 生产代码无进程启动；Rust sentinel 测试已加入但未执行 |
| symlink 边界 | PASS | BLOCKED | root、Skill 目录、`SKILL.md` 和内容树均拒绝 symlink |
| 移除 root 不改 Agent | PASS | BLOCKED | SQLite FK cascade 删除发现记录；命令不执行文件删除 |

## M3 安全审计

- `agent_discovery.rs` 与 `claude_code.rs` 不调用 `Command`、shell、spawn 或脚本。
- 扫描限定为已登记 root 的直接子目录；root 和每个子项先检查 symlink 类型。
- Project root 必须 canonicalize 后精确落在 `.claude/skills` 结构，且不能位于受管 Library 内。
- 发现模块的外部状态变更仅为 SQLite；没有 `write`、`copy`、`rename`、`remove_file` 或 `remove_dir_all` 的生产调用。
- `SKILL.md` 在读取前使用 `symlink_metadata`，manifest 本身是链接时拒绝，避免读取 root 外内容。

## 待复验事项

在具备 Rust stable 与 Windows Tauri 构建依赖的环境依次运行：`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test`、`npm run desktop:dev`。桌面 E2E 需覆盖添加临时 Project root、扫描、重启持久化、Missing、移除 root 后源文件仍存在及脚本 sentinel 不存在。

---

# Skills Manager M4 Bundle + Planner Verification

测试日期：2026-09-08（Asia/Shanghai）

结论：**M4 前端与 CI Rust/Windows 构建通过；本机桌面 E2E BLOCKED，不宣称 M4 E2E PASS。**

| 测试项 | 结果 | 备注 |
|---|---|---|
| Bundle frontend mapper | PASS | 保留 position 排序及 Skill id |
| Plan frontend mapper | PASS | 保留 action、current/library hash 与 reason |
| 全部前端测试 | PASS | 7 passed，0 failed |
| TypeScript + Vite build | PASS | 37 modules transformed |
| SQLite v4 Bundle 持久化测试 | PASS | GitHub Actions Run `34243701885`，包含在 23 个 Rust tests 中 |
| Planner add/unchanged/conflict 测试 | PASS | 同一 CI run；确定性 plan id 与三种分类通过 |
| 桌面 Bundle CRUD / Plan UI | BLOCKED | `npm run desktop:dev` 依赖缺失的 `cargo` |

浏览器 UI 冒烟通过：Playwright 打开 Vite 页面，进入“工作流”后 Bundle 列表、详情和新建编辑器均可访问；进入“环境更新”后在缺少桌面发现 root 时正确显示空状态，生成与确认按钮禁用。控制台仅有缺失 `favicon.ico` 的 404，与业务无关。该检查使用 mock/空 fallback，不替代 Tauri command E2E。

M4 静态安全检查确认 Planner 模块没有生产文件写入、复制、重命名、删除或进程启动；测试代码仅在系统临时目录创建/清理 SQLite fixture。M4 没有 Apply Tauri command，UI 的 Agent 写入按钮保持 disabled。
