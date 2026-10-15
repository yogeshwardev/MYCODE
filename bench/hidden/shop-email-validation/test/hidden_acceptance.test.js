import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { reset } from "../src/db.js";
import { createUser, getUser } from "../src/users.js";

beforeEach(reset);

test("hidden: normalizes email", () => {
  const u = createUser({ name: "Ada", email: "  Ada@Example.COM " });
  assert.equal(getUser(u.id).email, "ada@example.com");
});

test("hidden: rejects invalid emails", () => {
  for (const email of ["", "ada", "ada@", "@example.com", "ada@example", "ada@@example.com", "a da@example.com", "ada@.com", "ada@example.", undefined]) {
    assert.throws(() => createUser({ name: "Ada", email }), { message: "Invalid email" }, String(email));
  }
});

test("hidden: rejects duplicate emails after normalizing", () => {
  createUser({ name: "Ada", email: "ada@example.com" });
  assert.throws(() => createUser({ name: "Ada 2", email: " ADA@example.com" }), { message: "Email already registered" });
  assert.doesNotThrow(() => createUser({ name: "Bob", email: "bob@example.co.uk" }));
});
