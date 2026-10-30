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

// ---- showcase chain: every stage populated so investigations, money trail,
// compliance and payments demo the full product on a real data spine.
const kaveri = await upsert("suppliers", { groupId, legalName: "Kaveri Pumps & Motors Ltd" }, {
  id: `sup_demo_kaveri`, groupId, entityId, legalName: "Kaveri Pumps & Motors Ltd",
  gstins: [{ gstin: "29AAACK1234M1ZP", stateCode: "29", status: "active" }],
  udyam: { number: "UDYAM-KA-20-0023456", category: "micro" }, msme: true,
  paymentTermsDays: 45, status: "active", createdBy: actor,
});

const PO2 = await upsert("documents", { groupId, externalRef: "SHOW-PO-1" }, {
  id: `doc_demo_po1`, groupId, entityId, type: "PO", number: "SATYAD/PO/26-27/000888", externalRef: "SHOW-PO-1",
  date: "2026-08-20", fy: "2026-27", status: "issued", revision: 1,
  seller: { name: "Kaveri Pumps & Motors Ltd", gstin: "29AAACK1234M1ZP", stateCode: "29", supplierId: kaveri },
  buyer: { name: "Satya Equipment Distribution", gstin: "27AAACS1234A1Z5", stateCode: "27" },
  supplierId: kaveri, placeOfSupply: "29", currency: "INR",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP", hsn: "8413", uom: "EA", qty: "45", rate: "10000", gstRate: "18" }],
  totals: { taxable: "450000.00", cgst: "0.00", sgst: "0.00", igst: "81000.00", cess: "0.00", roundOff: "0.00", grand: "531000.00" },
  terms: { paymentTerms: "45 days", creditDays: 45 }, gst: {},
  source: { channel: "created_in_satya" }, provenance: "USER_PROVIDED",
  observedAt: new Date().toISOString(), createdBy: actor,
});

