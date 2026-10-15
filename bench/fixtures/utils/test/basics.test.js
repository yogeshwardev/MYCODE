import assert from "node:assert/strict";
import { test } from "node:test";
import { last } from "../src/arrays.js";
import { isPlainObject } from "../src/objects.js";
import { capitalize } from "../src/strings.js";

test("basics", () => {
  assert.equal(capitalize("hi"), "Hi");
  assert.equal(last([1, 2]), 2);
  assert.ok(isPlainObject({}));
  assert.ok(!isPlainObject([]));
});
