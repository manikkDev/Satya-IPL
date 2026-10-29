#!/usr/bin/env node
// Demo seed v2 (04 P3-B11): gives the satya-demo group a fully-linked case —
// PO -> partial GRN -> INVOICE_IN -> partial PAYMENT_OUT -> DocumentLinks —
// so investigations, graph, dashboard and compliance have real data on day 1.
// Idempotent: skips docs whose externalRef already exists. Run: node scripts/seed-demo-v2.mjs
import mongoose from "../server/node_modules/mongoose/index.js";

const MONGO = process.env.MONGO_URI || "mongodb://localhost:27017/satya";
await mongoose.connect(MONGO);
const db = mongoose.connection.db;

const analyst = await db.collection("users").findOne({ email: "analyst@satya.demo" });
if (!analyst?.memberships?.length) { console.error("analyst@satya.demo missing — run the v1 demo seed first."); process.exit(1); }
const groupId = analyst.memberships[0].groupId;
const group = await db.collection("groups").findOne({ id: groupId });
if (!group) { console.error("Demo group not found."); process.exit(1); }
const entity = await db.collection("entities").findOne({ groupId });
const entityId = entity.id, actor = analyst.v2id || String(analyst._id);
console.log(`Seeding into group ${groupId}, entity ${entityId}`);

const upsert = async (col, key, doc) => {
  const existing = await db.collection(col).findOne(key);
  if (existing) return existing.id;
  await db.collection(col).insertOne({ _id: new mongoose.Types.ObjectId(), ...doc, createdAt: new Date(), updatedAt: new Date() });
  return doc.id;
};

const supplierId = await upsert("suppliers", { groupId, legalName: "Shakti Industrial Suppliers Pvt Ltd" }, {
  id: `sup_demo_shakti`, groupId, entityId, legalName: "Shakti Industrial Suppliers Pvt Ltd",
  gstins: [{ gstin: "27AAACS5678B1Z3", stateCode: "27", status: "active" }],
  udyam: { number: "UDYAM-MH-19-0012345", category: "small" }, msme: true,
  paymentTermsDays: 45, status: "active", createdBy: actor,
});

const poId = await upsert("documents", { groupId, externalRef: "SEED-PO-2" }, {
  id: `doc_seed_po2`, groupId, entityId, type: "PO", number: "SATYAD/PO/26-27/000777", externalRef: "SEED-PO-2",
  date: "2026-09-15", fy: "2026-27", status: "issued", revision: 1,
  seller: { name: "Shakti Industrial Suppliers Pvt Ltd", gstin: "27AAACS5678B1Z3", stateCode: "27", supplierId },
  buyer: { name: "Satya Equipment Distribution", gstin: "27AAACS1234A1Z5", stateCode: "27" },
  supplierId, placeOfSupply: "27", currency: "INR",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP", hsn: "8413", uom: "EA", qty: "10", rate: "12500" }],
  totals: { taxable: "125000.00", cgst: "11250.00", sgst: "11250.00", igst: "0.00", cess: "0.00", roundOff: "0.00", grand: "147500.00" },
  terms: { paymentTerms: "45 days", creditDays: 45 }, gst: {},
  source: { channel: "created_in_satya" }, provenance: "USER_PROVIDED",
  observedAt: new Date().toISOString(), createdBy: actor,
});

const grnId = await upsert("documents", { groupId, externalRef: "SEED-GRN-2" }, {
  id: `doc_seed_grn2`, groupId, entityId, type: "GRN", number: "GRN/26-27/0412", externalRef: "SEED-GRN-2",
  date: "2026-09-28", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Shakti Industrial Suppliers Pvt Ltd", stateCode: "27", supplierId },
  buyer: { name: "Satya Equipment Distribution", stateCode: "27" },
  currency: "INR",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP", uom: "EA", qty: "7", refs: { poId, poLineNo: 1 } }],
  source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

const invId = await upsert("documents", { groupId, externalRef: "SEED-INV-2" }, {
  id: `doc_seed_inv2`, groupId, entityId, type: "INVOICE_IN", externalRef: "SEED-INV-2", number: "SHK/26-27/8841",
  date: "2026-10-02", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Shakti Industrial Suppliers Pvt Ltd", gstin: "27AAACS5678B1Z3", stateCode: "27", supplierId },
  buyer: { name: "Satya Equipment Distribution", gstin: "27AAACS1234A1Z5", stateCode: "27" },
  supplierId, placeOfSupply: "27", currency: "INR",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP", uom: "EA", qty: "10", rate: "12500", refs: { poId, poLineNo: 1 } }],
  totals: { taxable: "125000.00", cgst: "11250.00", sgst: "11250.00", igst: "0.00", cess: "0.00", roundOff: "0.00", grand: "147500.00" },
  gst: { irn: "seed-irn-demo-001" },
  source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

await upsert("documents", { groupId, externalRef: "SEED-PAY-2" }, {
  id: `doc_seed_pay2`, groupId, entityId, type: "PAYMENT_OUT", number: "PAY/26-27/0198", externalRef: "SEED-PAY-2",
  date: "2026-10-20", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Shakti Industrial Suppliers Pvt Ltd", supplierId },
  buyer: { name: "Satya Equipment Distribution" },
  currency: "INR",
  lines: [],
  payment: { amount: "80000.00", mode: "NEFT", utr: "UTRN520000123456", valueDate: "2026-10-20",
    allocations: [{ documentId: invId, amount: "80000.00", basis: "remittance" }] },
  source: { channel: "bank_csv" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

const link = async (fromId, toId, kind) => upsert("documentlinks", { groupId, fromId, toId, kind }, {
  id: `lnk_${kind.toLowerCase()}_${fromId.slice(-4)}_${toId.slice(-4)}`, groupId, fromId, toId, kind,
  certainty: "CONFIRMED", basis: "reviewer", createdBy: actor,
});
await link(grnId, poId, "RECEIVES");
await link(invId, poId, "BILLS");
await link(`doc_seed_pay2`, invId, "SETTLES");

const caseId = await upsert("cases", { groupId, kind: "po", subjectIds: [poId] }, {
  id: `case_seed_${poId.slice(-4)}`, groupId, entityId, kind: "po", subjectIds: [poId],
  title: "PO SATYAD/PO/26-27/000777 — Shakti Industrial Suppliers Pvt Ltd", status: "open", revision: 0,
});
await db.collection("documents").updateOne({ id: poId }, { $set: { caseId } });

console.log(`Seeded: PO ${poId}, GRN ${grnId}, INV ${invId}, PAY doc_seed_pay2, case ${caseId}`);
console.log("Run POST /api/v2/cases/" + caseId + "/reconcile to build the snapshot.");
await mongoose.disconnect();
