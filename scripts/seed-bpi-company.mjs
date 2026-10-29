#!/usr/bin/env node
// BPI-2019 company seed (docs/REAL_DATA_BPI_BUILD.md): loads the extracted real
// procurement history (ml-fl-service/assets/bpi_company.jsonl.gz) into the demo
// group as a full working company — named MSME suppliers, items, PO/GRN/invoice/
// payment documents + links + cases. Events are REAL (BPI-2019); identities and
// INR restatement are synthetic -> provenance: CONSTRUCTED_DEMO everywhere.
// Idempotent via externalRef keys. Run: node scripts/seed-bpi-company.mjs
import mongoose from "../server/node_modules/mongoose/index.js";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const MONGO = process.env.MONGO_URI || "mongodb://localhost:27017/satya";
const EUR_TO_INR = 90; // synthetic restatement, flagged in copy

const art = JSON.parse(gunzipSync(readFileSync(new URL("../ml-fl-service/assets/bpi_company.jsonl.gz", import.meta.url))).toString());
await mongoose.connect(MONGO);
const db = mongoose.connection.db;

const analyst = await db.collection("users").findOne({ email: "analyst@satya.demo" });
if (!analyst?.memberships?.length) { console.error("analyst@satya.demo missing — run v1 demo seed first."); process.exit(1); }
const groupId = analyst.memberships[0].groupId;
const entities = await db.collection("entities").find({ groupId }).sort({ createdAt: 1 }).toArray();
const entityId = entities[0].id;
const buyerEnt = entities[0];
const actor = analyst.v2id || String(analyst._id);
console.log(`Seeding BPI company into group ${groupId}, entity ${entityId} — ${art.meta.poCount} POs`);

const upsert = async (col, key, doc) => {
  const existing = await db.collection(col).findOne(key);
  if (existing) return existing.id;
  await db.collection(col).insertOne({ _id: new mongoose.Types.ObjectId(), ...doc, createdAt: new Date(), updatedAt: new Date() });
  return doc.id;
};
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const inr = (eur) => eur == null ? "0.00" : (parseFloat(eur) * EUR_TO_INR).toFixed(2);
const fyOf = (dateStr) => { // map BPI date -> FY 2026-27 window (synthetic shift)
  const [, m, d] = (dateStr || "2018-01-01").split("-");
  const month = +m;
  const year = month >= 4 ? 2026 : 2027;
  const fy = month >= 4 ? "2026-27" : "2026-27";
  return { date: `${year}-${m}-${d}`, fy };
};

// --- identity layer: vendorID_x -> named MSME supplier (spend-aware) ---
const NAMES = {
  "Logistics": ["SwiftHaul Carriers Pvt Ltd", "Deccan Roadlines LLP", "Vayu Freight & Transport"],
  "Packaging": ["Kalpataru Packaging Industries", "Shree Corrupack Pvt Ltd", "Nexa Packsystems LLP"],
  "Raw materials": ["Arka Chemicals & Intermediates", "Padma Resins Pvt Ltd", "Trimurti Pigments Ltd"],
  "MRO": ["Bhavna Engineering Stores", "Rathore Industrial Supplies", "Omkar Bearings & Drives"],
};
const CAT = { "Logistics": "micro", "Packaging": "small", "Raw materials": "small", "MRO": "small" };
const STATES = ["27", "24", "33", "06", "09"];
const HSNS = { "Logistics": "996511", "Packaging": "4819", "Raw materials": "3206", "MRO": "7318" };
const supplierCache = {};
const supplierOf = async (v) => {
  if (supplierCache[v.id]) return supplierCache[v.id];
  const spend = v.topSpend || "MRO";
  const pool = NAMES[spend] || NAMES.MRO;
  const idx = parseInt(hash(v.id), 16) % pool.length;
  const legalName = `${pool[idx]} (Unit ${String(parseInt(v.id.replace(/\D/g, "")) % 90 + 10)})`;
  const st = STATES[parseInt(hash(v.id + "s"), 16) % STATES.length];
  const CH36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const cd_ = (x) => { let sm = 0; for (let i = 0; i < 14; i++) { const p = CH36.indexOf(x[i]) * (i % 2 === 0 ? 1 : 2); sm += Math.floor(p / 36) + (p % 36); } return CH36[(36 - (sm % 36)) % 36]; };
  const pan_ = `AAA${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[idx]}${hash(v.id).slice(1, 5).toUpperCase()}A`;
  const s14 = `${st}${pan_}1Z`;
  const gstin = s14 + cd_(s14);
  const msme = true, category = CAT[spend] || "small";
  const id = `sup_bpi_${hash(v.id).slice(0, 10)}`;
  const sid = await upsert("suppliers", { groupId, id }, {
    id, groupId, entityId, legalName,
    gstins: [{ gstin, stateCode: st, status: "active" }],
    pan: pan_,
    udyam: { number: `UDYAM-${st === "27" ? "MH" : st === "24" ? "GJ" : "TN"}-${String(10 + (idx % 20))}-00${hash(v.id).slice(0, 5)}`, category },
    msme, paymentTermsDays: category === "micro" ? 45 : 30,
    bankAccounts: [{ masked: `••••${hash(v.id + "b").slice(0, 4)}`, ifsc: `HDFC000${String(1000 + (idx % 900))}`, accountHash: hash(v.id + "acct"), status: "active" }],
    addresses: [{ label: "Registered office", line1: `Plot ${10 + idx}, MIDC Industrial Area`, city: st === "27" ? "Pune" : st === "24" ? "Ahmedabad" : "Chennai", stateCode: st, pin: `4${String(10000 + idx * 7).slice(0, 5)}` }],
    status: "active", tags: [spend.toLowerCase()], source: { bpi: v.id },
    provenance: "CONSTRUCTED_DEMO", createdBy: actor,
  });
  supplierCache[v.id] = { id: sid, legalName, gstin, stateCode: st, spend };
  return supplierCache[v.id];
};

