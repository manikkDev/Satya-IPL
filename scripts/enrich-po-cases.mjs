#!/usr/bin/env node
// Enrich lone PO cases: every po-case whose subject PO has no referencing
// docs gets a linked GRN (~70% received), an INVOICE_IN (billed in full —
// deliberate short-fall finding), a QC line and a partial PAYMENT_OUT with a
// UTR + allocation, plus DocumentLinks. Then every case a reviewer opens
// shows a real chain: findings, balances, money trail. Idempotent —
// skips POs that already have a GRN. Run: node scripts/enrich-po-cases.mjs
import mongoose from "../server/node_modules/mongoose/index.js";

const MONGO = process.env.MONGO_URI || "mongodb://localhost:27017/satya";
const MAX_CASES = Number(process.env.MAX_CASES || 80);
await mongoose.connect(MONGO);
const db = mongoose.connection.db;

const analyst = await db.collection("users").findOne({ email: "analyst@satya.demo" });
const groupId = analyst.memberships[0].groupId;
const actor = analyst.v2id || String(analyst._id);
const suffix = () => Math.random().toString(36).slice(2, 8);
const insert = (col, doc) => db.collection(col).insertOne({ _id: new mongoose.Types.ObjectId(), ...doc, createdAt: new Date(), updatedAt: new Date() });

// every po case whose subject PO lacks a referencing GRN
const cases = await db.collection("cases").find({ groupId, kind: "po" }).sort({ updatedAt: -1 }).limit(400).toArray();
let enriched = 0, skipped = 0;
for (const kase of cases.slice(0, MAX_CASES)) {
  const po = await db.collection("documents").findOne({ id: { $in: kase.subjectIds || [] }, type: "PO" });
  if (!po) { skipped++; continue; }
  const hasGrn = await db.collection("documents").findOne({ groupId, "lines.refs.poId": po.id, type: "GRN" });
  if (hasGrn) { skipped++; continue; }
  const line = po.lines?.[0] || { qty: "10", rate: "5000", hsn: "8413", description: "Item" };
  const qty = Math.max(1, Number(line.qty || 10));
  const rate = Number(line.rate || 5000);
  const got = Math.max(1, Math.floor(qty * 0.7));
  const payAmt = Math.floor(qty * rate * 0.6 * 1.18); // 60% of gross
  const grand = (qty * rate * 1.18).toFixed(2);
  const tag = suffix(), day = po.date || "2026-10-01";
  const seller = po.seller || { name: "Supplier" };
  const buyer = po.buyer || { name: "Satya Equipment Distribution" };
  const sid = po.supplierId || seller.supplierId;

  const grn = { id: `doc_fill_grn_${tag}`, groupId, entityId: po.entityId, type: "GRN", number: `GRN/26-27/${tag.toUpperCase()}`, externalRef: `FILL-GRN-${po.id}`,
    date: day, fy: "2026-27", status: "posted", revision: 0, seller, buyer, currency: "INR",
    lines: [{ lineNo: 1, description: line.description || "Item", uom: "EA", qty: String(got), refs: { poId: po.id, poLineNo: 1 } }],
    source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor };
  const inv = { id: `doc_fill_inv_${tag}`, groupId, entityId: po.entityId, type: "INVOICE_IN", externalRef: `FILL-INV-${po.id}`, number: `INV-${tag.toUpperCase()}`,
    date: day, fy: "2026-27", status: "posted", revision: 0, seller, buyer, supplierId: sid, currency: "INR",
    lines: [{ lineNo: 1, description: line.description || "Item", uom: "EA", qty: String(qty), rate: String(rate), gstRate: "18", refs: { poId: po.id, poLineNo: 1 } }],
    totals: { taxable: (qty * rate).toFixed(2), cgst: "0.00", sgst: "0.00", igst: (qty * rate * 0.18).toFixed(2), cess: "0.00", roundOff: "0.00", grand },
    source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor };
  const pay = { id: `doc_fill_pay_${tag}`, groupId, entityId: po.entityId, type: "PAYMENT_OUT", number: `PAY/26-27/${tag.toUpperCase()}`, externalRef: `FILL-PAY-${po.id}`,
    date: day, fy: "2026-27", status: "posted", revision: 0, seller, buyer, supplierId: sid, currency: "INR", lines: [],
    payment: { amount: String(payAmt.toFixed(2)), mode: "NEFT", utr: `UTR${tag.toUpperCase()}`, valueDate: day,
      allocations: [{ documentId: inv.id, amount: payAmt.toFixed(2), basis: "remittance" }] },
    source: { channel: "bank_csv" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor };
  await insert("documents", grn); await insert("documents", inv); await insert("documents", pay);
  for (const [fromId, toId, kind] of [[grn.id, po.id, "RECEIVES"], [inv.id, po.id, "BILLS"], [inv.id, grn.id, "BILLS"], [pay.id, inv.id, "SETTLES"]]) {
    await insert("documentlinks", { id: `lnk_${kind.toLowerCase()}_${tag}_${toId.slice(-4)}`, groupId, fromId, toId, kind, certainty: "CONFIRMED", basis: "reviewer", createdBy: actor });
  }
  enriched++;
}
console.log(`Enriched ${enriched} cases, skipped ${skipped} (already linked / no PO)`);
await mongoose.disconnect();
