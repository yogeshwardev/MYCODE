import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween } from "../src/dates.js";

test("hidden: daysBetween", () => {
  assert.equal(daysBetween(new Date("2026-01-01"), new Date("2026-01-11")), 10);
  assert.equal(daysBetween(new Date("2026-03-01"), new Date("2026-03-01")), 0);
  assert.equal(daysBetween(new Date("2026-01-01"), new Date("2027-01-01")), 365);
});
