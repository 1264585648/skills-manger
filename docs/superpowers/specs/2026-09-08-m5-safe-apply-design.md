# M5 Safe Apply Design

## Outcome

M5 turns an explicitly reviewed, conflict-free Sync Plan into managed Claude Code files with ownership, snapshot, staging, atomic replacement, verification, and rollback. No unmanaged path may be overwritten or deleted.

## Preconditions

- The caller supplies a persisted `plan_id`; Apply never trusts a frontend-supplied path or item list.
- The plan belongs to an enabled, registered discovery root and has state `previewed`.
- Every item is recomputed immediately before writing. A changed plan id, new conflict, missing Library source, unavailable root, or symlink anywhere in the source/target boundary blocks the whole operation.
- `conflict` items block Apply. `unchanged` items are verified but not written.
- User confirmation is represented by the deliberate Apply command invocation; there is no background or start-up Apply.

## Ownership model

`deployments` records `skill_id`, `root_id`, exact canonical destination, deployed hash, and timestamps. Ownership exists only after a successful verified Apply. Matching a name or path during discovery never creates ownership.

- Absent destination and no deployment: safe `add`.
- Existing destination and no deployment: `conflict`, even if the planner previously saw it as absent.
- Existing owned destination whose current hash equals `deployed_hash`: safe `update` when Library differs.
- Existing owned destination whose hash differs from `deployed_hash`: Target Drift conflict.
- Missing owned destination: explicit `restore`, represented as `add` with an ownership warning.
- No M5 operation removes a deployment or target directory; undeploy is deferred until it has its own plan and confirmation semantics.

## Filesystem transaction

For each mutable item, all paths are derived server-side from the registered canonical root and validated Skill name.

1. Create operation directories under App Data: `operations/<operation-id>/stage` and `snapshots/<operation-id>`.
2. Copy the Canonical Library tree into App Data staging using the existing no-symlink, size-limited copier.
3. Re-inspect staging and require its hash to equal the plan Library hash.
4. If an owned destination exists, copy it to the snapshot directory and verify the snapshot hash before touching the target.
5. Create a target-local staging directory using a manager-owned random/hash name; copy verified App Data staging into it.
6. Revalidate target root and destination immediately before rename.
7. Rename owned destination to a target-local backup, rename staging to destination, then re-inspect and verify the deployed hash.
8. Persist deployment and operation success only after verification; remove target-local backup.
9. On failure, remove only manager-owned staging/destination created by this operation and rename the backup back. Never recursively delete an unresolved or user-supplied path.

Multi-item Apply is an operation with per-item rollback. If item N fails, restore items 1..N in reverse order from verified snapshots (or remove destinations that the operation newly created), and record the operation as rolled back or rollback-failed.

## Persistence and audit

- `sync_plans` / `sync_plan_items`: immutable preview payload and status.
- `deployments`: ownership and last verified hash.
- `apply_operations` / `apply_operation_items`: state, paths relative to controlled roots, before/after hashes, and errors.
- Snapshots live only under App Data. Logs contain ids, relative names, hashes, and outcomes, never Skill file contents.

## UI

The Apply button becomes available only for a persisted plan with no conflicts. A confirmation dialog lists target root, add/update counts, snapshot location policy, and the explicit “scripts are copied but never executed” statement. Progress and rollback outcomes are rendered from operation records.

## Required verification gate

Because this module performs destructive-capable filesystem operations, implementation may be written only with unit/integration tests first, and it must not be declared complete until `cargo fmt`, strict Clippy, full Rust tests, and temporary-directory desktop E2E pass. On the current machine those commands are blocked because Rust is absent; no real Agent root will be used for development testing.
