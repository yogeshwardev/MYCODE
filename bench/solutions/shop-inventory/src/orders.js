import { calcTotal } from "./cart.js";
import { db, nextId } from "./db.js";
import { getProduct } from "./products.js";
import { getUser } from "./users.js";

/** Places an order for the cart. `now` can be passed for deterministic timestamps. */
export function placeOrder(cart, userId, { now = new Date() } = {}) {
  if (!getUser(userId)) throw new Error(`Unknown user: ${userId}`);
  if (!cart.items.length) throw new Error("Cart is empty");
  for (const i of cart.items) {
    if (i.qty > getProduct(i.productId).stock) throw new Error(`Insufficient stock for ${i.productId}`);
  }
  for (const i of cart.items) getProduct(i.productId).stock -= i.qty;
  const order = {
    id: nextId("o"),
    userId,
    items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty, price: getProduct(i.productId).price })),
    total: calcTotal(cart),
    status: "placed",
    createdAt: now.toISOString(),
  };
  db.orders.set(order.id, order);
  return order;
}

export function cancelOrder(orderId) {
  const order = db.orders.get(orderId);
  if (!order) throw new Error(`Unknown order: ${orderId}`);
  if (order.status === "cancelled") throw new Error("Order already cancelled");
  for (const i of order.items) {
    const p = getProduct(i.productId);
    if (p) p.stock += i.qty;
  }
  order.status = "cancelled";
  return order;
}

export function getOrder(id) {
  return db.orders.get(id);
}

export function listOrders(userId) {
  return [...db.orders.values()].filter((o) => !userId || o.userId === userId);
}
