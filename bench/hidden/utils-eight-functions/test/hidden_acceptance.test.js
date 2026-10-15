import assert from "node:assert/strict";
import { test } from "node:test";
import { chunk, last, uniqueBy } from "../src/arrays.js";
import { mapLimit, retry, sleep } from "../src/async.js";
import { deepMerge, isPlainObject, pick } from "../src/objects.js";
import { camelCase, capitalize, truncate } from "../src/strings.js";

test("hidden: existing exports remain", () => {
  assert.equal(capitalize("a"), "A");
  assert.equal(last([1]), 1);
  assert.ok(isPlainObject({}));
  assert.equal(typeof sleep, "function");
});

test("hidden: camelCase", () => {
  assert.equal(camelCase("Foo-bar_baz qux"), "fooBarBazQux");
  assert.equal(camelCase("  multiple   SPACES here "), "multipleSpacesHere");
  assert.equal(camelCase("single"), "single");
  assert.equal(camelCase(""), "");
});

test("hidden: truncate", () => {
  assert.equal(truncate("hello", 5), "hello");
  assert.equal(truncate("hello world", 8), "hello w…");
  assert.equal(truncate("hello world", 8, "..."), "hello...");
});

test("hidden: chunk", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  for (const bad of [0, -2, 1.5]) assert.throws(() => chunk([1], bad), { message: "size must be a positive integer" });
});

test("hidden: uniqueBy", () => {
  const people = [{ id: 1, n: "a" }, { id: 2, n: "b" }, { id: 1, n: "c" }];
  assert.deepEqual(uniqueBy(people, (p) => p.id), [{ id: 1, n: "a" }, { id: 2, n: "b" }]);
});

test("hidden: deepMerge", () => {
  const a = { x: 1, nested: { a: 1, list: [1, 2] }, keep: true };
  const b = { y: 2, nested: { b: 2, list: [3] } };
  const merged = deepMerge(a, b);
  assert.deepEqual(merged, { x: 1, y: 2, keep: true, nested: { a: 1, b: 2, list: [3] } });
  assert.deepEqual(a, { x: 1, nested: { a: 1, list: [1, 2] }, keep: true });
  assert.deepEqual(b, { y: 2, nested: { b: 2, list: [3] } });
  assert.notEqual(merged.nested, a.nested);
  assert.deepEqual(deepMerge({ a: { b: 1 } }, { a: 5 }), { a: 5 });
});

test("hidden: pick", () => {
  assert.deepEqual(pick({ a: 1, b: 2, c: 3 }, ["a", "c", "z"]), { a: 1, c: 3 });
});

test("hidden: retry", async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls++;
    if (calls < 3) throw new Error(`fail ${calls}`);
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  let n = 0;
  await assert.rejects(retry(async () => { n++; throw new Error(`boom ${n}`); }, { retries: 2 }), { message: "boom 3" });
  assert.equal(n, 3);
});

test("hidden: mapLimit", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimit([5, 1, 4, 2, 3], 2, async (x, i) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, x * 5));
    active--;
    return x * 10 + i;
  });
  assert.deepEqual(result, [50, 11, 42, 23, 34]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapLimit([], 3, async (x) => x), []);
});
