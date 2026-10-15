import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween } from "../src/dates.js";

test("daysBetween", () => assert.equal(daysBetween(new Date("2026-01-01"), new Date("2026-01-11")), 10));
