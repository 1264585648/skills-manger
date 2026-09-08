# M3 Agent Discovery + Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only Claude Code discovery that persists approved roots and Skill instances, then displays them as `Unmanaged` without adopting or modifying Agent files.

**Architecture:** Rust owns environment detection, path validation, Skill inspection, scan reconciliation, and SQLite v3 persistence. Tauri commands expose typed records to a thin frontend service; React renders real Agent, root, and unmanaged Skill data while browser preview retains mock fallbacks.

**Tech Stack:** Rust 2021, rusqlite, serde, sha2, Tauri 2, React 19, TypeScript 7, Node 24 test runner, Vite 8.

---

## File Map

- Create `src-tauri/src/agent_discovery.rs`: discovery records, root validation, scanner, reconciliation orchestration, and Rust tests.
- Create `src-tauri/src/claude_code.rs`: safe PATH detection and default user Skill root construction.
- Modify `src-tauri/src/skills.rs`: expose the existing read-only inspector fields needed by discovery.
- Modify `src-tauri/src/db.rs`: schema v3 and CRUD/reconciliation methods for targets, roots, and instances.
- Modify `src-tauri/src/commands.rs`: six discovery Tauri commands.
- Modify `src-tauri/src/lib.rs`: register modules, default records, and commands.
- Create `src/types/discovery.ts`: frontend command record contracts.
- Create `src/services/discoveryMappers.ts`: pure record-to-domain mapping and Library/instance merge.
- Create `tests/discoveryMappers.test.ts`: Node-run frontend regression tests.
- Modify `src/types/domain.ts`: optional Agent warning and scan metadata.
- Modify `src/services/workspaceService.ts`: invoke real discovery commands in Tauri runtime.
- Modify `src/pages/AgentsPage.tsx`: real detection, rescan, loading, empty, and error states.
- Modify `src/pages/SettingsPage.tsx`: real root list, picker, add, and remove behavior.
- Modify `src/pages/SkillsPage.tsx`: label unmanaged instance details without enabling adoption.
- Modify `package.json`: run all frontend tests.
- Modify `README.md` and `docs/e2e-test-report.md`: M3 status and verification evidence.

### Task 1: Finish and Baseline the M2 Fixes

**Files:**
- Modify: `src-tauri/src/skills.rs`
- Modify: `src-tauri/src/skill_preview.rs`
- Create: `src/services/formatTimestamp.ts`
- Modify: `src/services/workspaceService.ts`
- Create: `tests/formatTimestamp.test.ts`
- Modify: `package.json`
- Create: `docs/e2e-test-report.md`

- [ ] **Step 1: Run the focused frontend test and confirm the formatter behavior**

Run: `npm run test:frontend`

Expected: two tests pass, including `formatTimestamp includes local time down to seconds`.

- [ ] **Step 2: Run the production frontend build**

Run: `npm run build`

Expected: TypeScript reports no errors and Vite completes a production build.

- [ ] **Step 3: Run the M2 Rust regression suite**

Run: `cd src-tauri && cargo test`

Expected: the original four tests plus sequence, scalar, invalid-type preview, and staging-hash regressions pass.

- [ ] **Step 4: Review the M2 boundary before committing**

Run:

```powershell
rg -n "Command::new|cmd\.exe|powershell|/bin/sh" src-tauri/src
git diff --check
git status --short
```

Expected: no production process-launch API, no whitespace errors, and only the intended M2 files plus this plan remain changed.

- [ ] **Step 5: Commit the M2 fix set without the M3 plan**

```powershell
git add package.json src-tauri/src/skills.rs src-tauri/src/skill_preview.rs src/services/workspaceService.ts src/services/formatTimestamp.ts tests/formatTimestamp.test.ts docs/e2e-test-report.md
git commit -m "fix: harden canonical skill imports"
```

Expected: one commit containing the approved P1/P2 fixes and their tests.

### Task 2: Add SQLite v3 Discovery Persistence

