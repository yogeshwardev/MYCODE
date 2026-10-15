import { listOrders } from "../orders.js";
import { getUser } from "../users.js";

const cents = (n) => Math.round(n * 100) / 100;

export function customerLifetimeValue(userId) {
  if (!getUser(userId)) throw new Error(`Unknown user: ${userId}`);
  const orders = listOrders(userId).filter((o) => o.status !== "cancelled");
  const total = cents(orders.reduce((s, o) => s + o.total, 0));
  return { userId, orders: orders.length, total, averageOrder: orders.length ? cents(total / orders.length) : 0 };
}
