import { listOrders } from "./orders.js";

function field(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportOrdersCsv({ userId } = {}) {
  const rows = [["id", "userId", "status", "total", "items", "createdAt"]];
  for (const o of listOrders(userId)) {
    rows.push([o.id, o.userId, o.status, o.total, o.items.map((i) => `${i.productId} x ${i.qty}`).join("; "), o.createdAt]);
  }
  return rows.map((r) => r.map(field).join(",")).join("\n");
}
