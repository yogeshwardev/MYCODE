import { listOrders } from "../orders.js";

const cents = (n) => Math.round(n * 100) / 100;

export function salesByDay({ from, to } = {}) {
  const days = new Map();
  for (const o of listOrders()) {
    if (o.status === "cancelled") continue;
    const date = o.createdAt.slice(0, 10);
    if ((from && date < from) || (to && date > to)) continue;
    const d = days.get(date) ?? { date, orders: 0, revenue: 0 };
    d.orders += 1;
    d.revenue += o.total;
    days.set(date, d);
  }
  return [...days.values()].map((d) => ({ ...d, revenue: cents(d.revenue) })).sort((a, b) => a.date.localeCompare(b.date));
}
