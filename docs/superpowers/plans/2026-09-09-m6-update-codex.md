# M6 Update + Codex Adapter Implementation Plan

1. Add failing Rust tests for update-state classification, safe promotion, Git command argument validation, Codex detection/root registration, and generic scanning.
2. Migrate SQLite to schema v6 with `git_sources` and `skill_tracking`; add typed repositories and persistence tests.
3. Implement a hook-disabled Git transport using direct process invocation, app-owned checkouts, HTTPS validation in production, and local repositories only in tests.
4. Add Git import/check/promote commands. Reuse M2 parsing, size, symlink, staging, and hash guarantees for checkout content and Library replacement.
5. Generalize Agent discovery around adapter IDs. Register Codex, detect it without process launch, support its bounded user/project roots, and reuse scanning.
6. Add frontend contracts and service methods. Surface update states/actions in Skills and Codex/root controls in Agents and Settings.
7. Run frontend tests/build locally. Push to the draft PR so Windows CI runs fmt, Clippy, Rust tests, and installer build; apply only minimal fixes from evidence.
8. Update README and the E2E report with M5/M6 scope, security findings, commands, test counts, CI run URLs, and remaining manual limitations.
