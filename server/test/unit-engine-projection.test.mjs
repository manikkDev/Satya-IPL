import { test } from "node:test";
import assert from "node:assert/strict";
import { toEngineDocument, toEngineInputs, toEngineLink } from "../src/services/engineProjection.js";
import { stableFindingId, deriveLinks } from "../src/services/reconcile.js";

const base = {
  _id: "64ff", __v: 0, id: "doc_inv1", groupId: "grp", entityId: "ent", type: "INVOICE_IN",
  number: "INV-1", date: "2026-10-01", fy: "2026-27", status: "posted", revision: 2,
  seller: { name: "Kaveri Pumps", gstin: "27AAACK1234A1Z5", supplierId: "sup_1", address: { label: "Plant" } },
  buyer: { name: "Satya" }, currency: "INR",
  lines: [{ lineNo: 1, description: "Pump", qty: 2, rate: { amount: "5000" }, uom: "EA", rateSource: "po", refs: { poId: "doc_po1", poLineNo: 1 } }],
  totals: { taxable: { amount: "10000" }, cgst: 900, sgst: "900", igst: 0, grand: { amount: "11800.00" } },
  gst: { irn: "a".repeat(64), itcReversed: { at: "x" }, ewb: "331000123456", irnStatus: "not_applicable", metaNote: "n", metaRecordedBy: "u", gstr2bPeriod: "2026-10" },
  payment: { amount: "100", tds: { section: "194Q", amount: "10" }, mode: "neft", allocations: [] },
  terms: { creditDays: 45, templateId: "tpl_1" },
  source: { channel: "created_in_satya" }, provenance: "USER_PROVIDED",
  observedAt: "2026-10-01T10:00:00.000Z", createdAt: new Date("2026-10-01T10:00:00Z"), updatedAt: new Date("2026-10-02T10:00:00Z"),
  createdBy: "usr_1", bpi: { foo: 1 }, caseId: "case_1", taxSummary: [], approvals: [], contentHash: "h",
};

test("projection keeps contract fields and drops everything else", () => {
  const { document, skip } = toEngineDocument(base);
  assert.equal(skip, undefined);
  for (const k of ["_id", "__v", "bpi", "caseId", "taxSummary", "approvals", "contentHash"]) assert.equal(k in document, false, k);
  assert.deepEqual(document.gst, { irn: "a".repeat(64), ewayBillNo: "331000123456" });
  assert.deepEqual(document.payment, { amount: "100.00", mode: "NEFT", allocations: [], tdsAmount: "10.00" });
  assert.deepEqual(document.terms, { creditDays: 45 });
  assert.equal(document.totals.grand, "11800.00");
  assert.equal(document.totals.cgst, "900.00");
  assert.equal(document.lines[0].qty, "2");
  assert.equal(document.lines[0].rate, "5000");
  assert.equal("rateSource" in document.lines[0], false);
  assert.equal("address" in document.seller, false); // not a strict Address
  assert.equal(document.createdAt, "2026-10-01T10:00:00.000Z");
});

test("non-contract channels, null numbers and bad docs are handled, not fatal", () => {
  const tds = { ...base, id: "doc_tds", type: "TDS_ENTRY", number: null, lines: [], totals: undefined, source: { channel: "compliance" },
    payment: { tds: { section: "194Q", amount: "120.50" }, allocations: [{ documentId: "doc_pay", amount: "120.5", basis: "reviewer" }] } };
  const r = toEngineDocument(tds);
  assert.equal(r.document.source.channel, "api");
  assert.equal(r.document.source.sourceSystem, "compliance");
  assert.equal(r.document.number, "UNNUMBERED-doc_tds");
  assert.equal(r.document.payment.amount, "120.50");
  const bad = { ...base, id: "doc_bad", date: "2026-02-30" };
  const out = toEngineInputs([base, tds, bad], [{ id: "l1", groupId: "grp", fromId: "doc_pay", toId: "doc_inv1", kind: "SETTLES", basis: "reviewer", amount: { amount: "50" }, createdAt: new Date() }]);
  assert.equal(out.documents.length, 2);
  assert.deepEqual(out.skipped.map((s) => s.id), ["doc_bad"]);
  assert.deepEqual(out.links[0].amount, { amount: "50.00", currency: "INR" });
  assert.equal("groupId" in out.links[0], false);
  assert.equal(toEngineLink({ fromId: "a", toId: "b", kind: "NOT_A_KIND", basis: "rule" }), null);
});

test("finding ids are stable across runs; TDS allocations derive ADJUSTS links", () => {
  const f = { code: "DUP_PAYMENT", evidence: [{ documentId: "b" }, { documentId: "a" }] };
  assert.equal(stableFindingId("case_1", f), stableFindingId("case_1", { ...f, evidence: [...f.evidence].reverse() }));
  assert.notEqual(stableFindingId("case_1", f), stableFindingId("case_2", f));
  const links = deriveLinks([
    { id: "pay", groupId: "g", type: "PAYMENT_OUT", payment: { allocations: [{ documentId: "inv", amount: "5" }] } },
    { id: "tds", groupId: "g", type: "TDS_ENTRY", payment: { allocations: [{ documentId: "pay", amount: "1" }] } },
    { id: "inv", groupId: "g", type: "INVOICE_IN", lines: [] },
  ]);
  assert.deepEqual(links.map((l) => `${l.fromId}>${l.kind}>${l.toId}`).sort(), ["pay>SETTLES>inv", "tds>ADJUSTS>pay"]);
});
