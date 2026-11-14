import test from "node:test";
import assert from "node:assert/strict";
import { plural, dayText, relativeDue, dueTone, findingPlain, findingTitle, FINDING_PLAIN, sanitizeEngineText, timeAgo } from "./humanize.ts";

test("plural-safe counts and day text", () => {
  assert.equal(dayText(1), "1 day");
  assert.equal(dayText(3), "3 days");
  assert.equal(dayText(-1), "1 day");
  assert.equal(dayText(0), "0 days");
  assert.equal(plural(1, "bill"), "1 bill");
  assert.equal(plural(2, "entry", "entries"), "2 entries");
  assert.equal(plural(12000, "bill"), "12,000 bills");
});

test("relative due wording and tone", () => {
  assert.equal(relativeDue(-3), "3 days overdue");
  assert.equal(relativeDue(-1), "1 day overdue");
  assert.equal(relativeDue(0), "due today");
  assert.equal(relativeDue(1), "due tomorrow");
  assert.equal(relativeDue(5), "due in 5 days");
  assert.equal(dueTone(-1), "critical");
  assert.equal(dueTone(7), "warn");
  assert.equal(dueTone(8), "neutral");
  assert.equal(dueTone(null), "neutral");
});

test("every finding code maps to a plain sentence, never the raw code", () => {
  const codes = [
    "MSME_43BH_DEADLINE", "TAX_GSTIN_INVALID", "TAX_TYPE_MISMATCH", "PAY_UNALLOCATED", "PAY_SPLIT", "DUP_EXACT_INVOICE",
    "DUPLICATE_INVOICE_SUSPECT", "QTY_INVOICED_EXCEEDS_ACCEPTED", "INVOICE_QTY_EXCEEDS_RECEIVED", "SCREEN_PRICE_OUTLIER",
    "DELIVERY_SHORTFALL", "DOC_MISSING_INVOICE", "RECEIPT_EVIDENCE_MISSING", "DOC_CREDIT_NOTE_PENDING", "TAX_EWAYBILL_MISSING",
    "PRICE_VARIANCE", "TAX_SOMETHING_NEW", "PAY_NEW_THING", "DUP_FUTURE", "QTY_FUTURE", "SCREEN_FUTURE", "WHATEVER",
  ];
  for (const code of codes) {
    const plain = findingPlain(code);
    assert.ok(plain.title && plain.sentence, code);
    assert.ok(!plain.title.includes("_") && !plain.sentence.includes(code), code);
  }
  assert.equal(findingTitle("DUP_EXACT_INVOICE"), "Duplicate bill");
  assert.equal(findingTitle("TAX_SOMETHING_NEW"), "GST issue");
  for (const [code, plain] of Object.entries(FINDING_PLAIN)) assert.ok(!/[A-Z]{3,}_[A-Z]/.test(plain.sentence), code);
});

test("sanitizer fixes engine glitches", () => {
  assert.equal(
    sanitizeEngineText("Invoice REW/26-27/0201 to a micro enterprise is 44 day(s) past its MSMED s.15 deadline (2026-10-01); ₹88736.00 unpaid."),
    "Invoice REW/26-27/0201 to a micro enterprise is 44 days past its MSMED s.15 deadline (1 Oct 2026); ₹88,736.00 unpaid.",
  );
  assert.equal(sanitizeEngineText("only 1 day(s) left"), "only 1 day left");
  assert.equal(sanitizeEngineText("₹₹1,20,000.00 at stake"), "₹1,20,000.00 at stake");
  assert.equal(sanitizeEngineText("Payment doc_cur_s07_p2 (12000.00) is not allocated"), "Payment (₹12,000.00) is not allocated");
  assert.equal(sanitizeEngineText("Payment doc_cur_s07_p2 (12000.00) is not allocated", { doc_cur_s07_p2: "UTR-778" }), "Payment UTR-778 (₹12,000.00) is not allocated");
  assert.equal(sanitizeEngineText("PO doc_cur_s03_po line 1: invoiced 16 exceeds delivered 8"), "PO line 1: invoiced 16 units, only 8 delivered");
  assert.equal(sanitizeEngineText("See doc_bpi_po_12 for details"), "See PO-12 for details");
  assert.equal(sanitizeEngineText("Linked to doc_xyz"), "Linked to this document");
  assert.equal(sanitizeEngineText("GST at 18.00% applies"), "GST at 18.00% applies");
  assert.equal(sanitizeEngineText("rate 2.50 per unit"), "rate 2.50 per unit");
  assert.equal(sanitizeEngineText(null), "");
});

test("time ago reads naturally", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  assert.equal(timeAgo("2026-11-15T11:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-11-15T11:30:00Z", now), "30 min ago");
  assert.equal(timeAgo("2026-11-15T09:00:00Z", now), "3 hours ago");
  assert.equal(timeAgo("2026-11-14T10:00:00Z", now), "yesterday");
  assert.equal(timeAgo("2026-11-11T12:00:00Z", now), "4 days ago");
});
