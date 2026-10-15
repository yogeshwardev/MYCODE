import { getProduct } from "./products.js";

const RATES = { domestic: [5, 1], international: [15, 4] };

export function shippingCost(items, zone) {
  const rate = RATES[zone];
  if (!rate) throw new Error("Unknown zone");
  if (!items.length) return 0;
  const weight = items.reduce((sum, i) => sum + getProduct(i.productId).weightKg * i.qty, 0);
  return rate[0] + rate[1] * Math.ceil(weight);
}
