import assert from "node:assert/strict";
import test from "node:test";

import { formatTimestamp } from "../src/services/formatTimestamp.ts";

test("formatTimestamp includes local time down to seconds", () => {
  const value = new Date(2026, 8, 6, 20, 23, 31);

  assert.equal(
    formatTimestamp(Math.floor(value.getTime() / 1000)),
    "2026/09/06 20:23:31",
  );
});

test("formatTimestamp shows a placeholder for a missing timestamp", () => {
  assert.equal(formatTimestamp(0), "—");
});
