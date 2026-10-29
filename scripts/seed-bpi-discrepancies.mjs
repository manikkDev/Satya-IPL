#!/usr/bin/env node
// Discrepancy layer on top of BPI-seeded docs (docs/REAL_DATA_BPI_BUILD.md §5):
// injects the classic error taxonomy into a bounded subset of the real-derived
// chains so investigations have real-looking findings at scale.
// All injected docs carry provenance: CONSTRUCTED_DEMO + note in `bpi.injected`.
// Idempotent via externalRef. Run AFTER scripts/seed-bpi-company.mjs.
import mongoose from "../server/node_modules/mongoose/index.js";

const MONGO = process.env.MONGO_URI || "mongodb://localhost:27017/satya";
await mongoose.connect(MONGO);
const db = mongoose.connection.db;
const analyst = await db.collection("users").findOne({ email: "analyst@satya.demo" });
const groupId = analyst.memberships[0].groupId;
const entity = await db.collection("entities").findOne({ groupId });
const actor = analyst.v2id || String(analyst._id);
const N = 15;

const upsert = async (col, key, doc) => {
  const ex = await db.collection(col).findOne(key);
  if (ex) return ex.id;
  await db.collection(col).insertOne({ _id: new mongoose.Types.ObjectId(), ...doc, createdAt: new Date(), updatedAt: new Date() });
  return doc.id;
};
const nextDay = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

// pick BPI POs that already have an invoice + a payment — fertile ground
const pos = await db.collection("documents").find({
  groupId, type: "PO", externalRef: { $regex: "^BPI-po_" },
}).sort({ id: 1 }).limit(N).toArray();
console.log(`Injecting discrepancies across ${pos.length} BPI POs`);

let made = 0;
for (const [i, po] of pos.entries()) {
  const supId = po.supplierId;
  const inv = await db.collection("documents").findOne({ groupId, type: "INVOICE_IN", "lines.refs.poId": po.id });
  const pay = await db.collection("documents").findOne({ groupId, type: "PAYMENT_OUT", "lines.refs.poId": po.id, "payment.allocations.documentId": { $exists: true } })
    || await db.collection("documents").findOne({ groupId, type: "PAYMENT_OUT", externalRef: { $regex: `^BPI-pay_${po.externalRef.slice(4)}` } });
  const mode = i % 3;

  if (mode === 0 && inv) {
    // duplicate invoice: same supplier/amount/date±1, re-numbered
    const num = `${inv.number}-B`;
    await upsert("documents", { groupId, externalRef: `BPI-INJ-DUP-${po.id}` }, {
      id: `doc_bpi_dup_${po.id.slice(8)}`, groupId, entityId: po.entityId, type: "INVOICE_IN",
      number: num.replace("INV/", "INV/0"), externalRef: `BPI-INJ-DUP-${po.id}`,
      date: nextDay(inv.date, 1), fy: inv.fy, status: "posted", revision: 0,
      seller: inv.seller, buyer: inv.buyer, supplierId: inv.supplierId, placeOfSupply: inv.placeOfSupply, currency: "INR",
      lines: inv.lines, totals: inv.totals, gst: {},
      source: { channel: "csv" }, provenance: "CONSTRUCTED_DEMO",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    await upsert("documentlinks", { groupId, fromId: `doc_bpi_dup_${po.id.slice(8)}`, toId: po.id, kind: "BILLS" }, {
      id: `lnk_bpi_dup_${po.id.slice(8)}`, groupId, fromId: `doc_bpi_dup_${po.id.slice(8)}`, toId: po.id, kind: "BILLS",
      certainty: "PROBABLE", basis: "model", confidence: "0.82", createdBy: actor,
    });
    made++;
  } else if (mode === 1) {
    // unallocated payment: no UTR ref to any invoice
    const amount = inv ? inv.totals?.grand : po.totals?.grand;
    const payId = `doc_bpi_payx_${po.id.slice(8)}`;
    await upsert("documents", { groupId, externalRef: `BPI-INJ-PAY-${po.id}` }, {
      id: payId, groupId, entityId: po.entityId, type: "PAYMENT_OUT",
      number: `PAY/26-27/X${String(30000 + i)}`, externalRef: `BPI-INJ-PAY-${po.id}`,
      date: nextDay(po.date, 40), fy: po.fy, status: "posted", revision: 0,
      seller: { name: po.seller?.name, supplierId: supId }, buyer: { name: po.buyer?.name },
      currency: "INR", lines: [],
      payment: { amount, mode: "NEFT",  valueDate: nextDay(po.date, 40), allocations: [] },
      source: { channel: "bank_csv" }, provenance: "CONSTRUCTED_DEMO",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    made++;
  } else if (mode === 2 && inv) {
    // over-billing: invoice grand 15% above PO total
    const id = `doc_bpi_ovb_${po.id.slice(8)}`;
    const up = (v) => (parseFloat(v || "0") * 1.15).toFixed(2);
    await upsert("documents", { groupId, externalRef: `BPI-INJ-OVB-${po.id}` }, {
      id, groupId, entityId: po.entityId, type: "INVOICE_IN",
      number: `INV/X${String(91000 + i)}`, externalRef: `BPI-INJ-OVB-${po.id}`,
      date: nextDay(po.date, 30), fy: po.fy, status: "posted", revision: 0,
      seller: inv.seller, buyer: inv.buyer, supplierId: inv.supplierId, placeOfSupply: inv.placeOfSupply, currency: "INR",
      lines: inv.lines.map((l) => ({ ...l, rate: up(l.rate) })),
      totals: { taxable: up(inv.totals?.taxable), cgst: up(inv.totals?.cgst), sgst: up(inv.totals?.sgst), igst: up(inv.totals?.igst), cess: "0.00", roundOff: "0.00", grand: up(inv.totals?.grand) },
      gst: {}, bpi: { injected: "over_billing", of: inv.id },
      source: { channel: "csv" }, provenance: "CONSTRUCTED_DEMO",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    await upsert("documentlinks", { groupId, fromId: id, toId: po.id, kind: "BILLS" }, {
      id: `lnk_bpi_ovb_${po.id.slice(8)}`, groupId, fromId: id, toId: po.id, kind: "BILLS",
      certainty: "CONFIRMED", basis: "reference", createdBy: actor,
    });
    made++;
  }
}
console.log(`Injected ${made} discrepancy docs. Reconcile those cases to see findings.`);
await mongoose.disconnect();
