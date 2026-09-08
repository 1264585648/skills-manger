# M3 Agent Discovery + Adapter Design

## Goal

Add read-only Claude Code discovery to Skills Manager. The application detects the Claude Code target, scans explicitly approved user and project Skill roots, persists discovered `SkillInstance` records, and displays them as `Unmanaged` without importing, copying, deleting, or modifying their files.

## Scope

M3 includes:

- A Rust-owned Claude Code discovery adapter.
- Automatic registration of the current user's `~/.claude/skills` root.
- Explicitly configured project Skill roots that point to a project's `.claude/skills` directory.
- Persistent Agent target, discovery root, and Skill instance records.
- Manual rescanning from the Agents page.
- Root management from Settings.
- Read-only `Unmanaged` instance display in Skills.

M3 does not include:

- Adopting an instance into the Canonical Library.
- Copying or synchronizing Skills into an Agent directory.
- Watchers or background filesystem monitoring.
- Bundle persistence, Sync Apply, Snapshot, Verify, or Rollback.
- Git sources, a second writable Agent adapter, or automatic updates.

## Architecture

Rust is the authority for filesystem access, parsing, hashing, safety checks, identity generation, and SQLite persistence. React pages call typed service methods backed by Tauri commands and never inspect Agent directories directly.

The implementation adds two focused Rust modules:

- `agent_discovery.rs`: shared discovery models, root scanning, identity generation, persistence orchestration, and scan warnings.
- `claude_code.rs`: Claude Code target detection and construction of the default user Skill root.

M2's `skills.rs` exposes a read-only inspection function that returns parsed manifest fields, deterministic content hash, and script count. Discovery reuses that function so imported and discovered Skills follow the same parser, limits, `.git` exclusion, and symlink policy.

## Discovery Rules

The default user root is `<home>/.claude/skills`. It is registered with scope `user`. An absent default root is valid and reported as unavailable rather than as an application error.

Project roots are added explicitly by the user and must point to a `.claude/skills` directory. They are stored with scope `project`. M3 does not search a drive, home directory, repository tree, or nested project tree for additional roots.

For each enabled root, the scanner:

1. Canonicalizes the configured root.
2. Verifies that it is a directory outside the managed Canonical Library.
3. Enumerates direct child directories only.
4. Rejects symbolic links and junctions at the root-entry and Skill-tree levels.
5. Inspects child directories containing `SKILL.md` with the shared M2 inspector.
6. Records valid instances and a warning for each invalid or unreadable child.
7. Never executes a Skill script or any command described by Skill content.

One invalid Skill cannot prevent other valid Skills in the same root from being discovered. A missing or unreadable root produces a root-level warning and preserves the application's ability to show other roots.

## Identity and State

A discovery root ID is the SHA-256 of:

```text
claude-code\0<scope>\0<canonical-root-path>
```

A Skill instance ID is the SHA-256 of:

```text
claude-code\0<scope>\0<canonical-skill-path>
```

The canonical physical path is part of identity, so same-name Skills in different roots or scopes coexist. Repeated scans upsert the same instance instead of creating duplicates.

Instances found in the latest successful scan have state `unmanaged`. Instances previously seen under a successfully scanned root but absent from the new result have state `missing`. A root that could not be scanned does not mark its existing instances missing because absence was not established.

M3 never changes an instance to `managed`; that transition belongs to a later explicit Adopt workflow.

## SQLite Schema v3

`agent_targets` stores:

- `id` primary key (`claude-code`).
- `name`, `provider`, and serialized capabilities.
- `detected` boolean.
- Optional executable path and version.
- Optional last warning.
- `last_scanned_at` and `updated_at` Unix timestamps.

`discovery_roots` stores:

- Stable root `id` primary key.
- `agent_id` foreign key.
- `scope` constrained to `user` or `project`.
- Configured path and optional canonical path.
- `enabled` boolean.
- `is_default` boolean.
- Optional last warning.
- `created_at` and `updated_at` timestamps.

`skill_instances` stores:

