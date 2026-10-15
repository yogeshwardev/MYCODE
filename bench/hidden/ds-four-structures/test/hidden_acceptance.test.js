import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter, LRUCache, PriorityQueue, Stack, Trie } from "../src/index.js";

test("hidden: stack still exported", () => assert.equal(new Stack().push(1).peek(), 1));

test("hidden: LRUCache", () => {
  const c = new LRUCache(2);
  c.set("a", 1).set("b", 2);
  assert.equal(c.get("a"), 1); // a is now most recent
  c.set("c", 3); // evicts b
  assert.equal(c.has("b"), false);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.size, 2);
  c.has("a"); // does not change recency
  c.set("c", 30); // c most recent, a is least recent
  c.set("d", 4); // evicts a
  assert.equal(c.has("a"), false);
  assert.equal(c.get("c"), 30);
  assert.equal(c.delete("c"), true);
  assert.equal(c.delete("c"), false);
  assert.equal(c.size, 1);
  for (const bad of [0, -1, 1.5, "2"]) assert.throws(() => new LRUCache(bad), { message: "capacity must be a positive integer" });
});

test("hidden: PriorityQueue", () => {
  const q = new PriorityQueue();
  assert.equal(q.pop(), undefined);
  for (const n of [5, 1, 8, 3, 9, 2, 7]) q.push(n);
  assert.equal(q.size, 7);
  assert.equal(q.peek(), 1);
  const out = [];
  while (q.size) out.push(q.pop());
  assert.deepEqual(out, [1, 2, 3, 5, 7, 8, 9]);
  const maxQ = new PriorityQueue((a, b) => b.p - a.p).push({ p: 1 }).push({ p: 10 }).push({ p: 5 });
  assert.deepEqual([maxQ.pop().p, maxQ.pop().p, maxQ.pop().p], [10, 5, 1]);
});

test("hidden: Trie", () => {
  const t = new Trie();
  for (const w of ["car", "card", "care", "cat", "dog", "car"]) t.insert(w);
  assert.equal(t.size, 5);
  assert.equal(t.has("car"), true);
  assert.equal(t.has("ca"), false);
  assert.deepEqual(t.startsWith("car"), ["car", "card", "care"]);
  assert.deepEqual(t.startsWith("x"), []);
  assert.equal(t.delete("car"), true);
  assert.equal(t.delete("car"), false);
  assert.equal(t.has("card"), true);
  assert.deepEqual(t.startsWith("ca"), ["card", "care", "cat"]);
  assert.equal(t.size, 4);
});

test("hidden: EventEmitter", () => {
  const e = new EventEmitter();
  const calls = [];
  const a = (x) => calls.push(`a${x}`);
  const b = (x) => calls.push(`b${x}`);
  assert.equal(e.emit("x", 0), false);
  assert.equal(e.on("x", a).once("x", b), e);
  assert.equal(e.emit("x", 1), true);
  assert.equal(e.emit("x", 2), true);
  e.off("x", a);
  assert.equal(e.emit("x", 3), false);
  assert.deepEqual(calls, ["a1", "b1", "a2"]);
});
