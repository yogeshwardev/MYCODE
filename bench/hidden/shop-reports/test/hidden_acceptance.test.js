import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addItem, createCart } from "../src/cart.js";
import { reset } from "../src/db.js";
import { getOrder, placeOrder } from "../src/orders.js";
import { addProduct } from "../src/products.js";
import { customerLifetimeValue, salesByDay, topProducts } from "../src/reports/index.js";
import { createUser } from "../src/users.js";

beforeEach(reset);

function seed() {
  const ada = createUser({ name: "Ada", email: "ada@example.com" });
  const bob = createUser({ name: "Bob", email: "bob@example.com" });
  const mug = addProduct({ name: "Mug", price: 10.5 });
  const pen = addProduct({ name: "Pen", price: 2 });
  const lamp = addProduct({ name: "Lamp", price: 40 });
  const at = (s) => ({ now: new Date(s) });
  const o1 = placeOrder(addItem(addItem(createCart(), mug.id, 2), pen.id, 3), ada.id, at("2026-03-01T09:00:00Z")); // 27
  const o2 = placeOrder(addItem(createCart(), lamp.id, 1), bob.id, at("2026-03-01T23:30:00Z")); // 40
  const o3 = placeOrder(addItem(createCart(), pen.id, 5), ada.id, at("2026-03-03T12:00:00Z")); // 10
  const o4 = placeOrder(addItem(createCart(), lamp.id, 1), bob.id, at("2026-03-02T08:00:00Z")); // 40, cancelled
  getOrder(o4.id).status = "cancelled";
  return { ada, bob, mug, pen, lamp, o1, o2, o3 };
}

test("hidden: salesByDay", () => {
  seed();
  assert.deepEqual(salesByDay(), [
    { date: "2026-03-01", orders: 2, revenue: 67 },
    { date: "2026-03-03", orders: 1, revenue: 10 },
  ]);
  assert.deepEqual(salesByDay({ from: "2026-03-02", to: "2026-03-03" }), [{ date: "2026-03-03", orders: 1, revenue: 10 }]);
  assert.deepEqual(salesByDay({ to: "2026-02-28" }), []);
});

test("hidden: topProducts", () => {
  const { mug, pen, lamp } = seed();
  assert.deepEqual(topProducts(), [
    { productId: pen.id, name: "Pen", quantity: 8, revenue: 16 },
    { productId: mug.id, name: "Mug", quantity: 2, revenue: 21 },
    { productId: lamp.id, name: "Lamp", quantity: 1, revenue: 40 },
  ]);
  assert.equal(topProducts(1).length, 1);
});

test("hidden: customerLifetimeValue", () => {
  const { ada, bob } = seed();
  assert.deepEqual(customerLifetimeValue(ada.id), { userId: ada.id, orders: 2, total: 37, averageOrder: 18.5 });
  assert.deepEqual(customerLifetimeValue(bob.id), { userId: bob.id, orders: 1, total: 40, averageOrder: 40 });
  const cy = createUser({ name: "Cy", email: "cy@example.com" });
  assert.deepEqual(customerLifetimeValue(cy.id), { userId: cy.id, orders: 0, total: 0, averageOrder: 0 });
  assert.throws(() => customerLifetimeValue("u999"), { message: "Unknown user: u999" });
});
