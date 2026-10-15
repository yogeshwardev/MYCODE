import { listOrders } from "../orders.js";
import { getProduct } from "../products.js";

export function topProducts(n = 5) {
  const stats = new Map();
  for (const o of listOrders()) {
    if (o.status === "cancelled") continue;
    for (const i of o.items) {
      const s = stats.get(i.productId) ?? { productId: i.productId, name: getProduct(i.productId)?.name, quantity: 0, revenue: 0 };
      s.quantity += i.qty;
      s.revenue += i.price * i.qty;
      stats.set(i.productId, s);
    }
  }
  return [...stats.values()]
    .map((s) => ({ ...s, revenue: Math.round(s.revenue * 100) / 100 }))
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.productId.localeCompare(b.productId))
    .slice(0, n);
}