**Files:**
- Create: `src-tauri/src/agent_discovery.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing schema persistence tests**

Add records to `agent_discovery.rs`:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTargetRecord {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub capabilities: Vec<String>,
    pub detected: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub last_warning: Option<String>,
    pub last_scanned_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRootRecord {
    pub id: String,
    pub agent_id: String,
    pub scope: String,
    pub configured_path: String,
    pub canonical_path: Option<String>,
    pub enabled: bool,
    pub is_default: bool,
    pub last_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstanceRecord {
    pub id: String,
    pub agent_id: String,
    pub root_id: String,
    pub scope: String,
    pub path: String,
    pub name: String,
    pub description: String,
    pub content_hash: String,
    pub script_count: i64,
    pub state: String,
    pub first_discovered_at: i64,
    pub last_discovered_at: i64,
}
```

In `db.rs`, add a test that initializes a database, inserts one target, root, and instance through the wished-for repository methods, reopens it, and asserts all three list methods return the same IDs and that `schema_meta.schema_version` is `3`.

- [ ] **Step 2: Run the new database test to verify RED**

Run: `cd src-tauri && cargo test db::tests::discovery_records_persist_across_database_reopen -- --exact`

Expected: compilation fails because the discovery repository methods and v3 tables do not exist.

- [ ] **Step 3: Add schema v3 tables and row mappers**

Extend `Database::initialize` with:

```sql
CREATE TABLE IF NOT EXISTS agent_targets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    detected INTEGER NOT NULL DEFAULT 0,
    executable_path TEXT,
    version TEXT,
    last_warning TEXT,
    last_scanned_at INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_roots (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('user', 'project')),
    configured_path TEXT NOT NULL,
    canonical_path TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    last_warning TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agent_targets(id) ON DELETE CASCADE,
    UNIQUE(agent_id, scope, configured_path)
);

CREATE TABLE IF NOT EXISTS skill_instances (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('user', 'project')),
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    script_count INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK(state IN ('unmanaged', 'missing')),
    first_discovered_at INTEGER NOT NULL,
    last_discovered_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agent_targets(id) ON DELETE CASCADE,
    FOREIGN KEY(root_id) REFERENCES discovery_roots(id) ON DELETE CASCADE,
    UNIQUE(agent_id, scope, path)
);
```

Set `schema_version` to `3`. Implement typed upsert/list methods and `row_to_*` functions using `serde_json` for `capabilities_json`.

Use these repository signatures so later tasks share one contract:

```rust
pub fn upsert_agent_target(
    &self,
    record: &AgentTargetRecord,
    timestamp: i64,
) -> Result<AgentTargetRecord, AppError>;

pub fn list_agent_targets(&self) -> Result<Vec<AgentTargetRecord>, AppError>;

pub fn upsert_discovery_root(
    &self,
    record: &DiscoveryRootRecord,
    timestamp: i64,
) -> Result<DiscoveryRootRecord, AppError>;

pub fn list_discovery_roots(&self) -> Result<Vec<DiscoveryRootRecord>, AppError>;

pub fn remove_discovery_root(&self, id: &str) -> Result<(), AppError>;

pub fn list_skill_instances(&self) -> Result<Vec<SkillInstanceRecord>, AppError>;

pub fn reconcile_root_instances(
    &self,
    root_id: &str,
    instances: &[SkillInstanceDraft],
    timestamp: i64,
) -> Result<(), AppError>;
```

Define `SkillInstanceDraft` beside the serialized records with the same identity and content fields but without database-owned discovery timestamps.

- [ ] **Step 4: Verify persistence GREEN**

Run: `cd src-tauri && cargo test db::tests::discovery_records_persist_across_database_reopen -- --exact`

Expected: one test passes and reopened records retain identity and state.

- [ ] **Step 5: Run all Rust tests and commit**

```powershell
cd src-tauri
cargo test
cd ..
git add src-tauri/src/agent_discovery.rs src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: persist agent discovery state"
```

Expected: all Rust tests pass before the persistence commit.

### Task 3: Implement the Read-Only Root Scanner

**Files:**
- Modify: `src-tauri/src/agent_discovery.rs`
- Modify: `src-tauri/src/skills.rs`
- Modify: `src-tauri/src/db.rs`
- Test: `src-tauri/src/agent_discovery.rs`

