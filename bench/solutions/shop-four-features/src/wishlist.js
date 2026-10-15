import { db } from "./db.js";
import { getProduct } from "./products.js";

export function addToWishlist(userId, productId) {
  if (!getProduct(productId)) throw new Error(`Unknown product: ${productId}`);
  const list = db.wishlists.get(userId) ?? [];
  if (!list.includes(productId)) list.push(productId);
  db.wishlists.set(userId, list);
}

export function removeFromWishlist(userId, productId) {
  const list = db.wishlists.get(userId);
  if (list) db.wishlists.set(userId, list.filter((id) => id !== productId));
}

export function getWishlist(userId) {
  return (db.wishlists.get(userId) ?? []).map(getProduct).filter(Boolean);
}