// --- items master: one per (spend, subSpend) w/ real HSN ---
const itemCache = {};
const itemOf = async (spend, subSpend) => {
  const key = `${spend}|${subSpend}`;
  if (itemCache[key]) return itemCache[key];
  const id = `itm_bpi_${hash(key).slice(0, 10)}`;
  await upsert("items", { groupId, id }, {
    id, groupId, code: id.toUpperCase(), description: `${subSpend || spend} (${spend})`,
    hsn: HSNS[spend] || "9987", uom: "EA", defaultGstRate: "18",
    source: { bpi: key }, provenance: "CONSTRUCTED_DEMO", createdBy: actor,
  });
  itemCache[key] = { id, description: `${subSpend || spend}`, hsn: HSNS[spend] || "9987" };
  return itemCache[key];
};

// --- documents ---
const idOf = {}, vendorsById = Object.fromEntries(art.vendors.map((v) => [v.id, v]));
let n = { PO: 0, GRN: 0, INVOICE_IN: 0, PAYMENT_OUT: 0 };
const invOfPo = {};
for (const d of art.documents) {
  const vendor = vendorsById[d.vendor] || { id: d.vendor, topSpend: "MRO" };
  const sup = await supplierOf(vendor);
  const extRef = `BPI-${d.id}`;
  if (d.type === "PO") {
    const { date, fy } = fyOf(d.date);
    const lines = await Promise.all(d.lines.map(async (l) => {
      const it = await itemOf(l.spend, l.subSpend);
      return { lineNo: l.lineNo, description: `${it.description} — ${l.subSpend || l.spend}`, hsn: it.hsn, uom: "EA", qty: "1", rate: inr(l.valueEUR) };
    }));
    const taxable = lines.reduce((a, l) => a + parseFloat(l.rate), 0).toFixed(2);
    const gst = (parseFloat(taxable) * 0.18).toFixed(2);
    const id = `doc_bpi_${d.id}`;
    idOf[d.id] = await upsert("documents", { groupId, externalRef: extRef }, {
      id, groupId, entityId, type: "PO", number: `${buyerEnt.code || "MCG"}/PO/26-27/${String(100000 + n.PO)}`, externalRef: extRef,
      date, fy, status: "issued", revision: 1,
      seller: { name: sup.legalName, gstin: sup.gstin, stateCode: sup.stateCode, supplierId: sup.id },
      buyer: { name: buyerEnt.legalName, gstin: buyerEnt.gstins?.[0]?.gstin, stateCode: buyerEnt.stateCode || "27" },
      supplierId: sup.id, placeOfSupply: sup.stateCode, currency: "INR",
      lines, totals: { taxable, cgst: sup.stateCode === "27" ? (parseFloat(gst) / 2).toFixed(2) : "0.00", sgst: sup.stateCode === "27" ? (parseFloat(gst) / 2).toFixed(2) : "0.00", igst: sup.stateCode === "27" ? "0.00" : gst, cess: "0.00", roundOff: "0.00", grand: (parseFloat(taxable) + parseFloat(gst)).toFixed(2) },
      terms: { paymentTerms: `${category(d)} days`, creditDays: 45 }, gst: {},
      source: { channel: "csv" }, provenance: "CONSTRUCTED_DEMO",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    n.PO++;
  } else if (d.type === "GRN") {
    const { date, fy } = fyOf(d.date);
    const id = `doc_bpi_${d.id}`;
    idOf[d.id] = await upsert("documents", { groupId, externalRef: extRef }, {
      id, groupId, entityId, type: "GRN", number: `GRN/26-27/${String(40000 + n.GRN)}`, externalRef: extRef,
      date, fy, status: "confirmed", revision: 0,
      seller: { name: sup.legalName, supplierId: sup.id }, buyer: { name: buyerEnt.legalName },
      currency: "INR", lines: [{ lineNo: 1, description: `Goods receipt — ${d.bpiItem}`, uom: "EA", qty: "1", refs: { poId: idOf[d.po], poLineNo: 1 } }], source: { channel: "csv" }, provenance: "CONSTRUCTED_DEMO",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    n.GRN++;
  } else if (d.type === "INVOICE_IN") {
    const { date, fy } = fyOf(d.date);
    const id = `doc_bpi_${d.id}`;
    const val = inr(d.valueEUR);
    const taxable = (parseFloat(val) / 1.18).toFixed(2);
    const gst = (parseFloat(val) - parseFloat(taxable)).toFixed(2);
    invOfPo[d.po] = id;
    idOf[d.id] = await upsert("documents", { groupId, externalRef: extRef }, {
      id, groupId, entityId, type: "INVOICE_IN", number: `INV/${sup.legalName.slice(0, 3).toUpperCase()}/${String(80000 + n.INVOICE_IN)}`, externalRef: extRef,
      date, fy, status: "posted", revision: 0,
      seller: { name: sup.legalName, gstin: sup.gstin, stateCode: sup.stateCode, supplierId: sup.id },
      buyer: { name: buyerEnt.legalName, gstin: buyerEnt.gstins?.[0]?.gstin, stateCode: "27" },
      supplierId: sup.id, placeOfSupply: sup.stateCode, currency: "INR",
      lines: [{ lineNo: 1, description: `Invoice — ${d.bpiItem}`, uom: "EA", qty: "1", rate: taxable, refs: { poId: idOf[d.po], poLineNo: 1 } }],
      totals: { taxable, cgst: sup.stateCode === "27" ? (parseFloat(gst) / 2).toFixed(2) : "0.00", sgst: sup.stateCode === "27" ? (parseFloat(gst) / 2).toFixed(2) : "0.00", igst: sup.stateCode === "27" ? "0.00" : gst, cess: "0.00", roundOff: "0.00", grand: val },
      gst: {},
      source: { channel: "csv" }, provenance: "CONSTRUCTED_DEMO",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    n.INVOICE_IN++;
  } else if (d.type === "PAYMENT_OUT") {
    const { date, fy } = fyOf(d.date);
    const id = `doc_bpi_${d.id}`;
    idOf[d.id] = await upsert("documents", { groupId, externalRef: extRef }, {
      id, groupId, entityId, type: "PAYMENT_OUT", number: `PAY/26-27/${String(20000 + n.PAYMENT_OUT)}`, externalRef: extRef,
      date, fy, status: "posted", revision: 0,
      seller: { name: sup.legalName, supplierId: sup.id }, buyer: { name: buyerEnt.legalName },
      currency: "INR", lines: [],
      payment: { amount: inr(d.valueEUR), mode: "NEFT", utr: `UTRBPI${hash(d.id).slice(0, 12).toUpperCase()}`, valueDate: date,
        allocations: invOfPo[d.po] ? [{ documentId: invOfPo[d.po], amount: inr(d.valueEUR), basis: "remittance" }] : [] }, source: { channel: "bank_csv" }, provenance: "CONSTRUCTED_DEMO",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    n.PAYMENT_OUT++;
  }
}
function category() { return 45; }

// --- links + cases ---
const link = async (fromId, toId, kind) => {
  if (!idOf[fromId] || !idOf[toId]) return;
  await upsert("documentlinks", { groupId, fromId: idOf[fromId], toId: idOf[toId], kind }, {
    id: `lnk_bpi_${hash(fromId + toId + kind).slice(0, 12)}`, groupId,
    fromId: idOf[fromId], toId: idOf[toId], kind,
    certainty: "CONFIRMED", basis: "reference", createdBy: actor,
  });
};
for (const l of art.links) await link(l.from, l.to, l.kind);
for (const d of art.documents.filter((x) => x.type === "PO")) {
  const pid = idOf[d.id];
  if (!pid) continue;
  const cid = await upsert("cases", { groupId, kind: "po", subjectIds: [pid] }, {
    id: `case_bpi_${d.id}`, groupId, entityId, kind: "po", subjectIds: [pid],
    title: `${d.id} — ${vendorsById[d.vendor]?.id || d.vendor} (BPI ${d.bpiDoc || "trace"})`,
    status: "open", revision: 0,
  });
  await db.collection("documents").updateOne({ id: pid }, { $set: { caseId: cid } });
}

console.log(`Done: ${n.PO} POs, ${n.GRN} GRNs, ${n.INVOICE_IN} invoices, ${n.PAYMENT_OUT} payments, ${Object.keys(supplierCache).length} suppliers, cases per PO.`);
await mongoose.disconnect();
