import { calcTotal } from "./cart.js";
import { db, nextId } from "./db.js";
import { getProduct } from "./products.js";
import { getUser } from "./users.js";

/** Places an order for the cart. `now` can be passed for deterministic timestamps. */
export function placeOrder(cart, userId, { now = new Date() } = {}) {
  if (!getUser(userId)) throw new Error(`Unknown user: ${userId}`);
  if (!cart.items.length) throw new Error("Cart is empty");
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

export function getOrder(id) {
  return db.orders.get(id);
}

export function listOrders(userId) {
  return [...db.orders.values()].filter((o) => !userId || o.userId === userId);
}
