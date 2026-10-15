// The in-memory database shared by every module.
export const db = {
  products: new Map(),
  users: new Map(),
  orders: new Map(),
  coupons: new Map(),
  reviews: [],
  wishlists: new Map(),
  seq: 0,
};

/** Clears all data. Tests call this before each case. */
export function reset() {
  db.products.clear();
  db.users.clear();
  db.orders.clear();
  db.coupons.clear();
  db.reviews.length = 0;
  db.wishlists.clear();
  db.seq = 0;
}

/** Returns a new unique id such as "p1", "u2", "o3". */
export function nextId(prefix) {
  db.seq += 1;
  return `${prefix}${db.seq}`;
}