const GRN1 = await upsert("documents", { groupId, externalRef: "SHOW-GRN-1" }, {
  id: `doc_demo_grn1`, groupId, entityId, type: "GRN", number: "GRN/26-27/0912", externalRef: "SHOW-GRN-1",
  date: "2026-09-05", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Kaveri Pumps & Motors Ltd", stateCode: "29", supplierId: kaveri },
  buyer: { name: "Satya Equipment Distribution", stateCode: "27" }, currency: "INR",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP", uom: "EA", qty: "38", refs: { poId: PO2, poLineNo: 1 } }],
  source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

const QC1 = await upsert("documents", { groupId, externalRef: "SHOW-QC-1" }, {
  id: `doc_demo_qc1`, groupId, entityId, type: "QC", number: "QC/26-27/0199", externalRef: "SHOW-QC-1",
  date: "2026-09-06", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Kaveri Pumps & Motors Ltd", supplierId: kaveri },
  buyer: { name: "Satya Equipment Distribution" }, currency: "INR",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP — 2 units failed bench test", uom: "EA", qty: "2", refs: { grnId: GRN1 } }],
  source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

const INV1 = await upsert("documents", { groupId, externalRef: "SHOW-INV-1" }, {
  id: `doc_demo_inv1`, groupId, entityId, type: "INVOICE_IN", externalRef: "SHOW-INV-1", number: "KAV/26-27/4410",
  date: "2026-09-10", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Kaveri Pumps & Motors Ltd", gstin: "29AAACK1234M1ZP", stateCode: "29", supplierId: kaveri },
  buyer: { name: "Satya Equipment Distribution", gstin: "27AAACS1234A1Z5", stateCode: "27" },
  supplierId: kaveri, placeOfSupply: "29", currency: "INR",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP", uom: "EA", qty: "45", rate: "10000", gstRate: "18", refs: { poId: PO2, poLineNo: 1 } }],
  totals: { taxable: "450000.00", cgst: "0.00", sgst: "0.00", igst: "81000.00", cess: "0.00", roundOff: "0.00", grand: "531000.00" },
  gst: { irn: "a1b2c3d4e5f6g7h8-demo" },
  source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

const CN1 = await upsert("documents", { groupId, externalRef: "SHOW-CN-1" }, {
  id: `doc_demo_cn1`, groupId, entityId, type: "CREDIT_NOTE_IN", externalRef: "SHOW-CN-1", number: "CN-KAV/0088",
  date: "2026-09-15", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Kaveri Pumps & Motors Ltd", gstin: "29AAACK1234M1ZP", supplierId: kaveri },
  buyer: { name: "Satya Equipment Distribution", gstin: "27AAACS1234A1Z5" },
  supplierId: kaveri, currency: "INR",
  lines: [{ lineNo: 1, description: "Adjustment for rejected units", uom: "EA", qty: "2", rate: "10000", refs: { invoiceId: INV1 } }],
  totals: { taxable: "20000.00", cgst: "0.00", sgst: "0.00", igst: "3600.00", cess: "0.00", roundOff: "0.00", grand: "23600.00" },
  source: { channel: "api" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

await upsert("documents", { groupId, externalRef: "SHOW-PAY-1" }, {
  id: `doc_demo_pay1`, groupId, entityId, type: "PAYMENT_OUT", number: "PAY/26-27/0310", externalRef: "SHOW-PAY-1",
  date: "2026-10-22", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Kaveri Pumps & Motors Ltd", supplierId: kaveri },
  buyer: { name: "Satya Equipment Distribution" }, currency: "INR", lines: [],
  payment: { amount: "300000.00", mode: "NEFT", utr: "UTRN990000778801", valueDate: "2026-10-22",
    allocations: [{ documentId: INV1, amount: "300000.00", basis: "remittance" }] },
  source: { channel: "bank_csv" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

await upsert("documents", { groupId, externalRef: "SHOW-PAY-2" }, {
  id: `doc_demo_pay2`, groupId, entityId, type: "PAYMENT_OUT", number: "PAY/26-27/0321", externalRef: "SHOW-PAY-2",
  date: "2026-10-26", fy: "2026-27", status: "posted", revision: 0,
  seller: { name: "Kaveri Pumps & Motors Ltd", supplierId: kaveri },
  buyer: { name: "Satya Equipment Distribution" }, currency: "INR", lines: [],
  payment: { amount: "95000.00", mode: "NEFT", valueDate: "2026-10-26", allocations: [] },
  source: { channel: "bank_csv" }, provenance: "CONSTRUCTED_DEMO", observedAt: new Date().toISOString(), createdBy: actor,
});

await link(GRN1, PO2, "RECEIVES");
await link(QC1, GRN1, "INSPECTS");
await link(INV1, PO2, "BILLS");
await link(INV1, GRN1, "BILLS");
await link(CN1, INV1, "ADJUSTS");
await link(`doc_demo_pay1`, INV1, "SETTLES");

const caseDemo = await upsert("cases", { groupId, kind: "po", subjectIds: [PO2] }, {
  id: `case_seed_showcase`, groupId, entityId, kind: "po", subjectIds: [PO2],
  title: "PO SATYAD/PO/26-27/000888 — Kaveri Pumps & Motors Ltd", status: "open", revision: 0,
});
await db.collection("documents").updateOne({ id: PO2 }, { $set: { caseId: caseDemo } });

console.log(`Seeded: PO ${poId}, GRN ${grnId}, INV ${invId}, PAY doc_seed_pay2, case ${caseId}`);
console.log(`Showcase: PO ${PO2} -> GRN ${GRN1} -> QC ${QC1} -> INV ${INV1} -> CN ${CN1} -> PAY doc_demo_pay1 (+doc_demo_pay2 unallocated), case ${caseDemo}`);
console.log("Run POST /api/v2/cases/" + caseId + "/reconcile and /cases/" + caseDemo + "/reconcile to build snapshots.");
await mongoose.disconnect();
