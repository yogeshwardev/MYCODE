import { db } from "./db.js";
import { getProduct } from "./products.js";

export function addReview({ productId, userId, rating, text = "" }) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Invalid rating");
  if (!getProduct(productId)) throw new Error(`Unknown product: ${productId}`);
  if (db.reviews.some((r) => r.productId === productId && r.userId === userId)) throw new Error("Already reviewed");
  const review = { productId, userId, rating, text };
  db.reviews.push(review);
  return review;
}

export function listReviews(productId) {
  return db.reviews.filter((r) => r.productId === productId);
}

export function averageRating(productId) {
  const reviews = listReviews(productId);
  if (!reviews.length) return null;
  return Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
}
