#!/usr/bin/env node
// Demo enrichment (hackathon showcase): the 11 SATYAD/PO/27-28 orders were
// created through the UI as identical single-line pump orders with no
// downstream activity — every stat showed "not started". This script gives
// each one a distinct, realistic story: different suppliers, multi-line
// items, full commercial terms, and a GRN → QC → invoice → payment chain in
// a different state (clean, partial, over-billed, duplicate, unmatched
// payment…), plus findings and decisions on the order's case.
// Idempotent via number/externalRef keys. Run: node scripts/enrich-demo-orders.mjs
import mongoose from "../server/node_modules/mongoose/index.js";
import { createHash } from "node:crypto";

const MONGO = process.env.MONGO_URI || "mongodb://localhost:27017/satya";
await mongoose.connect(MONGO);
const db = mongoose.connection.db;
const hash = (s) => createHash("sha256").update(s).digest("hex");

const analyst = await db.collection("users").findOne({ email: "analyst@satya.demo" });
const manager = await db.collection("users").findOne({ email: "manager@satya.demo" });
if (!analyst?.memberships?.length) { console.error("analyst@satya.demo missing — run the demo seed first."); process.exit(1); }
const groupId = analyst.memberships[0].groupId;
const entity = await db.collection("entities").findOne({ groupId });
const entityId = entity.id;
const actor = analyst.v2id || String(analyst._id);
const mgr = manager ? (manager.v2id || String(manager._id)) : actor;
const now = () => new Date().toISOString();

// --- entity letterhead: billing address + footer so previews look real ---
await db.collection("entities").updateOne({ id: entityId }, {
  $set: {
    "addresses.billing": {
      line1: "Gat No. 214, Pune–Nashik Highway, Chakan MIDC Phase II",
      city: "Pune", state: "Maharashtra", stateCode: "27", pin: "410501",
    },
    "addresses.shipping": [{
      label: "Chakan works", line1: "Gat No. 214, Pune–Nashik Highway, Chakan MIDC Phase II",
      city: "Pune", state: "Maharashtra", stateCode: "27", pin: "410501",
      contact: "Stores desk · 98220 41105",
    }],
    cin: "U29100PN2019PTC184322",
    "letterhead.footerText": "Registered office: Chakan MIDC Phase II, Pune 410501 · CIN U29100PN2019PTC184322",
    bankAccounts: [{ masked: "••••7741", ifsc: "HDFC0001207", bank: "HDFC Bank, Chakan", status: "active" }],
  },
});

// --- suppliers ---
const SUPPLIERS = [
  { key: "shakti", legalName: "Shakti Industrial Suppliers Pvt Ltd", gstin: "27AAACS5678B1Z3", pan: "AAACS5678B", udyam: { number: "UDYAM-MH-19-0012345", category: "small" }, termsDays: 45, city: "Bhosari, Pune", addr: "Plot J-88, MIDC Bhosari Industrial Area" },
  { key: "kaveri", legalName: "Kaveri Pumps & Motors Ltd", gstin: "29AAKCK4412P1Z8", pan: "AAKCK4412P", udyam: { number: "UDYAM-KR-04-0009821", category: "small" }, termsDays: 30, city: "Peenya, Bengaluru", addr: "No. 44, 3rd Phase, Peenya Industrial Area" },
  { key: "rathod", legalName: "Rathod Engineering Works Pvt Ltd", gstin: "27AAWCR8821M1Z6", pan: "AAWCR8821M", udyam: { number: "UDYAM-MH-26-0077112", category: "micro" }, termsDays: 45, city: "Chinchwad, Pune", addr: "S.No. 132/2, T-Block, MIDC Bhosari" },
  { key: "deccan", legalName: "Deccan Valve Industries", gstin: "27AAHFD3320R1Z4", pan: "AAHFD3320R", udyam: { number: "UDYAM-MH-19-0044559", category: "small" }, termsDays: 30, city: "Satara", addr: "Gat 611, Additional MIDC" },
  { key: "maratha", legalName: "Maratha Bearings & Drives LLP", gstin: "27AAWFM9012K1Z9", pan: "AAWFM9012K", udyam: { number: "UDYAM-MH-19-0033117", category: "small" }, termsDays: 30, city: "Aurangabad", addr: "C-19, MIDC Waluj" },
];
const supId = {};
for (const s of SUPPLIERS) {
  const id = `sup_enrich_${s.key}`;
  const existing = await db.collection("suppliers").findOne({ groupId, legalName: s.legalName });
  if (!existing) {
    await db.collection("suppliers").insertOne({
      _id: new mongoose.Types.ObjectId(), id, groupId, entityId, legalName: s.legalName,
      gstins: [{ gstin: s.gstin, stateCode: s.gstin.slice(0, 2), status: "active" }], pan: s.pan,
      udyam: s.udyam, msme: true, paymentTermsDays: s.termsDays, status: "active",
      addresses: [{ label: "Works", line1: s.addr, city: s.city, stateCode: s.gstin.slice(0, 2), pin: "411026" }],
      contacts: [{ name: "Sales desk", email: `sales@${s.key}.example.in`, phone: "+91 98220 00000" }],
      bankAccounts: [{ masked: `••••${hash(s.key).slice(0, 4)}`, ifsc: `SBIN00${String(10000 + (parseInt(hash(s.key), 16) % 89999))}`, status: "active" }],
      provenance: "CONSTRUCTED_DEMO", source: { channel: "seed" }, createdBy: actor, createdAt: new Date(), updatedAt: new Date(),
    });
  }
  supId[s.key] = existing?.id ?? id;
}

