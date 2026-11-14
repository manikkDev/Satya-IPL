import { test } from "node:test";
import assert from "node:assert/strict";
import { toPaise, toDecimal, add, sub, cmp, mulRate, grandOf, taxOf, allocatedOf, sum } from "../src/lib/money.js";
import { fyOf, isRealDate, istDate, daysBetween } from "../src/lib/fy.js";
import { makeOriginChecker } from "../src/lib/origins.js";

test("money parses every historical shape exactly", () => {
  assert.equal(toPaise("118000.00"), 11800000n);
  assert.equal(toPaise({ amount: "118000.5", currency: "INR" }), 11800050n);
  assert.equal(toPaise(118000.1), 11800010n);
  assert.equal(toPaise("₹1,18,000.00"), 11800000n);
  assert.equal(toPaise(null), 0n);
  assert.equal(toPaise("abc"), 0n);
  assert.equal(toDecimal("0.105"), "0.11"); // half-up
  assert.equal(add("0.10", "0.20"), "0.30");
  assert.equal(sub({ amount: "100" }, 33.33), "66.67");
  assert.equal(cmp("10.00", { amount: "10" }), 0);
  assert.equal(mulRate("5000", "10"), "50000.00");
  assert.equal(mulRate("6000000", "0.001"), "6000.00");
  assert.equal(sum([{ amount: "1.10" }, { amount: 2.2 }], (a) => a.amount), "3.30");
});

test("grandOf / taxOf / allocatedOf handle mixed shapes", () => {
  assert.equal(grandOf({ totals: { grand: { amount: "59000.00" } } }), "59000.00");
  assert.equal(grandOf({ totals: { grand: "0" }, lines: [{ qty: "10", rate: "5000" }], charges: [{ amount: "250" }] }), "50250.00");
  assert.equal(taxOf({ totals: { cgst: "4500", sgst: { amount: "4500" } } }), "9000.00");
  assert.equal(allocatedOf({ payment: { allocations: [{ amount: "100.10" }, { amount: 50 }] } }), "150.10");
});

test("fy uses IST and rejects impossible dates", () => {
  assert.equal(fyOf("2026-10-29"), "2026-27");
  assert.equal(fyOf("2027-03-31"), "2026-27");
  assert.equal(fyOf("2027-04-01"), "2027-28");
  assert.equal(fyOf(new Date("2027-03-31T20:00:00Z")), "2027-28"); // 01:30 IST on 1 Apr
  assert.equal(istDate(new Date("2026-10-29T19:00:00Z")), "2026-10-30");
  assert.equal(isRealDate("2026-02-30"), false);
  assert.equal(isRealDate("2028-02-29"), true);
  assert.equal(daysBetween("2026-01-01", "2026-02-15"), 45);
});

test("CORS origin checker: exact list + safe preview wildcard", () => {
  const ok = makeOriginChecker("https://satya-ipl.vercel.app,https://satya-ipl-*.vercel.app,http://localhost:3000");
  assert.equal(ok("https://satya-ipl.vercel.app"), true);
  assert.equal(ok("https://satya-ipl-git-main-team.vercel.app"), true);
  assert.equal(ok("http://localhost:3000"), true);
  assert.equal(ok(undefined), true);
  assert.equal(ok("https://satya-ipl-x.vercel.app.evil.com"), false);
  assert.equal(ok("https://evil.satya-ipl-x.vercel.app"), false);
  assert.equal(ok("http://satya-ipl-x.vercel.app"), false);
  assert.equal(ok("https://satya-iplx.vercel.app"), false);
  assert.equal(ok("https://other.vercel.app"), false);
  // unsafe patterns are ignored entirely
  const bad = makeOriginChecker("https://*.app,https://*");
  assert.equal(bad("https://evil.app"), false);
});