- [ ] **Step 1: Write failing discovery behavior tests**

Create temporary user and project roots with direct children containing `SKILL.md`. Add focused tests named:

```rust
#[test]
fn discovers_valid_skills_without_executing_scripts() {}

#[test]
fn invalid_skill_does_not_hide_valid_sibling() {}

#[test]
fn same_name_in_different_roots_has_distinct_identity() {}

#[test]
fn successful_rescan_marks_removed_instance_missing() {}

#[test]
fn missing_root_preserves_existing_instances_and_returns_warning() {}
```

The first fixture includes `scripts/sentinel.sh` whose contents would create `SCRIPT_EXECUTED`; assert the sentinel never appears. The missing-root test first performs a successful scan, deletes the root, rescans, and asserts the prior instance is not marked missing because the root was not successfully inspected.

- [ ] **Step 2: Run scanner tests to verify RED**

Run: `cd src-tauri && cargo test agent_discovery::tests -- --nocapture`

Expected: tests fail because `scan_root` and reconciliation do not exist.

- [ ] **Step 3: Expose the shared M2 inspection result**

Change `InspectedSkill` in `skills.rs` to expose discovery-safe fields:

```rust
pub(crate) struct InspectedSkill {
    pub(crate) source_path: PathBuf,
    pub(crate) source_id: String,
    pub(crate) skill_id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) content_hash: String,
    pub(crate) script_count: i64,
}
```

Populate `script_count` from the existing `SkillContents`. Do not expose copy, import, or database mutation through this API.

- [ ] **Step 4: Implement root validation and scanning**

Add these internal results:

```rust
#[derive(Debug)]
struct ScannedInstance {
    id: String,
    path: String,
    name: String,
    description: String,
    content_hash: String,
    script_count: i64,
}

#[derive(Debug)]
struct RootScan {
    canonical_path: Option<String>,
    instances: Vec<ScannedInstance>,
    warnings: Vec<String>,
    successful: bool,
}
```

Implement `scan_root` to use `symlink_metadata`, `canonicalize`, sorted direct-child enumeration, `DirEntry::file_type`, and `skills::inspect_skill`. Generate IDs with SHA-256 over `claude-code\0{scope}\0{canonical_path}`. Return root-level failure with `successful: false`; return child-level warnings while keeping `successful: true`.

- [ ] **Step 5: Implement transactional reconciliation**

For each successful root, update existing rows to `missing`, then upsert discovered rows back to `unmanaged` in one SQLite transaction. For a failed root, update its warning and leave instance states unchanged. Preserve `first_discovered_at` on conflict and update `last_discovered_at` only for found instances.

- [ ] **Step 6: Verify scanner GREEN**

Run: `cd src-tauri && cargo test agent_discovery::tests -- --nocapture`

Expected: all five scanner tests pass and no script sentinel is created.

- [ ] **Step 7: Add a platform-gated symlink test**

On Unix use `std::os::unix::fs::symlink`; on Windows attempt `std::os::windows::fs::symlink_dir` and return early only when the OS denies test symlink creation. Assert a linked child is warned and its external target is absent from discovered instances.

- [ ] **Step 8: Run all Rust tests and commit**

```powershell
cd src-tauri
cargo test
cd ..
git add src-tauri/src/agent_discovery.rs src-tauri/src/skills.rs src-tauri/src/db.rs
git commit -m "feat: discover unmanaged skill instances"
```

Expected: M0, M2, persistence, scanner, and symlink tests all pass.

### Task 4: Add Claude Code Detection and Tauri Commands

**Files:**
- Create: `src-tauri/src/claude_code.rs`
- Modify: `src-tauri/src/agent_discovery.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/claude_code.rs`
- Test: `src-tauri/src/agent_discovery.rs`

- [ ] **Step 1: Write failing detector and root-validation tests**

Add tests for:

```rust
#[test]
fn default_user_root_uses_supplied_home() {}

#[test]
fn path_search_finds_platform_claude_executable() {}

#[test]
fn project_root_must_be_dot_claude_skills() {}

#[test]
fn duplicate_project_root_returns_existing_record() {}
```

