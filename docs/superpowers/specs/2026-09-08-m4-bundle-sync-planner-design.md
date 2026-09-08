# M4 Bundle + Read-only Sync Planner Design

## Outcome

M4 replaces mock Bundles and mock Sync items with SQLite-backed Bundle definitions and a Rust-generated, read-only Sync Plan for one Claude Code discovery root. It does not deploy, overwrite, delete, adopt, or otherwise mutate Agent files.

## Domain and persistence

- `bundles`: stable id, name, description, timestamps.
- `bundle_items`: ordered references from a Bundle to Canonical Library Skill ids, with `required` or `optional` mode.
- Deleting a Canonical Skill is outside M4; foreign keys protect Bundle references.
- Bundle create/update is a single transaction. The request supplies the full ordered item list, so replacement is deterministic.
- Names are required and unique case-insensitively. A Bundle must contain at least one Canonical Library Skill and cannot contain duplicate Skill ids.

## Planner

Input is `bundle_id` plus one enabled Claude Code discovery `root_id`. The planner reads only SQLite records produced by M2 and M3.

For each Bundle item:

- no currently discovered instance with the same validated Skill name in the selected root: `add`;
- exactly one unmanaged instance with identical content hash: `unchanged`;
- an unmanaged instance with different content hash: `conflict` because no deployment ownership baseline exists;
- a persisted `missing` instance behaves as absent: `add`;
- multiple matching instances are a defensive `conflict`.

Plan and item ids are deterministic hashes of the complete inputs. A plan contains warnings and `requiresConfirmation`, but confirmation remains a UI-only acknowledgement. No Apply command exists in M4.

## UI

- Bundles loads real desktop records, shows an empty state, and supports create/update/delete through an inline editor.
- Only Canonical Library records can be selected; discovered `instance:*` rows are excluded.
- Sync loads Bundles and enabled discovery roots, generates a plan explicitly, and renders real plan items.
- The execution button stays disabled with copy stating that Safe Apply belongs to M5.
- Browser preview retains mocks for visual development.

## Safety

- M4 filesystem behavior is read-only; all writes are constrained to SQLite Bundle tables.
- Name matching is used only for planning and never grants ownership.
- Any hash difference is a conflict, never an automatic update.
- The planner cannot return a destructive `remove` action.
- Existing M2/M3 import and discovery safety limits remain unchanged.

## Verification

Rust tests cover Bundle transaction persistence, validation, action classification, deterministic plan ids, and absence of filesystem mutation. Frontend tests cover record mapping. Full Rust and desktop verification remains blocked on this machine until Rust stable is available.
