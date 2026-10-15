import { db } from "./db.js";

export function createCoupon({ code, percentOff, expiresAt }) {
  const key = String(code).toUpperCase();
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) throw new Error("Invalid percentOff");
  if (db.coupons.has(key)) throw new Error("Coupon exists");
  const coupon = { code: key, percentOff, expiresAt };
  db.coupons.set(key, coupon);
  return coupon;
}

export function applyCoupon(total, code, { now = new Date() } = {}) {
  const coupon = db.coupons.get(String(code).toUpperCase());
  if (!coupon) throw new Error("Unknown coupon");
  if (coupon.expiresAt && now > coupon.expiresAt) throw new Error("Coupon expired");
  return Math.round(total * (100 - coupon.percentOff)) / 100;
}