Use an injected home and PATH string; do not depend on the real machine. The path fixture contains an empty platform-appropriate `claude` or `claude.exe` file and expects its canonical path without launching it.

- [ ] **Step 2: Run detector tests to verify RED**

Run:

```powershell
cd src-tauri
cargo test claude_code::tests -- --nocapture
cargo test agent_discovery::tests::project_root_must_be_dot_claude_skills -- --exact
```

Expected: compilation fails because detector and project-root registration functions do not exist.

- [ ] **Step 3: Implement safe Claude Code environment detection**

Use pure functions with injected inputs:

```rust
pub(crate) fn default_user_skills_root(home: &Path) -> PathBuf {
    home.join(".claude").join("skills")
}

pub(crate) fn find_executable(path_value: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_value).find_map(find_claude_in_directory)
}
```

Use `PATHEXT` candidates on Windows and `claude` on Unix. Check metadata only; never call `Command`, spawn a process, or read Skill scripts. Return version `None` unless adjacent JSON package metadata can be safely parsed.

- [ ] **Step 4: Implement target/root orchestration**

Add:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDiscoverySnapshot {
    pub target: AgentTargetRecord,
    pub roots: Vec<DiscoveryRootRecord>,
    pub instances: Vec<SkillInstanceRecord>,
    pub warnings: Vec<String>,
}
```

Implement initialization of target `claude-code` and the immutable default user root. Validate new project roots before persistence, reject managed-Library descendants, and make duplicate additions idempotent.

- [ ] **Step 5: Add and register Tauri commands**

Add command signatures:

```rust
#[tauri::command]
pub fn list_agent_targets(state: State<'_, AppState>) -> Result<Vec<AgentTargetRecord>, CommandError>;

#[tauri::command]
pub fn scan_claude_code(state: State<'_, AppState>) -> Result<AgentDiscoverySnapshot, CommandError>;

#[tauri::command]
pub fn list_discovery_roots(state: State<'_, AppState>) -> Result<Vec<DiscoveryRootRecord>, CommandError>;

#[tauri::command]
pub fn add_discovery_root(state: State<'_, AppState>, path: String, scope: String) -> Result<DiscoveryRootRecord, CommandError>;

#[tauri::command]
pub fn remove_discovery_root(state: State<'_, AppState>, id: String) -> Result<(), CommandError>;

#[tauri::command]
pub fn list_skill_instances(state: State<'_, AppState>) -> Result<Vec<SkillInstanceRecord>, CommandError>;
```

Register all six in `tauri::generate_handler!`. Log scans and root configuration without logging Skill contents.

- [ ] **Step 6: Verify Rust GREEN and audit process boundaries**

```powershell
cd src-tauri
cargo test
cd ..
rg -n "Command::new|std::process::Command|spawn\(" src-tauri/src
```

Expected: all tests pass and the process search returns no production process-launch code.

- [ ] **Step 7: Commit the adapter command boundary**

```powershell
git add src-tauri/src/claude_code.rs src-tauri/src/agent_discovery.rs src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: expose Claude Code discovery commands"
```

### Task 5: Add Frontend Discovery Contracts and Mapping

**Files:**
- Create: `src/types/discovery.ts`
- Create: `src/services/discoveryMappers.ts`
- Create: `tests/discoveryMappers.test.ts`
- Modify: `src/types/domain.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing mapper tests**

Test that a raw detected target maps to `AgentStatus: ready`, an undetected target maps to `setup`, an `unmanaged` instance maps to a `Skill` with its physical path and security summary, a `missing` instance maps to `status: missing`, and merging preserves all Canonical Library records while appending instances with distinct IDs.

Use this record shape in the test:

```ts
const instance = {
  id: "instance-1",
  agentId: "claude-code",
  rootId: "root-1",
  scope: "project" as const,
  path: "C:/repo/.claude/skills/demo",
  name: "demo",
  description: "Discovered demo",
  contentHash: "abc123",
  scriptCount: 1,
  state: "unmanaged" as const,
  firstDiscoveredAt: 1,
  lastDiscoveredAt: 2,
};
```

- [ ] **Step 2: Run mapper tests to verify RED**

Run: `node --test tests/discoveryMappers.test.ts`

Expected: module-not-found failure for `discoveryMappers.ts`.

- [ ] **Step 3: Add discovery command types and pure mappers**

Define `AgentTargetRecord`, `DiscoveryRootRecord`, `SkillInstanceRecord`, and `AgentDiscoverySnapshot` in `src/types/discovery.ts` matching Rust camelCase serialization exactly.

Implement and export:

```ts
export const mapAgentTarget = (
  record: AgentTargetRecord,
  instances: SkillInstanceRecord[],
  roots: DiscoveryRootRecord[],
): Agent => ({
  id: record.id,
  name: record.name,
  type: record.provider,
  status: record.detected ? "ready" : "setup",
  version: record.version ?? "Unknown",
  path: record.executablePath ?? "未检测到可执行文件",
  scopes: Array.from(new Set(roots.filter((root) => root.enabled).map((root) => root.scope))),
  capabilities: record.capabilities,
  discoveredSkills: instances.filter((item) => item.state === "unmanaged").length,
  warning: record.lastWarning ?? undefined,
});

export const mapSkillInstance = (record: SkillInstanceRecord): Skill => ({
  id: `instance:${record.id}`,
  name: record.name,
  description: record.description,
  source: `Claude Code · ${record.scope === "user" ? "User" : "Project"}`,
  sourcePath: record.path,
  contentHash: record.contentHash,
  version: "—",
  status: record.state,
  groups: [],
  bundles: [],
  targets: ["Claude Code"],
  lastUpdated: formatTimestamp(record.lastDiscoveredAt),
  security: record.scriptCount > 0
    ? `包含 scripts/ · ${record.scriptCount} 个文件 · 未执行`
    : "未发现 scripts/",
});
```

Add optional `warning?: string` and `lastScannedAt?: number` to `Agent`.

- [ ] **Step 4: Run all frontend tests GREEN**

Set `test:frontend` to `node --test tests/formatTimestamp.test.ts tests/discoveryMappers.test.ts`, then run `npm run test:frontend`.

Expected: timestamp and discovery mapper tests all pass.

- [ ] **Step 5: Build and commit**

```powershell
npm run build
git add package.json src/types/domain.ts src/types/discovery.ts src/services/discoveryMappers.ts tests/discoveryMappers.test.ts
git commit -m "feat: map agent discovery records"
```

Expected: strict TypeScript and Vite build pass.

### Task 6: Wire Real Discovery into Agents, Settings, and Skills

**Files:**
- Modify: `src/services/workspaceService.ts`
- Modify: `src/pages/AgentsPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/SkillsPage.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add Tauri-backed workspace service methods**

Implement desktop branches using `invoke`:

```ts
async getDiscoveryState(): Promise<AgentDiscoverySnapshot>;
async scanClaudeCode(): Promise<AgentDiscoverySnapshot>;
async getDiscoveryRoots(): Promise<DiscoveryRootRecord[]>;
async pickDiscoveryRoot(): Promise<string | null>;
async addDiscoveryRoot(path: string): Promise<DiscoveryRootRecord>;
async removeDiscoveryRoot(id: string): Promise<void>;
```

Update `getAgents` to list targets, roots, and instances then call `mapAgentTarget`. Update desktop `getSkills` to list Library records and Skill instances concurrently, then merge mapped instances. Browser branches continue using existing mock arrays.

- [ ] **Step 2: Run typecheck to expose incomplete page contracts**

Run: `npm run typecheck`

Expected: any mismatched discovery records or missing imports fail before page work proceeds; fix service type errors without adding page behavior.

- [ ] **Step 3: Wire Agents rescan states**

Refactor `AgentsPage` into readable statements and add `loading`, `scanning`, and `error` state. The “重新检测” button calls `scanClaudeCode`, reloads agents, and remains disabled while scanning. Render `EmptyState` for no targets and an inline error notice for command failures. Display `selected.warning` when present. Keep “查看 Skills” and “测试目标” disabled because navigation and write verification are outside M3.

- [ ] **Step 4: Wire Settings root management**

Load `DiscoveryRootRecord[]` independently of mock Source settings. Render scope, configured path, enabled/default state, and warning. Add “添加项目 Skill Root” that calls the directory picker and `addDiscoveryRoot`; add “移除” only for non-default roots and confirm removal with the existing UI pattern. Removal changes SQLite records only and the UI text must explicitly say Agent files are untouched.

- [ ] **Step 5: Clarify unmanaged Skills UI**

Change the inspector section label from constant `Library` to `Discovery` when `selected.status` is `unmanaged` or `missing`. Keep “部署到 Agent” disabled and show `只读发现，尚未纳入 Library` for unmanaged records. Update empty-state copy so a list containing only discovered instances does not claim the Library contains them.

- [ ] **Step 6: Add minimal styles for warnings and root actions**

Add scoped classes `.discovery-warning`, `.discovery-root-actions`, and `.readonly-discovery-note` using existing color tokens. Do not redesign page layout or introduce a component library.

- [ ] **Step 7: Verify frontend and commit**

```powershell
npm run test:frontend
npm run build
git add src/services/workspaceService.ts src/pages/AgentsPage.tsx src/pages/SettingsPage.tsx src/pages/SkillsPage.tsx src/styles.css
git commit -m "feat: show real Claude Code discovery"
```

Expected: all frontend tests and production build pass with no new dependency.

### Task 7: Full Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/e2e-test-report.md`
- Modify: `docs/solution.json`
- Modify: `docs/technical-solution.html`

- [ ] **Step 1: Run formatting and static checks**

```powershell
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cd ..
git diff --check
```

Expected: no formatting, compiler-warning, Clippy, or whitespace failures.

- [ ] **Step 2: Run the complete automated suite**

```powershell
npm run test:frontend
npm run build
cd src-tauri
cargo test
cd ..
```

Expected: all Node, TypeScript, Vite, and Rust checks pass.

- [ ] **Step 3: Perform the desktop E2E when GUI prerequisites exist**

Run: `npm run desktop:dev`

Verify with temporary fixtures:

1. Add a valid project `.claude/skills` root.
2. Rescan and observe a valid Skill as `Unmanaged`.
3. Confirm no new Canonical Library directory or `skills` database row is created.
4. Close and reopen the application; confirm roots and instances persist.
5. Confirm the fixture's script sentinel does not exist.
6. Remove the root; confirm only discovery database records disappear and source files remain.

If the GUI or Rust toolchain is unavailable, record `BLOCKED` with the exact command error and do not report M3 E2E PASS.

- [ ] **Step 4: Update project documentation**

Update README with an M3 section listing only implemented discovery behavior and its safety limits. Add an M3 verification section to `docs/e2e-test-report.md` with command results, fixture paths, persistence evidence, and blockers. Align the old solution milestone labels so Canonical Library remains M2 and Agent Discovery remains M3.

- [ ] **Step 5: Audit scope and filesystem safety**

```powershell
rg -n "Command::new|std::process::Command|spawn\(" src-tauri/src
rg -n "remove_dir_all|remove_file|fs::copy|fs::rename|fs::write" src-tauri/src/agent_discovery.rs src-tauri/src/claude_code.rs
git status --short
git diff --stat origin/main...HEAD
```

Expected: discovery production code launches no process and performs no writes, copies, renames, or deletions in Agent roots; only SQLite operations mutate state.

- [ ] **Step 6: Commit documentation**

```powershell
git add README.md docs/e2e-test-report.md docs/solution.json docs/technical-solution.html
git commit -m "docs: record M3 discovery verification"
```

Expected: documentation describes verified behavior without claiming blocked checks passed.

- [ ] **Step 7: Final review**

Run:

```powershell
git status --short
git log --oneline origin/main..HEAD
```

Expected: clean worktree and a focused sequence of M2 fix, M3 persistence, scanner, commands, frontend, and documentation commits following the already committed design and plan.
