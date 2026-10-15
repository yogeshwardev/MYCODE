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

/** All products, optionally filtered by category, in insertion order. */
export function listProducts({ category } = {}) {
  return [...db.products.values()].filter((p) => !category || p.category === category);
}
