// Pure unit tests (no DB) for paise money helpers and the curated dataset build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toPaise, fmt, lineAmount, percentOf, lineTax, halfRate, splitProRata, sum } from "../src/seed/money.js";
import { buildDataset, priceLines } from "../src/seed/build.js";
import { validateDataset } from "../src/seed/validate.js";

test("toPaise/fmt round-trip without floats", () => {
  assert.equal(toPaise("1234.5"), 123450n);
  assert.equal(toPaise("0.07"), 7n);
  assert.equal(toPaise("-15000"), -1500000n);
  assert.equal(fmt(123450n), "1234.50");
  assert.equal(fmt(-7n), "-0.07");
  assert.throws(() => toPaise("1.005"), /sub-paisa/);
  assert.throws(() => toPaise("1e3"), /Not a decimal/);
  assert.equal(fmt(sum(["0.10", "0.20"])), "0.30"); // the float classic
});

test("line amounts and percentages round half-up at the paisa", () => {
  assert.equal(fmt(lineAmount("60", "1000")), "60000.00");
  assert.equal(fmt(lineAmount("2.5", "33.33")), "83.33"); // 83.325 -> 83.33
  assert.equal(fmt(percentOf(toPaise("147750"), "2.5")), "3693.75");
  assert.equal(fmt(percentOf(toPaise("0.05"), "9")), "0.00"); // 0.0045 -> 0.00
  assert.equal(fmt(percentOf(toPaise("0.06"), "9")), "0.01"); // 0.0054 -> 0.01
  assert.equal(halfRate("18"), "9");
  assert.equal(halfRate("5"), "2.5");
});

test("intra-state CGST+SGST always equals the tax total; inter-state is IGST only", () => {
  for (const taxable of ["63531.20", "0.05", "155137.50", "999.99"]) {
    const t = lineTax(toPaise(taxable), "18", true);
    assert.equal(t.cgst, t.sgst);
    assert.equal(t.cgst + t.sgst, t.tax);
    assert.equal(t.igst, 0n);
    const i = lineTax(toPaise(taxable), "18", false);
    assert.equal(i.cgst + i.sgst, 0n);
    assert.equal(i.igst, i.tax);
  }
});

test("flagship invoice: 60 × ₹1,000 + 18% = ₹70,800 exactly", () => {
  const { totals } = priceLines([{ qty: "60", rate: "1000", gstRate: "18" }], true);
  assert.deepEqual(totals, { taxable: "60000.00", cgst: "5400.00", sgst: "5400.00", igst: "0.00", cess: "0.00", roundOff: "0.00", grand: "70800.00" });
});

test("pro-rata split always sums to the total", () => {
  const parts = splitProRata(toPaise("112194.40"), [toPaise("77738.40"), toPaise("34456.00")]);
  assert.equal(parts[0] + parts[1], toPaise("112194.40"));
  assert.deepEqual(splitProRata(100n, [1n, 1n, 1n]), [34n, 33n, 33n]);
});

test("curated dataset validates for any seed date, including early April and FY end", () => {
  for (const today of ["2026-11-14", "2027-04-03", "2027-03-31", "2026-09-30"]) {
    const ds = buildDataset({ today, groupId: "grp_t", entityId: "ent_t", actors: { analyst: "usr_a", manager: "usr_m" } });
    const report = validateDataset({ ...ds, today });
    const failures = report.results.filter((r) => !r.pass).map((r) => `${r.name}: ${r.failures.slice(0, 3).join("; ")}`);
    assert.deepEqual(failures, [], `seed date ${today}`);
    assert.equal(ds.cases.length, 35);
    assert.ok(ds.documents.every((d) => d.date <= today));
  }
});

test("flagship PO-1001 numbers match the README", () => {
  const ds = buildDataset({ today: "2026-11-14", groupId: "g", entityId: "e", actors: { analyst: "a", manager: "m" } });
  const chain = ds.documents.filter((d) => d.caseId === "case_cur_s12");
  const po = chain.find((d) => d.type === "PO");
  assert.equal(po.externalRef, "PO-1001");
  assert.equal(po.lines[0].qty, "100");
  assert.equal(chain.filter((d) => d.type === "GRN").reduce((s, d) => s + Number(d.lines[0].qty), 0), 60);
  assert.deepEqual(chain.filter((d) => d.type === "INVOICE_IN").map((d) => d.totals.grand), ["70800.00", "70800.00"]);
  const pays = chain.filter((d) => d.type === "PAYMENT_OUT").map((d) => [d.payment.amount, d.payment.allocations.length]);
  assert.deepEqual(pays, [["30000.00", 1], ["20800.00", 1], ["15000.00", 0]]);
});
