import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, test } from "node:test";
import * as cart from "../src/cart.js";
import { reset } from "../src/db.js";
import { placeOrder } from "../src/orders.js";
import { addProduct } from "../src/products.js";
import { createUser } from "../src/users.js";

beforeEach(reset);

test("hidden: cartTotal replaces calcTotal", () => {
  assert.equal(typeof cart.cartTotal, "function");
  assert.equal(cart.calcTotal, undefined);
  const p = addProduct({ name: "Mug", price: 10 });
  assert.equal(cart.cartTotal(cart.addItem(cart.createCart(), p.id, 2)), 20);
});

test("hidden: orders still total correctly", () => {
  const u = createUser({ name: "Ada", email: "ada@example.com" });
  const p = addProduct({ name: "Mug", price: 10 });
  assert.equal(placeOrder(cart.addItem(cart.createCart(), p.id, 3), u.id).total, 30);
});

test("hidden: no references to calcTotal remain", () => {
  for (const dir of ["src", "test"]) {
    for (const f of fs.readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (f.startsWith("hidden_")) continue;
      const text = fs.readFileSync(new URL(`../${dir}/${f}`, import.meta.url), "utf8");
      assert.ok(!text.includes("calcTotal"), `${dir}/${f} still mentions calcTotal`);
    }
  }
});
