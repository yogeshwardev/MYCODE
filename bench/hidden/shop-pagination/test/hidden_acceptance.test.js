import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { reset } from "../src/db.js";
import { addProduct, listProducts } from "../src/products.js";

beforeEach(reset);

test("hidden: paginates", () => {
  for (let i = 1; i <= 25; i++) addProduct({ name: `P${i}`, price: i, category: i % 2 ? "odd" : "even" });
  const first = listProducts();
  assert.equal(first.total, 25);
  assert.equal(first.pages, 3);
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 10);
  assert.deepEqual(first.items.map((p) => p.name), ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]);
  const last = listProducts({ page: 3 });
  assert.deepEqual(last.items.map((p) => p.name), ["P21", "P22", "P23", "P24", "P25"]);
  const odd = listProducts({ category: "odd", page: 2, pageSize: 5 });
  assert.equal(odd.total, 13);
  assert.equal(odd.pages, 3);
  assert.deepEqual(odd.items.map((p) => p.name), ["P11", "P13", "P15", "P17", "P19"]);
  assert.deepEqual(listProducts({ page: 9 }).items, []);
});

test("hidden: empty and invalid", () => {
  assert.deepEqual(listProducts(), { items: [], total: 0, page: 1, pageSize: 10, pages: 0 });
  for (const opts of [{ page: 0 }, { pageSize: 0 }, { page: 1.5 }, { pageSize: "2" }]) {
    assert.throws(() => listProducts(opts), { message: "Invalid page" }, JSON.stringify(opts));
  }
});
