import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { applyCoupon, createCoupon } from "../src/coupons.js";
import { reset } from "../src/db.js";
import { addProduct } from "../src/products.js";
import { addReview, averageRating, listReviews } from "../src/reviews.js";
import { shippingCost } from "../src/shipping.js";
import { createUser } from "../src/users.js";
import { addToWishlist, getWishlist, removeFromWishlist } from "../src/wishlist.js";

beforeEach(reset);

test("hidden: coupons", () => {
  createCoupon({ code: "save10", percentOff: 10 });
  assert.equal(applyCoupon(59.99, "SAVE10"), 53.99);
  assert.equal(applyCoupon(100, "Save10"), 90);
  assert.throws(() => createCoupon({ code: "SAVE10", percentOff: 5 }), { message: "Coupon exists" });
  assert.throws(() => createCoupon({ code: "X", percentOff: 0 }), { message: "Invalid percentOff" });
  assert.throws(() => createCoupon({ code: "Y", percentOff: 101 }), { message: "Invalid percentOff" });
  assert.throws(() => createCoupon({ code: "Z", percentOff: 2.5 }), { message: "Invalid percentOff" });
  assert.throws(() => applyCoupon(10, "NOPE"), { message: "Unknown coupon" });
  createCoupon({ code: "old", percentOff: 50, expiresAt: new Date("2026-01-01T00:00:00Z") });
  assert.equal(applyCoupon(10, "OLD", { now: new Date("2025-12-31T00:00:00Z") }), 5);
  assert.throws(() => applyCoupon(10, "OLD", { now: new Date("2026-02-01T00:00:00Z") }), { message: "Coupon expired" });
});

test("hidden: coupons are cleared by reset", () => {
  createCoupon({ code: "ONCE", percentOff: 10 });
  reset();
  assert.doesNotThrow(() => createCoupon({ code: "ONCE", percentOff: 10 }));
});

test("hidden: reviews", () => {
  const p = addProduct({ name: "Mug", price: 10 });
  const a = createUser({ name: "Ada", email: "ada@example.com" });
  const b = createUser({ name: "Bob", email: "bob@example.com" });
  const c = createUser({ name: "Cy", email: "cy@example.com" });
  assert.equal(averageRating(p.id), null);
  const r = addReview({ productId: p.id, userId: a.id, rating: 5, text: "great" });
  assert.equal(r.rating, 5);
  addReview({ productId: p.id, userId: b.id, rating: 4 });
  addReview({ productId: p.id, userId: c.id, rating: 4 });
  assert.equal(averageRating(p.id), 4.3);
  assert.deepEqual(listReviews(p.id).map((x) => x.userId), [a.id, b.id, c.id]);
  assert.throws(() => addReview({ productId: p.id, userId: a.id, rating: 3 }), { message: "Already reviewed" });
  for (const rating of [0, 6, 3.5, "4"]) {
    assert.throws(() => addReview({ productId: p.id, userId: "u99", rating }), { message: "Invalid rating" });
  }
  assert.throws(() => addReview({ productId: "p404", userId: a.id, rating: 3 }), { message: "Unknown product: p404" });
});

test("hidden: wishlist", () => {
  const a = addProduct({ name: "Mug", price: 10 });
  const b = addProduct({ name: "Pen", price: 2 });
  assert.deepEqual(getWishlist("u1"), []);
  addToWishlist("u1", b.id);
  addToWishlist("u1", a.id);
  addToWishlist("u1", b.id);
  assert.deepEqual(getWishlist("u1").map((p) => p.name), ["Pen", "Mug"]);
  removeFromWishlist("u1", b.id);
  assert.deepEqual(getWishlist("u1").map((p) => p.name), ["Mug"]);
  assert.deepEqual(getWishlist("u2"), []);
  assert.throws(() => addToWishlist("u1", "p404"), { message: "Unknown product: p404" });
});

test("hidden: shipping", () => {
  const light = addProduct({ name: "Card", price: 1, weightKg: 0.2 });
  const heavy = addProduct({ name: "Desk", price: 200, weightKg: 12.5 });
  assert.equal(shippingCost([], "domestic"), 0);
  assert.equal(shippingCost([{ productId: light.id, qty: 3 }], "domestic"), 6);
  assert.equal(shippingCost([{ productId: heavy.id, qty: 1 }, { productId: light.id, qty: 1 }], "domestic"), 18);
  assert.equal(shippingCost([{ productId: heavy.id, qty: 2 }], "international"), 15 + 4 * 25);
  assert.throws(() => shippingCost([{ productId: light.id, qty: 1 }], "mars"), { message: "Unknown zone" });
});