- Stable instance `id` primary key.
- `agent_id` and `root_id` foreign keys.
- `scope`, canonical physical path, name, and description.
- Content hash and script count.
- State constrained to `unmanaged` or `missing`.
- `first_discovered_at`, `last_discovered_at`, and `updated_at` timestamps.

The migration preserves the existing M2 `skill_sources` and `skills` tables. Foreign keys cascade only when a configured discovery root is explicitly removed. Removing a root removes discovery records, never filesystem content.

## Command and Service Contracts

Tauri exposes:

- `list_agent_targets() -> Vec<AgentTargetRecord>`
- `scan_claude_code() -> AgentDiscoverySnapshot`
- `list_discovery_roots() -> Vec<DiscoveryRootRecord>`
- `add_discovery_root(path, scope) -> DiscoveryRootRecord`
- `remove_discovery_root(id) -> ()`
- `list_skill_instances() -> Vec<SkillInstanceRecord>`

`add_discovery_root` accepts project scope in M3. The default user root is maintained by the backend and cannot be removed. Duplicate canonical roots return the existing record.

The frontend `workspaceService` maps these command records into domain types. Browser-only Vite preview continues using mock data; the Tauri runtime uses only real records.

## Claude Code Detection

Detection uses read-only environment and filesystem inspection. It searches the current `PATH` using platform executable suffix rules and records the first existing `claude` executable. It does not launch the executable. Version is populated only when it can be read from adjacent package metadata without executing code; otherwise the UI displays `Unknown`.

The target may still be useful when no executable is found if configured Skill roots exist. In that case `detected` is false while roots and instances remain visible.

## UI Design

### Agents

The Agents page loads persisted targets and instances. It shows Claude Code detection status, executable path, version, capabilities, configured scopes, discovered count, and last scan warning. “重新检测” calls `scan_claude_code`, disables itself while scanning, then reloads the page data. Loading, empty, and error states are explicit.

### Settings

Settings lists the immutable default user root and removable project roots. “添加项目 Skill Root” opens a native directory picker and saves the selected `.claude/skills` directory. Invalid selections show the backend error without modifying persisted roots.

### Skills

The Skills page combines Canonical Library records with discovered instances for display. Discovered instances use `status: unmanaged`, show their Agent/scope as source, and expose their physical path and hash. They cannot be deployed or imported in M3. Existing Library behavior remains unchanged.

## Error Handling

Command-level failures use the existing structured `CommandError`. Scan-specific recoverable issues are returned as warnings attached to a root or snapshot rather than aborting the command.

Adding a root fails when:

- The selected path does not exist or is not a directory.
- The selected directory is not named `skills` with parent `.claude`.
- The path is a symbolic link or junction.
- The path is inside the managed Canonical Library.
- The path cannot be canonicalized or safely represented.

No command accepts a destination path for copying or writing Skill content.

## Testing

Rust tests use temporary directories and do not depend on a real Claude Code installation. They cover:

- Default user root construction.
- User and project root discovery.
- Same-name instances at different paths.
- Idempotent rescans.
- Missing-root warnings without global failure.
- Invalid manifest isolation.
- Missing-instance state after a successful rescan.
- Symlink/junction rejection where the platform permits creation.
- Script sentinel non-execution.
- Database persistence after reopening.
- M2 import regression tests.

Frontend tests cover record mapping and merged Library/Unmanaged presentation. Production verification runs `npm run test:frontend`, `npm run build`, `cargo fmt --check`, `cargo test`, and `cargo clippy --all-targets --all-features -- -D warnings` where the Rust toolchain is available.

Desktop E2E verifies manual root selection, rescanning, `Unmanaged` display, persistence after restart, and absence of script execution. If a GUI or Rust toolchain is unavailable, the report records the exact blocker and does not claim M3 E2E PASS.

## Security Invariants

- Discovery is read-only with respect to every configured Agent root.
- No Skill script, manifest instruction, hook, or executable is launched.
- Only explicitly registered roots are scanned.
- Symlinks and junctions are not followed.
- Canonical paths and stable hash-derived IDs prevent path traversal into write targets.
- Removing database records never removes Agent filesystem content.
- Discovery does not imply adoption, ownership, deployment, or trust.
