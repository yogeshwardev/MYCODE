import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { reset } from "../src/db.js";
import { addProduct, getProduct, listProducts } from "../src/products.js";

beforeEach(reset);

test("adds and gets a product", () => {
  const p = addProduct({ name: "Pen", price: 2 });
  assert.equal(getProduct(p.id).name, "Pen");
});

test("filters products by category", () => {
  addProduct({ name: "Novel", price: 10, category: "books" });
  addProduct({ name: "Pen", price: 2 });
  assert.equal(listProducts({ category: "books" }).total, 1);
  assert.equal(listProducts().total, 2);
});
