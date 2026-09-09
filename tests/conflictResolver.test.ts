import assert from "node:assert/strict";
import test from "node:test";

import { baseName, classifyConflict, joinDestinationPath } from "../src/services/conflictRules.ts";

test("conflict reasons map to actionable categories", () => {
  assert.equal(
    classifyConflict("Target Drift differs from the last deployed hash"),
    "target_drift",
  );
  assert.equal(
    classifyConflict(
      "Unmanaged Agent content differs; ownership must be resolved before any write",
    ),
    "unmanaged",
  );
  assert.equal(
    classifyConflict("Deployment destination does not match the registered root"),
    "destination_mismatch",
  );
  assert.equal(
    classifyConflict("Unmanaged destination cannot be verified: missing SKILL.md"),
    "unverifiable",
  );
  assert.equal(
    classifyConflict("Owned Agent instance cannot be verified: permission denied"),
    "unverifiable",
  );
});

test("destination paths follow the separator used by the root", () => {
  assert.equal(
    joinDestinationPath("C:/repo/.claude/skills", "review"),
    "C:/repo/.claude/skills/review",
  );
  assert.equal(
    joinDestinationPath("C:\\repo\\.claude\\skills\\", "review"),
    "C:\\repo\\.claude\\skills\\review",
  );
  assert.equal(joinDestinationPath("/home/u/.claude/skills/", "review"), "/home/u/.claude/skills/review");
});

test("deployment rows fall back to the raw path when it has no separator", () => {
  assert.equal(baseName("C:\\repo\\.claude\\skills\\review"), "review");
  assert.equal(baseName("/home/u/.claude/skills/review"), "review");
  assert.equal(baseName("review"), "review");
});
