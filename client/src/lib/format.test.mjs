import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatMoneyCompact, toPaise, fromPaise, sumMoney, formatQty, formatDate, formatDateTimeIst, fyOf, daysLeftText } from "./format.ts";
import { remainingRequestsToday, capacityFraction, formatResetIst } from "./ai-usage.ts";

test("money formats with Indian grouping and two decimals, no float math", () => {
  assert.equal(formatMoney("70800.00"), "₹70,800.00");
  assert.equal(formatMoney("1234567.5"), "₹12,34,567.50");
  assert.equal(formatMoney("999"), "₹999.00");
  assert.equal(formatMoney("-15000.00"), "−₹15,000.00");
  assert.equal(formatMoney({ amount: "20000.00", currency: "INR" }), "₹20,000.00");
  assert.equal(formatMoney("100.00", "USD"), "USD 100.00");
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(undefined, "INR", "Needs evidence"), "Needs evidence");
  assert.equal(formatMoney(70800), "₹70,800.00");
  assert.equal(formatMoney("10.005"), "₹10.01");
  assert.equal(formatMoney("1,23,456.7"), "₹1,23,456.70");
  assert.equal(formatMoney({ amount: 15000 }), "₹15,000.00");
  assert.equal(formatMoney("not a number"), "—");
});

test("compact money uses lakh/crore via string slicing only", () => {
  assert.equal(formatMoneyCompact("73400000000"), "₹7340 crore");
  assert.equal(formatMoneyCompact("70800.00"), "₹70,800.00");
  assert.equal(formatMoneyCompact("1234567"), "₹12.34 lakh");
  assert.equal(formatMoneyCompact("500000"), "₹5 lakh");
});

test("qty trims trailing zeros but never invents precision", () => {
  assert.equal(formatQty("40.000"), "40");
  assert.equal(formatQty("2.500"), "2.5");
  assert.equal(formatQty("100"), "100");
  assert.equal(formatQty(null), "—");
});

test("dates render in IST and Indian fiscal year", () => {
  assert.equal(formatDate("2026-10-30"), "30 Oct 2026");
  assert.equal(formatDate("2026-10-30T20:00:00+05:30"), "30 Oct 2026");
  assert.equal(fyOf("2026-10-01"), "2026-27");
  assert.equal(fyOf("2026-03-31"), "2025-26");
  assert.equal(fyOf("2026-04-01"), "2026-27");
  assert.match(formatDateTimeIst("2026-10-30T09:04:00+00:00"), /^30 Oct 2026, /);
});

test("days-left phrasing is plain language", () => {
  assert.equal(daysLeftText(5), "5 days left");
  assert.equal(daysLeftText(1), "due tomorrow");
  assert.equal(daysLeftText(0), "due today");
  assert.equal(daysLeftText(-3), "3 days overdue");
});

test("AI usage helpers aggregate only reported numbers", () => {
  const usage = {
    mode: "llm",
    models: [
      { model: "a", task: "chat", remainingToday: 100, limitToday: 250, estimate: true },
      { model: "b", task: "extract", remainingToday: 40, limitToday: 50, estimate: true },
      { model: "c", task: "embed", remainingToday: null, limitToday: null, estimate: false },
    ],
    keys: { total: 68, active: 61, cooling: 3, exhausted: 4, invalid: 0 },
    resetsAt: "2026-10-30T07:00:00Z",
  };
  assert.equal(remainingRequestsToday(usage), 140);
  assert.equal(capacityFraction(usage).toFixed(2), "0.47");
  assert.match(formatResetIst(usage.resetsAt), /12:30\s?(pm|PM) IST/);
  assert.equal(remainingRequestsToday({ ...usage, models: [] }), null);
});

test("exact paise arithmetic never drifts", () => {
  assert.equal(sumMoney(["0.10", "0.20"]), "0.30");
  assert.equal(sumMoney(["30000.00", "20800.00", { amount: "-50800" }]), "0.00");
  assert.equal(fromPaise(toPaise("70800")), "70800.00");
  assert.equal(toPaise("-0.015"), BigInt(-2));
});
