import assert from "node:assert/strict";
import test from "node:test";

import { fuzzyScore } from "../src/services/fuzzyMatch.ts";

test("empty query matches everything with a neutral score", () => {
  assert.equal(fuzzyScore("", "anything"), 0);
});

test("subsequence matches are case insensitive", () => {
  assert.ok(fuzzyScore("rev", "code-review") !== null);
  assert.ok(fuzzyScore("CR", "code-review") !== null);
});

test("missing characters do not match", () => {
  assert.equal(fuzzyScore("xyz", "code-review"), null);
});

test("contiguous hits outrank scattered hits", () => {
  const contiguous = fuzzyScore("syn", "sync 环境更新") ?? 0;
  const scattered = fuzzyScore("syn", "settings 更新策略") ?? 0;
  assert.ok(contiguous > scattered, `期望连续命中得分更高：${contiguous} vs ${scattered}`);
});

test("prefix matches outrank mid-string matches", () => {
  const prefix = fuzzyScore("skill", "skill-a") ?? 0;
  const midway = fuzzyScore("skill", "my-skill-b") ?? 0;
  assert.ok(prefix > midway, `期望前缀命中得分更高：${prefix} vs ${midway}`);
});
