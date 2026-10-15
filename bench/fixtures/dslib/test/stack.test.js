import assert from "node:assert/strict";
import { test } from "node:test";
import { Stack } from "../src/index.js";

test("stack is LIFO", () => {
  const s = new Stack().push(1).push(2);
  assert.equal(s.pop(), 2);
  assert.equal(s.size, 1);
});
