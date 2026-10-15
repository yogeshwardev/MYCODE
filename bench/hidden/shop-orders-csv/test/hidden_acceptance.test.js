import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addItem, createCart } from "../src/cart.js";
import { reset } from "../src/db.js";
import { exportOrdersCsv } from "../src/export.js";
import { getOrder, placeOrder } from "../src/orders.js";
import { addProduct } from "../src/products.js";
import { createUser } from "../src/users.js";

beforeEach(reset);
const now = new Date("2026-05-01T10:00:00.000Z");

test("hidden: exports orders as CSV", () => {
  const a = createUser({ name: "Ada", email: "ada@example.com" });
  const b = createUser({ name: "Bob", email: "bob@example.com" });
  const mug = addProduct({ name: "Mug", price: 10 });
  const pen = addProduct({ name: "Pen", price: 2 });
  const o1 = placeOrder(addItem(addItem(createCart(), mug.id, 2), pen.id, 1), a.id, { now });
  const o2 = placeOrder(addItem(createCart(), pen.id, 3), b.id, { now });
  assert.equal(
    exportOrdersCsv(),
    [
      "id,userId,status,total,items,createdAt",
      `${o1.id},${a.id},placed,22,${mug.id} x 2; ${pen.id} x 1,2026-05-01T10:00:00.000Z`,
      `${o2.id},${b.id},placed,6,${pen.id} x 3,2026-05-01T10:00:00.000Z`,
    ].join("\n"),
  );
  assert.equal(exportOrdersCsv({ userId: b.id }).split("\n").length, 2);
});

test("hidden: quotes special characters", () => {
  const a = createUser({ name: "Ada", email: "ada@example.com" });
  const mug = addProduct({ name: "Mug", price: 10 });
  const o = placeOrder(addItem(createCart(), mug.id, 1), a.id, { now });
  getOrder(o.id).status = 'held, "manual"';
  assert.equal(exportOrdersCsv().split("\n")[1], `${o.id},${a.id},"held, ""manual""",10,${mug.id} x 1,2026-05-01T10:00:00.000Z`);
});

test("hidden: empty export is just the header", () => assert.equal(exportOrdersCsv(), "id,userId,status,total,items,createdAt"));
