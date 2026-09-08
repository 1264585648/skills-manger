import assert from "node:assert/strict";
import test from "node:test";

import { mapBundleRecord, mapSyncPlanItems } from "../src/services/bundlePlannerMappers.ts";

test("bundle records preserve ordered skill ids", () => {
  const bundle = mapBundleRecord({
    id: "bundle-1",
    name: "Development",
    description: "Common tools",
    items: [
      { skillId: "skill-b", mode: "optional", position: 1 },
      { skillId: "skill-a", mode: "required", position: 0 },
    ],
    createdAt: 1,
    updatedAt: 2,
  });
  assert.deepEqual(bundle.skillIds, ["skill-a", "skill-b"]);
});

test("read-only plan maps hashes and actions for the Sync page", () => {
  const items = mapSyncPlanItems({
    id: "plan-1",
    bundleId: "bundle-1",
    rootId: "root-1",
    warnings: [],
    requiresConfirmation: true,
    items: [{
      id: "item-1",
      skillId: "skill-a",
      skillName: "skill-a",
      mode: "required",
      action: "conflict",
      currentHash: "current-hash",
      libraryHash: "library-hash",
      reason: "Unmanaged content differs",
    }],
  });
  assert.equal(items[0]?.action, "conflict");
  assert.equal(items[0]?.current, "current-hash");
  assert.equal(items[0]?.target, "library-hash");
});
