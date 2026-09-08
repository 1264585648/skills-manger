# M5 Safe Apply Implementation Plan

**Goal:** Apply persisted, explicitly confirmed Sync Plans without overwriting unmanaged content and with verified rollback.

## Verification checkpoints

1. Add failing temporary-directory tests for unmanaged collision, drift, symlink, stale plan, script non-execution, add, update, mid-operation rollback, and persistence restart.
2. Persist immutable plans, deployments, operations, and operation items in schema v5.
3. Extend the Planner with ownership-aware `update` and drift classification and persist every preview.
4. Extract reusable guarded tree copy/inspection primitives without weakening M2/M3 limits.
5. Implement single-item Apply and verification entirely against temporary roots.
6. Implement multi-item reverse rollback and failure recording.
7. Expose `apply_sync_plan` and operation-list commands; never accept client paths.
8. Add confirmation/progress/result UI and frontend contract tests.
9. Run Rust format, strict Clippy, all tests, desktop E2E, and a filesystem safety audit before enabling the UI button.

## Current gate

Steps 1-9 require a functioning Rust toolchain for the red/green/refactor cycle. This repository's current machine reports `cargo: command not found`; per the original QA constraint the agent will not install or modify the environment. Until the gate is removed, the production Apply command and enabled UI button must not be added.
