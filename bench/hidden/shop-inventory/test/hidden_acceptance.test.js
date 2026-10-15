import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addItem, createCart } from "../src/cart.js";
import { reset } from "../src/db.js";
import { cancelOrder, getOrder, listOrders, placeOrder } from "../src/orders.js";
import { addProduct, getProduct } from "../src/products.js";
import { createUser } from "../src/users.js";

beforeEach(reset);

test("hidden: decrements stock", () => {
  const u = createUser({ name: "Ada", email: "ada@example.com" });
  const p = addProduct({ name: "Mug", price: 10, stock: 5 });
  placeOrder(addItem(createCart(), p.id, 3), u.id);
  assert.equal(getProduct(p.id).stock, 2);
});

test("hidden: insufficient stock changes nothing", () => {
  const u = createUser({ name: "Ada", email: "ada@example.com" });
  const a = addProduct({ name: "Mug", price: 10, stock: 5 });
  const b = addProduct({ name: "Pen", price: 2, stock: 1 });
  const cart = addItem(addItem(createCart(), a.id, 2), b.id, 2);
  assert.throws(() => placeOrder(cart, u.id), { message: `Insufficient stock for ${b.id}` });
  assert.equal(getProduct(a.id).stock, 5);
  assert.equal(getProduct(b.id).stock, 1);
  assert.equal(listOrders().length, 0);
});

test("hidden: cancel restores stock", () => {
  const u = createUser({ name: "Ada", email: "ada@example.com" });
  const p = addProduct({ name: "Mug", price: 10, stock: 5 });
  const o = placeOrder(addItem(createCart(), p.id, 4), u.id);
  const cancelled = cancelOrder(o.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(getOrder(o.id).status, "cancelled");
  assert.equal(getProduct(p.id).stock, 5);
  assert.throws(() => cancelOrder(o.id), { message: "Order already cancelled" });
  assert.equal(getProduct(p.id).stock, 5);
  assert.throws(() => cancelOrder("o999"), { message: "Unknown order: o999" });
});
