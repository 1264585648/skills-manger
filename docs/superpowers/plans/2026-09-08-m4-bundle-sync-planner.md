# M4 Bundle + Read-only Sync Planner Implementation Plan

**Goal:** Persist ordered Bundles and generate explainable, non-mutating Claude Code Sync Plans from Canonical Library and discovery state.

## Tasks

1. Add Rust Bundle and Plan record types plus SQLite schema v4 (`bundles`, `bundle_items`).
2. Add repository validation and transactional list/upsert/delete behavior with persistence tests.
3. Add a pure read-only planner that classifies `add`, `unchanged`, and `conflict`, with deterministic ids and tests.
4. Expose list/upsert/delete/generate commands and register them in Tauri.
5. Add frontend contracts, mappers, and Node tests.
6. Replace desktop Bundle/Sync mocks with command-backed services and loading/error/empty states.
7. Run frontend tests/build, audit process/filesystem boundaries, document exact Rust/desktop blockers, and commit logical checkpoints.

No task may add an Agent filesystem write or an Apply command.
