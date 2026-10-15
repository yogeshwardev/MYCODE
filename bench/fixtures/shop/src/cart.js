import { getProduct } from "./products.js";

export function createCart() {
  return { items: [] };
}

export function addItem(cart, productId, qty = 1) {
  if (!getProduct(productId)) throw new Error(`Unknown product: ${productId}`);
  const existing = cart.items.find((i) => i.productId === productId);
  if (existing) existing.qty += qty;
  else cart.items.push({ productId, qty });
  return cart;
}

export function removeItem(cart, productId) {
  cart.items = cart.items.filter((i) => i.productId !== productId);
  return cart;
}

/** Cart total in dollars. Orders of $100 or more get 10% off. */
export function calcTotal(cart) {
  const subtotal = cart.items.reduce((sum, i) => sum + getProduct(i.productId).price * i.qty, 0);
  const total = subtotal >= 100 ? subtotal * 0.9 : subtotal;
  return Math.round(total);
}
