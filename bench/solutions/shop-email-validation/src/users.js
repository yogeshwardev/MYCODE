import { db, nextId } from "./db.js";

const EMAIL = /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@]*[^\s@.]$/;

export function createUser({ name, email }) {
  if (!name) throw new Error("name is required");
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!EMAIL.test(normalized)) throw new Error("Invalid email");
  for (const u of db.users.values()) if (u.email === normalized) throw new Error("Email already registered");
  const user = { id: nextId("u"), name, email: normalized };
  db.users.set(user.id, user);
  return user;
}

export function getUser(id) {
  return db.users.get(id);
}
