import { db, nextId } from "./db.js";

export function addProduct({ name, price, stock = 0, category = "general", weightKg = 1 }) {
  if (!name) throw new Error("name is required");
  if (!(price >= 0)) throw new Error("price must be >= 0");
  const product = { id: nextId("p"), name, price, stock, category, weightKg };
  db.products.set(product.id, product);
  return product;
}

export function getProduct(id) {
  return db.products.get(id);
}

/** A page of products, optionally filtered by category, in insertion order. */
export function listProducts({ category, page = 1, pageSize = 10 } = {}) {
  if (!Number.isInteger(page) || !Number.isInteger(pageSize) || page < 1 || pageSize < 1) throw new Error("Invalid page");
  const all = [...db.products.values()].filter((p) => !category || p.category === category);
  return {
    items: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
    pages: Math.ceil(all.length / pageSize),
  };
}
