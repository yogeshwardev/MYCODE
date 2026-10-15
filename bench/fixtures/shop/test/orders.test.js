import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addItem, createCart } from "../src/cart.js";
import { reset } from "../src/db.js";
import { listOrders, placeOrder } from "../src/orders.js";
import { addProduct } from "../src/products.js";
import { createUser } from "../src/users.js";

beforeEach(reset);

test("places an order", () => {
  const u = createUser({ name: "Ada", email: "ada@example.com" });
  const p = addProduct({ name: "Mug", price: 10, stock: 5 });
  const order = placeOrder(addItem(createCart(), p.id, 3), u.id);
  assert.equal(order.total, 30);
  assert.equal(listOrders(u.id).length, 1);
});
