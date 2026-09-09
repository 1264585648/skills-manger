# M6 Update + Codex Adapter Design

## Outcome

M6 completes the V1 roadmap with two capabilities: a tracked Git source whose upstream state can be checked and explicitly promoted into the Canonical Library, and a second filesystem Agent adapter for Codex. The update model compares three independent lines: upstream checkout, managed Library copy, and each owned target deployment.

## Safety boundaries

- Git commands use `std::process::Command` directly with fixed argument positions; no shell is involved.
- Only `https://` repository URLs are accepted in V1. Credentials are delegated to the user's Git configuration and are never persisted by the app.
- A Git check may fetch into an app-owned checkout, but never changes Library or Agent targets.
- Promoting an upstream update uses staging, hash verification, and atomic replacement of only the app-owned Library path.
- Agent discovery and synchronization never execute Skill scripts.
- Codex roots are explicit bounded directories. Symlinks are rejected using the same scanner and apply engine as Claude Code.
- No automatic update, target overwrite, conflict merge, undeploy, or arbitrary Git hook execution is added. Clone/fetch commands disable hooks through per-command Git configuration.

## Persistence

Schema v6 adds:

- `git_sources`: URL, reference, optional Skill subpath, app-owned checkout path, fetched revision, timestamps, and last error.
- `skill_tracking`: one tracked Git source per Library Skill, base hash/revision from the last accepted upstream version, latest upstream hash/revision, and check timestamp.

Git source identity is derived from normalized URL + reference + Skill subpath. The Library Skill ID remains stable for the tracking record.

## Update state machine

For each tracked Skill:

- `clean`: upstream hash and Library hash equal the accepted base; all owned targets match their deployed hash.
- `upstream_update`: upstream differs from base while Library still equals base.
- `local_modified`: Library differs from base while upstream still equals base.
- `conflict`: upstream and Library both differ from base and are not identical.
- `target_drift`: at least one existing target differs from its deployed hash; this takes precedence in the UI.
- `missing`: at least one owned target directory is missing; this takes precedence after drift.

When Library and upstream are identical but base is older, the app advances tracking metadata without copying. An explicit promote operation is allowed only for `upstream_update`; conflicts remain read-only.

## Codex adapter

Codex is registered as a second `agent_target`. Candidate user roots are `~/.codex/skills` and `~/.agents/skills` when present; users may explicitly register a project `.agents/skills` root. Detection only searches PATH for the Codex executable and never launches it. The generic root scanner, Bundle planner, ownership registry, and Safe Apply engine are shared across adapters.

The root conventions are deliberately represented as adapter metadata rather than assumptions in the planner. OpenAI describes Skills as portable `SKILL.md` packages usable in Codex; local root candidates remain visible and user-controlled.

## UI

- Skills shows tracked-source status and exposes “Check updates” and “Promote upstream” only when valid.
- Agents shows Claude Code and Codex independently, with one scan action covering both.
- Settings permits selecting the adapter when adding a project root and shows the adapter for each root.
- Sync remains adapter-neutral and applies to the selected root.

## Acceptance

- Git fixture tests cover clone/check, upstream-only changes, local-only changes, conflict, target drift, and explicit promotion.
- Codex fixture tests cover PATH detection, default roots, project-root validation, discovery without script execution, and shared Safe Apply.
- Existing M2-M5 tests stay green; strict format, Clippy, frontend build, and Windows installer CI pass.
