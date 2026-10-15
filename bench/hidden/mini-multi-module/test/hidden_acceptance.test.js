import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween } from "../src/dates.js";
import { clamp, range } from "../src/math.js";
import { slugify, titleCase } from "../src/strings.js";

test("hidden: slugify", () => {
  assert.equal(slugify(" Hello, World! "), "hello-world");
  assert.equal(slugify("Already-a-slug"), "already-a-slug");
  assert.equal(slugify("a  --  b"), "a-b");
});
test("hidden: titleCase", () => assert.equal(titleCase("hELLO big wORLD"), "Hello Big World"));
test("hidden: clamp", () => {
  assert.equal(clamp(9, 0, 5), 5);
  assert.equal(clamp(-1, 0, 5), 0);
  assert.equal(clamp(3, 0, 5), 3);
});
test("hidden: range", () => {
  assert.deepEqual(range(0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(range(0, 5, 2), [0, 2, 4]);
  assert.deepEqual(range(3, 3), []);
});
test("hidden: daysBetween", () => assert.equal(daysBetween(new Date("2026-01-01"), new Date("2026-01-11")), 10));
