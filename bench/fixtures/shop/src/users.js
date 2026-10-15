import { db, nextId } from "./db.js";

export function createUser({ name, email }) {
  if (!name) throw new Error("name is required");
  const user = { id: nextId("u"), name, email };
  db.users.set(user.id, user);
  return user;
}

export function getUser(id) {
  return db.users.get(id);
}