// --- helpers ---
const T = { // per-100 tax split (intra-state CGST+SGST, inter-state IGST)
  in: (taxable) => ({ taxable: taxable.toFixed(2), cgst: (taxable * 0.09).toFixed(2), sgst: (taxable * 0.09).toFixed(2), igst: "0.00", cess: "0.00", roundOff: "0.00", grand: (taxable * 1.18).toFixed(2) }),
  out: (taxable) => ({ taxable: taxable.toFixed(2), cgst: "0.00", sgst: "0.00", igst: (taxable * 0.18).toFixed(2), cess: "0.00", roundOff: "0.00", grand: (taxable * 1.18).toFixed(2) }),
};
const fyOfDate = (d) => { const [y, m] = d.split("-").map(Number); return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`; };
const saveDoc = async (key, doc) => {
  await db.collection("documents").updateOne({ groupId, externalRef: key }, {
    $set: doc,
    $setOnInsert: {
      id: `doc_enrich_${hash(key).slice(0, 14)}`, groupId, entityId,
      fy: fyOfDate(doc.date), revision: 0,
      createdAt: new Date(), updatedAt: new Date(),
    },
  }, { upsert: true });
  const saved = await db.collection("documents").findOne({ groupId, externalRef: key });
  return saved.id;
};
const setPo = async (number, patch) => {
  await db.collection("documents").updateOne({ groupId, number }, { $set: patch });
  return (await db.collection("documents").findOne({ groupId, number })).id;
};
const link = async (poId, srcId, kind, amount) => {
  await db.collection("documentlinks").updateOne(
    { groupId, fromId: srcId, toId: poId, kind },
    { $set: { id: `lnk_enrich_${hash(srcId + poId + kind).slice(0, 12)}`, groupId, fromId: srcId, toId: poId, kind, certainty: "CONFIRMED", basis: "reference", ...(amount ? { amount: { amount, currency: "INR" } } : {}), createdBy: actor } },
    { upsert: true },
  );
};
const finding = async (caseId, poId, code, severity, message, evidence, resolution, amount) => {
  const id = `fnd_enrich_${poId.slice(-6)}_${code.toLowerCase()}`;
  await db.collection("findings").updateOne({ groupId, id }, {
    $set: {
      id, groupId, entityId, caseId, snapshotId: "enrich-demo", code, severity,
      certainty: "CONFIRMED", status: "open",
      data: { code, severity, certainty: "CONFIRMED", message, evidence, resolution, amount: amount ? { amount, currency: "INR" } : null, documentIds: evidence.map((e) => e.documentId), ruleVersion: "demo-seed" },
    },
  }, { upsert: true });
};
const decide = async (caseId, findingId, action, reason, scope) => {
  const id = `dec_enrich_${caseId.slice(-6)}_${action.toLowerCase()}`;
  await db.collection("decisions").updateOne({ groupId, id }, {
    $set: { id, groupId, caseId, findingId, action, reason, scope, actor: mgr, actorRole: "ap_manager", createdAt: new Date() },
  }, { upsert: true });
};
const caseOf = async (poId) => (await db.collection("cases").findOne({ groupId, kind: "po", subjectIds: poId }))?.id;
const retitle = async (poId, title) => db.collection("cases").updateOne({ groupId, kind: "po", subjectIds: poId }, { $set: { title } });
const approvals = (days = 0) => [
  { actor, action: "submit", role: "buyer", comment: "Submitted for approval", at: `2027-04-1${0 + days}T09:12:00+05:30` },
  { actor: mgr, action: "approve", role: "ap_manager", comment: "Rates verified against last purchase — within band", at: `2027-04-1${0 + days}T11:40:00+05:30` },
  { actor: mgr, action: "issue", role: "ap_manager", at: `2027-04-1${0 + days}T12:05:00+05:30` },
];
const shipTo = {
  label: "Chakan works — stores gate 2",
  line1: "Gat No. 214, Pune–Nashik Highway, Chakan MIDC Phase II",
  city: "Pune", state: "Maharashtra", stateCode: "27", pin: "410501",
  contact: "Stores desk · 98220 41105",
};
const L = (lineNo, description, hsn, qty, uom, rate, scheduleDate) => ({ lineNo, description, hsn, uom, qty: String(qty), rate: String(rate), gstRate: "18", scheduleDate });
const totals = (lines, inter) => {
  const taxable = lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0);
  return (inter ? T.out : T.in)(taxable);
};
const grn = (poId, seller, number, date, lines, note) => ({
  type: "GRN", number, date, status: "confirmed", seller, buyer: { name: entity.legalName, gstin: entity.gstins?.[0]?.gstin },
  currency: "INR", lines: lines.map((l) => ({ ...l, refs: { poId, poLineNo: l.refs?.poLineNo ?? l.lineNo } })),
  remarks: note, source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: now(), createdBy: actor,
});
const qc = (poId, seller, number, date, lines) => ({
  type: "QC", number, date, status: "confirmed", seller, buyer: { name: entity.legalName },
  currency: "INR", lines: lines.map((l) => ({ ...l, refs: { poId, poLineNo: l.lineNo } })),
  source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: now(), createdBy: actor,
});
const inv = (poId, seller, number, date, lines, opts = {}) => ({
  type: "INVOICE_IN", number, date, status: "posted", seller,
  buyer: { name: entity.legalName, gstin: entity.gstins?.[0]?.gstin, stateCode: "27" },
  placeOfSupply: seller.stateCode ?? "27", currency: "INR",
  lines: lines.map((l) => ({ ...l, refs: { poId, poLineNo: l.refs?.poLineNo ?? l.lineNo } })),
  totals: opts.totals, gst: opts.irn ? { irn: opts.irn } : {}, source: { channel: opts.channel ?? "upload_pdf" },
  provenance: "CONSTRUCTED_DEMO", observedAt: now(), createdBy: actor,
});
const pay = (seller, number, date, amount, utr, invoiceIds = []) => ({
  type: "PAYMENT_OUT", number, date, status: "posted", seller, buyer: { name: entity.legalName },
  currency: "INR", lines: [],
  payment: { amount, mode: "NEFT", utr, valueDate: date, allocations: invoiceIds.map((id) => ({ documentId: id, amount, basis: "remittance" })) },
  source: { channel: "bank_csv" }, provenance: "CONSTRUCTED_DEMO", observedAt: now(), createdBy: actor,
});
const sellerOf = (s) => ({ name: s.legalName, gstin: s.gstin, stateCode: s.gstin.slice(0, 2), supplierId: supId[s.key] });
const ref = (n, kind) => `ENRICH-${n}-${kind}`;

// ============================================================ PO stories ===
// 000001 — fulfilled, fully paid (clean baseline)
{
  const s = SUPPLIERS[0], num = "SATYAD/PO/27-28/000001";
  const lines = [
    L(1, "Centrifugal pump 5 HP, CRI CRI-5M, CI body, 3-phase", "8413", 10, "EA", 5000, "2027-04-24"),
    L(2, "Mechanical seal kit — compatible, Viton", "8484", 10, "SET", 850, "2027-04-24"),
  ];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.shakti, lines, terms: { paymentTerms: "45 days from accepted invoice", creditDays: 45, deliveryTerms: "FOR site, freight paid", warranty: "12 months from commissioning", inspection: "Visual + run test on receipt", freeText: ["Packing: seaworthy wooden crate, ISPM-15 treated"] },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(0), revision: 3, status: "fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000001", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0151", "2027-04-24", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty })), "Received at gate 2, all quantities OK"));
  await saveDoc(ref("000001", "QC1"), qc(poId, sellerOf(s), "QC/27-28/0144", "2027-04-25", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty, acceptedQty: l.qty, rejectedQty: "0" }))));
  const i = await saveDoc(ref("000001", "INV1"), inv(poId, sellerOf(s), "SHK/27-28/0117", "2027-04-26", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, hsn: l.hsn })), { totals: totals(lines, false), irn: hash("inv-000001").slice(0, 64) }));
  const p = await saveDoc(ref("000001", "PAY1"), pay(sellerOf(s), "PAY/27-28/0031", "2027-05-20", totals(lines, false).grand, "UTRSHK20270520031", [i]));
  await link(poId, g, "RECEIVES"); await link(poId, i, "BILLS"); await link(poId, p, "SETTLES", totals(lines, false).grand);
}

// 000002 — partially fulfilled: 12 of 20 delivered, invoiced for delivered, part-paid
{
  const s = SUPPLIERS[1], num = "SATYAD/PO/27-28/000002";
  const lines = [
    L(1, "Submersible pump 3 HP, 100mm borewell, SS body", "8413", 20, "EA", 7200, "2027-05-05"),
    L(2, "Control panel 3-phase with dry-run protection", "8537", 20, "EA", 2100, "2027-05-05"),
  ];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.kaveri, lines, terms: { paymentTerms: "30 days from accepted invoice", creditDays: 30, deliveryTerms: "Ex-works, freight to account", warranty: "18 months", inspection: "Insulation resistance + flow test" },
    shipTo, totals: totals(lines, true), placeOfSupply: "29", approvals: approvals(1), revision: 1, status: "partially_fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000002", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0168", "2027-05-08", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: "12" })), "First lot — balance 8 expected 20 May"));
  const invLines = lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: "12", rate: l.rate, hsn: l.hsn }));
  const i = await saveDoc(ref("000002", "INV1"), inv(poId, sellerOf(s), "KPM/27-28/0456", "2027-05-10", invLines, { totals: totals(invLines, true), irn: hash("inv-000002").slice(0, 64) }));
  const p = await saveDoc(ref("000002", "PAY1"), pay(sellerOf(s), "PAY/27-28/0042", "2027-06-01", "60000.00", "UTRKPM20270601042", [i]));
  await link(poId, g, "RECEIVES"); await link(poId, i, "BILLS"); await link(poId, p, "SETTLES", "60000.00");
}

// 000003 — duplicate invoice finding (the showcase issue)
{
  const s = SUPPLIERS[2], num = "SATYAD/PO/27-28/000003";
  const lines = [L(1, "CI sluice valve PN16, 100mm, flanged ends", "8481", 8, "EA", 9400, "2027-04-28")];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.rathod, lines, terms: { paymentTerms: "45 days — MSME registered", creditDays: 45, deliveryTerms: "FOR site", warranty: "12 months", inspection: "Hydro test certificate mandatory" },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(0), revision: 2, status: "partially_fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000003", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0177", "2027-04-29", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty })), "All 8 valves received with test certificates"));
  const i1 = await saveDoc(ref("000003", "INV1"), inv(poId, sellerOf(s), "REW/27-28/0201", "2027-05-02", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, hsn: l.hsn })), { totals: totals(lines, false), irn: hash("inv-000003a").slice(0, 64) }));
  const i2 = await saveDoc(ref("000003", "INV2"), inv(poId, sellerOf(s), "REW/27-28/0201", "2027-05-09", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, hsn: l.hsn })), { totals: totals(lines, false), channel: "api" }));
  await link(poId, g, "RECEIVES"); await link(poId, i1, "BILLS"); await link(poId, i2, "BILLS");
  const caseId = await caseOf(poId);
  const grand = totals(lines, false).grand;
  await finding(caseId, poId, "POSSIBLE_DUPLICATE_INVOICE", "high",
    `REW/27-28/0201 appears twice — once via email (2 May) and once via the supplier portal (9 May). Same supplier, number and ₹${grand}. Paying both would double-pay ${s.legalName}.`,
    [{ documentId: i1, field: "number" }, { documentId: i2, field: "number" }],
    "Confirm with the supplier which posting is genuine, then reject the other.", grand);
}

// 000004 — over-billing: invoiced 10, delivered 8 (critical)
{
  const s = SUPPLIERS[3], num = "SATYAD/PO/27-28/000004";
  const lines = [L(1, "Non-return valve, wafer type, 80mm, SS304", "8481", 10, "EA", 5600, "2027-04-30")];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.deccan, lines, terms: { paymentTerms: "30 days", creditDays: 30, deliveryTerms: "FOR site", warranty: "12 months", inspection: "On receipt" },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(0), revision: 1, status: "partially_fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000004", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0185", "2027-05-03", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: "8" })), "8 of 10 received — 2 damaged in transit, returned on the same challan"));
  const i = await saveDoc(ref("000004", "INV1"), inv(poId, sellerOf(s), "DVI/27-28/0092", "2027-05-05", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: "10", rate: l.rate, hsn: l.hsn })), { totals: totals(lines, false) }));
  await link(poId, g, "RECEIVES"); await link(poId, i, "BILLS");
  const caseId = await caseOf(poId);
  const over = (2 * 5600 * 1.18).toFixed(2);
  const fid = `fnd_enrich_${poId.slice(-6)}_qty_mismatch`;
  await finding(caseId, poId, "QTY_MISMATCH", "critical",
    `DVI/27-28/0092 bills 10 units but only 8 were received — 2 came back damaged on the same challan. Paying as billed overpays ₹${Number(over).toLocaleString("en-IN")}.`,
    [{ documentId: i, field: "lines.1.qty" }, { documentId: g, field: "lines.1.qty" }],
    "Ask the supplier for a credit note, or pay only for the 8 accepted units.", over);
  await decide(caseId, fid, "PLACE_ON_HOLD", "Holding ₹" + Number(over).toLocaleString("en-IN") + " until Deccan issues a credit note for the 2 returned valves.", { amount: over, currency: "INR" });
}

// 000005 — delivered, QC reject partial, no invoice yet
{
  const s = SUPPLIERS[4], num = "SATYAD/PO/27-28/000005";
  const lines = [
    L(1, "Deep-groove ball bearing 6310 ZZ, SKF", "8482", 50, "EA", 640, "2027-05-02"),
    L(2, "Plummer block housing SN511", "8483", 12, "EA", 2350, "2027-05-02"),
  ];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.maratha, lines, terms: { paymentTerms: "30 days", creditDays: 30, deliveryTerms: "FOR site", warranty: "Genuine manufacturer warranty", inspection: "BIS marking + sample run" },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(1), revision: 0, status: "partially_fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000005", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0196", "2027-05-06", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty })), "Full quantity received"));
  await saveDoc(ref("000005", "QC1"), qc(poId, sellerOf(s), "QC/27-28/0189", "2027-05-07", [
    { lineNo: 1, description: lines[0].description, uom: "EA", qty: "50", acceptedQty: "46", rejectedQty: "4" },
    { lineNo: 2, description: lines[1].description, uom: "EA", qty: "12", acceptedQty: "12", rejectedQty: "0" },
  ]));
  await link(poId, g, "RECEIVES");
  const caseId = await caseOf(poId);
  await finding(caseId, poId, "QC_REJECTION_PENDING", "medium",
    "4 of 50 bearings failed the sample run test (noise). They are quarantined — the supplier has been asked for replacement before invoicing.",
    [{ documentId: g, field: "lines.1.qty" }],
    "Either accept replacements and invoice for 46+, or return the 4 units.", (4 * 640 * 1.18).toFixed(2));
}

// 000006 — invoiced without delivery (critical showcase issue)
{
  const s = SUPPLIERS[0], num = "SATYAD/PO/27-28/000006";
  const lines = [L(1, "Monoblock pump 2 HP, single phase, ISI marked", "8413", 15, "EA", 4300, "2027-05-12")];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.shakti, lines, terms: { paymentTerms: "45 days", creditDays: 45, deliveryTerms: "FOR site", warranty: "12 months", inspection: "On receipt" },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(0), revision: 1, status: "issued",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const i = await saveDoc(ref("000006", "INV1"), inv(poId, sellerOf(s), "SHK/27-28/0148", "2027-05-14", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, hsn: l.hsn })), { totals: totals(lines, false), channel: "api" }));
  await link(poId, i, "BILLS");
  const caseId = await caseOf(poId);
  await finding(caseId, poId, "INVOICE_BEFORE_RECEIPT", "critical",
    `SHK/27-28/0148 bills the full ₹${totals(lines, false).grand} for 15 pumps, but no goods receipt exists — nothing has arrived at any gate.`,
    [{ documentId: i, field: "totals.grand" }],
    "Hold payment and confirm with stores whether the shipment arrived unrecorded, or dispute the invoice.", totals(lines, false).grand);
  await decide(caseId, `fnd_enrich_${poId.slice(-6)}_invoice_before_receipt`, "REQUEST_CLARIFICATION", "Asked stores at Chakan gate 2 and the supplier — waiting for a delivery challan scan.", null);
}

// 000007 — paid in full, but one bank debit has no reference (unmatched)
{
  const s = SUPPLIERS[1], num = "SATYAD/PO/27-28/000007";
  const lines = [L(1, "Flameproof motor 7.5 HP, 1440 RPM, IE2", "8501", 4, "EA", 38500, "2027-04-26")];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.kaveri, lines, terms: { paymentTerms: "30 days", creditDays: 30, deliveryTerms: "Ex-works", warranty: "24 months FLP enclosure", inspection: "Routine test certificate" },
    shipTo, totals: totals(lines, true), placeOfSupply: "29", approvals: approvals(0), revision: 1, status: "fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000007", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0203", "2027-05-02", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty })), "All 4 motors received"));
  const i = await saveDoc(ref("000007", "INV1"), inv(poId, sellerOf(s), "KPM/27-28/0499", "2027-05-04", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, hsn: l.hsn })), { totals: totals(lines, true), irn: hash("inv-000007").slice(0, 64) }));
  const grand = totals(lines, true).grand;
  const p1 = await saveDoc(ref("000007", "PAY1"), pay(sellerOf(s), "PAY/27-28/0055", "2027-05-30", grand, "UTRKPM20270530055", [i]));
  const p2 = await saveDoc(ref("000007", "PAY2"), pay(sellerOf(s), "PAY/27-28/0061", "2027-06-03", "15000.00", null, []));
  await link(poId, g, "RECEIVES"); await link(poId, i, "BILLS"); await link(poId, p1, "SETTLES", grand);
  const caseId = await caseOf(poId);
  await finding(caseId, poId, "UNMATCHED_PAYMENT", "medium",
    `A ₹15,000 NEFT debit to ${s.legalName} on 3 Jun has no UTR narrative or remittance advice — it does not match any open invoice.`,
    [{ documentId: p2, field: "payment.amount" }],
    "Request the remittance advice, or allocate it to an advance/credit note.", "15000.00");
}

// 000008 — acknowledged, first batch overdue (schedule slipped)
{
  const s = SUPPLIERS[2], num = "SATYAD/PO/27-28/000008";
  const lines = [
    L(1, "Fabricated pipe spool DN100, sch40, painted", "7306", 30, "EA", 1750, "2026-10-15"),
    L(2, "MS gasket, spiral wound, DN100", "8484", 60, "EA", 140, "2026-10-15"),
  ];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.rathod, lines, terms: { paymentTerms: "45 days — MSME registered", creditDays: 45, deliveryTerms: "FOR site", warranty: "12 months", inspection: "Dimensional check on receipt", freeText: ["Liquidated damages @0.5% per week of delay, capped at 5% of PO value"] },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(0), revision: 2, status: "acknowledged",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const caseId = await caseOf(poId);
  await finding(caseId, poId, "DELIVERY_SLIPPED", "medium",
    "The first batch was due 15 Oct and nothing has been received. The LD clause allows a 0.5% per-week levy — worth flagging before the next schedule review.",
    [{ documentId: poId, field: "lines.1.scheduleDate" }],
    "Chase a revised delivery date in writing; apply LD terms if the slip continues.", null);
}

// 000009 — short-closed after partial delivery + settled
{
  const s = SUPPLIERS[3], num = "SATYAD/PO/27-28/000009";
  const lines = [L(1, "Butterfly valve, gear operated, 150mm, CI disc SS", "8481", 25, "EA", 3200, "2027-05-01")];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.deccan, lines, terms: { paymentTerms: "30 days", creditDays: 30, deliveryTerms: "FOR site", warranty: "12 months", inspection: "On receipt" },
    shipTo, totals: totals(lines, false), placeOfSupply: "27",
    approvals: [...approvals(0), { actor: mgr, action: "short_close", role: "ap_manager", comment: "Project scope cut — closed at 16 delivered units with supplier's consent", at: "2027-05-19T15:22:00+05:30" }],
    revision: 4, status: "short_closed",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const dl = [{ lineNo: 1, description: lines[0].description, uom: "EA", qty: "16", rate: "3200", hsn: "8481" }];
  const g = await saveDoc(ref("000009", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0211", "2027-05-05", dl.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty })), "16 valves received in two lots"));
  const i = await saveDoc(ref("000009", "INV1"), inv(poId, sellerOf(s), "DVI/27-28/0108", "2027-05-08", dl, { totals: totals(dl, false) }));
  const p = await saveDoc(ref("000009", "PAY1"), pay(sellerOf(s), "PAY/27-28/0066", "2027-06-02", totals(dl, false).grand, "UTRDVI20270602066", [i]));
  await link(poId, g, "RECEIVES"); await link(poId, i, "BILLS"); await link(poId, p, "SETTLES", totals(dl, false).grand);
}

// 000010 — multi-line, fulfilled, clean
{
  const s = SUPPLIERS[4], num = "SATYAD/PO/27-28/000010";
  const lines = [
    L(1, "V-belt pulley, 2-groove, 200mm PCD, taper-lock", "8483", 24, "EA", 1150, "2027-04-22"),
    L(2, "Taper-lock bush 2517-42mm", "8483", 24, "EA", 310, "2027-04-22"),
    L(3, "Industrial V-belt C-108, wrapped", "4010", 48, "EA", 480, "2027-04-22"),
  ];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.maratha, lines, terms: { paymentTerms: "30 days", creditDays: 30, deliveryTerms: "FOR site", warranty: "6 months", inspection: "On receipt" },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(1), revision: 0, status: "fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000010", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0224", "2027-04-24", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty })), "Complete — matched packing slip"));
  const i = await saveDoc(ref("000010", "INV1"), inv(poId, sellerOf(s), "MBD/27-28/0073", "2027-04-25", lines.map((l) => ({ lineNo: l.lineNo, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, hsn: l.hsn })), { totals: totals(lines, false), irn: hash("inv-000010").slice(0, 64) }));
  const p = await saveDoc(ref("000010", "PAY1"), pay(sellerOf(s), "PAY/27-28/0070", "2027-05-24", totals(lines, false).grand, "UTRMBD20270524070", [i]));
  await link(poId, g, "RECEIVES"); await link(poId, i, "BILLS"); await link(poId, p, "SETTLES", totals(lines, false).grand);
}

// 000011 — issued, first partial delivery only (the screenshot order)
{
  const s = SUPPLIERS[0], num = "SATYAD/PO/27-28/000011";
  const lines = [L(1, "Centrifugal pump 5 HP, CRI CRI-5M, CI body, 3-phase", "8413", 10, "EA", 5000, "2026-11-15")];
  const poId = await setPo(num, {
    seller: sellerOf(s), supplierId: supId.shakti, lines, terms: { paymentTerms: "45 days from accepted invoice", creditDays: 45, deliveryTerms: "FOR site", warranty: "12 months from commissioning", inspection: "Visual + run test on receipt" },
    shipTo, totals: totals(lines, false), placeOfSupply: "27", approvals: approvals(0), revision: 3, status: "partially_fulfilled",
  });
  await retitle(poId, `PO ${num} — ${s.legalName}`);
  const g = await saveDoc(ref("000011", "GRN1"), grn(poId, sellerOf(s), "GRN/27-28/0231", "2027-04-27", [{ lineNo: 1, description: lines[0].description, uom: "EA", qty: "3" }], "First lot of 3 — balance 7 in transit"));
  await link(poId, g, "RECEIVES");
}

console.log("Enriched SATYAD/PO/27-28/000001–000011 with suppliers, terms, GRN/QC/invoice/payment chains, findings and decisions.");
await mongoose.disconnect();
