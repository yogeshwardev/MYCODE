import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import * as cart from "../src/cart.js";
import { reset } from "../src/db.js";
import { placeOrder } from "../src/orders.js";
import { addProduct } from "../src/products.js";
import { createUser } from "../src/users.js";

beforeEach(reset);
const total = cart.calcTotal ?? cart.cartTotal;

test("hidden: totals keep cents", () => {
  const p = addProduct({ name: "Book", price: 19.99 });
  assert.equal(total(cart.addItem(cart.createCart(), p.id, 2)), 39.98);
});

test("hidden: discount keeps cents", () => {
  const p = addProduct({ name: "Lamp", price: 101.1 });
  assert.equal(total(cart.addItem(cart.createCart(), p.id, 1)), 90.99);
  const q = addProduct({ name: "Chair", price: 50 });
  assert.equal(total(cart.addItem(cart.createCart(), q.id, 2)), 90);
});

test("hidden: orders use the corrected total", () => {
  const u = createUser({ name: "Ada", email: "ada@example.com" });
  const p = addProduct({ name: "Book", price: 19.99 });
  assert.equal(placeOrder(cart.addItem(cart.createCart(), p.id, 2), u.id).total, 39.98);
});
