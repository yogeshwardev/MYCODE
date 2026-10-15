import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addItem, cartTotal, createCart, removeItem } from "../src/cart.js";
import { reset } from "../src/db.js";
import { addProduct } from "../src/products.js";

beforeEach(reset);

test("totals a cart", () => {
  const p = addProduct({ name: "Mug", price: 10 });
  const cart = addItem(createCart(), p.id, 2);
  assert.equal(cartTotal(cart), 20);
});

test("removes items", () => {
  const p = addProduct({ name: "Mug", price: 10 });
  const cart = removeItem(addItem(createCart(), p.id), p.id);
  assert.equal(cart.items.length, 0);
});
