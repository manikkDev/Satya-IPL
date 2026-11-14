// Resolve normalised import records (from Tally XML or CSV/XLSX templates)
// against what Satya already holds, then write them idempotently.
//
// plan()   — dry run: per record an action (create / update / unchanged /
//            duplicate / error) plus the references it will link (supplier,
//            PO, GRN, invoice) and warnings. Nothing is written.
// commit() — same resolution, then writes masters first (suppliers, items),
//            then documents in dependency order (PO -> GRN -> QC -> invoice
//            -> return / notes -> payment) so references inside one file
//            resolve. Re-running the same file creates nothing new: every
//            document carries externalRef "imp:<TYPE>:<party>:<FY>:<number>"
//            and also dedupes against documents that arrived another way
//            (PDF upload, e-invoice) by supplier + normalised number + FY.
// Unresolved references (a GRN for a PO not yet imported) are kept as text
// on the line (refs.poNumber) with source.pendingRefs = true; the auto-check
// binds them when the PO arrives.
import Document from "../../models/Document.js";
import Supplier from "../../models/Supplier.js";
import Item from "../../models/Item.js";
import Entity from "../../models/Entity.js";
import { newId } from "../../lib/ids.js";
import { fyOf } from "../../lib/fy.js";
import { toPaise, fromPaise, mulRate } from "../../lib/money.js";
import { maskAccount, accountHash } from "../bankAccounts.js";
import { normInvNo, normName, checkGstin } from "./normalize.js";

export const TYPE_ORDER = ["PO", "GRN", "QC", "INVOICE_IN", "RETURN", "DEBIT_NOTE_OUT", "CREDIT_NOTE_IN", "PAYMENT_OUT"];
const STATUS_FOR = { PO: "issued", GRN: "confirmed", QC: "confirmed", RETURN: "confirmed", INVOICE_IN: "posted", DEBIT_NOTE_OUT: "posted", CREDIT_NOTE_IN: "posted", PAYMENT_OUT: "posted" };
const DOC_FIELDS = { id: 1, type: 1, number: 1, externalRef: 1, date: 1, fy: 1, seller: 1, supplierId: 1, status: 1, entityId: 1, "lines.lineNo": 1, "lines.sku": 1, "lines.description": 1, "lines.itemId": 1, "lines.refs": 1, "totals.grand": 1, "payment.utr": 1 };

const warn = (message, field) => ({ severity: "warning", field, message });
const err = (message, field) => ({ severity: "error", field, message });

// ---------- context ----------
export const loadContext = async ({ groupId, entityId, actor, importRunId = null, provenance = "USER_PROVIDED" }) => {
  const entity = await Entity.findOne({ id: entityId, groupId }).lean();
  if (!entity) throw Object.assign(new Error("Entity not found"), { status: 404, code: "NOT_FOUND" });
  const ctx = {
    groupId, entityId, actor, importRunId, provenance, entity,
    buyer: { name: entity.legalName, ...(entity.gstin ? { gstin: entity.gstin } : {}), ...(entity.stateCode ? { stateCode: entity.stateCode } : {}), ...(entity.pan ? { pan: entity.pan } : {}) },
    suppliers: [], byGstin: new Map(), byPan: new Map(), byName: new Map(),
    items: null, docIndex: new Map(), pending: new Map(), planned: new Map(),
  };
  const sups = await Supplier.find({ groupId }, { id: 1, legalName: 1, tradeNames: 1, gstins: 1, pan: 1, udyam: 1, msme: 1, paymentTermsDays: 1, tdsSection: 1, contacts: 1, addresses: 1, aatoBand: 1, einvoiceApplicable: 1, "bankAccounts.accountHash": 1 }).lean();
  sups.forEach((s) => indexSupplier(ctx, s));
  return ctx;
};

export const indexSupplier = (ctx, s) => {
  if (!ctx.suppliers.includes(s)) ctx.suppliers.push(s);
  for (const g of s.gstins || []) if (g?.gstin) ctx.byGstin.set(g.gstin.toUpperCase(), s);
  if (s.pan) ctx.byPan.set(s.pan.toUpperCase(), s);
  for (const n of [s.legalName, ...(s.tradeNames || [])]) { const k = normName(n); if (k && !ctx.byName.has(k)) ctx.byName.set(k, s); }
};

/** Supplier master for a party reference {name, gstin}. */
export const findSupplier = (ctx, party) => {
  const gstin = String(party?.gstin || "").toUpperCase();
  if (gstin && ctx.byGstin.has(gstin)) return { supplier: ctx.byGstin.get(gstin), by: "gstin" };
  if (gstin) {
    const pan = gstin.slice(2, 12);
    if (ctx.byPan.has(pan)) return { supplier: ctx.byPan.get(pan), by: "pan", newBranch: true };
  }
  const k = normName(party?.name);
  if (k && ctx.byName.has(k)) {
    const s = ctx.byName.get(k);
    // a different GSTIN under the same name is a different registration, not a match
    const known = (s.gstins || []).map((g) => g.gstin);
    if (gstin && known.length && !known.includes(gstin) && s.pan && gstin.slice(2, 12) !== s.pan) return { supplier: null, by: null, nameClash: s };
    return { supplier: s, by: "name" };
  }
  return { supplier: null, by: null };
};

const getItems = async (ctx) => {
  if (!ctx.items) {
    const items = await Item.find({ groupId: ctx.groupId }, { id: 1, code: 1, description: 1, hsn: 1, uom: 1, defaultGstRate: 1, aliases: 1 }).lean();
    ctx.items = new Map(items.map((i) => [i.code.toUpperCase(), i]));
    ctx.itemsByDesc = new Map(items.map((i) => [normName(i.description), i]));
  }
  return ctx.items;
};

const indexFor = async (ctx, type) => {
  if (!ctx.docIndex.has(type)) {
    const types = type === "PO" ? ["PO", "PO_AMENDMENT"] : [type];
    const docs = await Document.find({ groupId: ctx.groupId, type: { $in: types }, status: { $nin: ["cancelled", "draft", "rejected"] } }, DOC_FIELDS).limit(50000).lean();
    const idx = new Map();
    for (const d of docs) addToIndex(idx, d);
    ctx.docIndex.set(type, idx);
  }
  return ctx.docIndex.get(type);
};
const addToIndex = (idx, d) => {
  const keys = new Set([normInvNo(d.number), normInvNo(String(d.externalRef || "").split(":").pop())].filter(Boolean));
  for (const k of keys) { if (!idx.has(k)) idx.set(k, []); idx.get(k).push(d); }
};

const sameParty = (doc, party, master) => {
  const g = String(party?.gstin || "").toUpperCase();
  if (g && doc.seller?.gstin && doc.seller.gstin.toUpperCase() === g) return true;
  if (master && (doc.supplierId === master.id || doc.seller?.supplierId === master.id)) return true;
  if (party?.name && normName(doc.seller?.name) === normName(party.name)) return true;
  return false;
};

/** Find an existing (or planned-in-this-file) document by number. */
export const findDoc = async (ctx, type, number, party, master, { requireParty = true, fy } = {}) => {
  const key = normInvNo(number);
  if (!key) return null;
  const idx = await indexFor(ctx, type);
  const cands = (idx.get(key) || []).filter((d) => !fy || d.fy === fy);
  const planned = (ctx.planned.get(type)?.get(key) || []).filter((d) => !fy || d.fy === fy);
  const all = [...cands, ...planned];
  if (!all.length) return null;
  const byParty = all.filter((d) => sameParty(d, party, master));
  if (byParty.length) return byParty[0];
  if (!requireParty && all.length === 1) return all[0];
  return null;
};

const remember = (ctx, type, doc) => {
  if (!ctx.planned.has(type)) ctx.planned.set(type, new Map());
  addToIndex(ctx.planned.get(type), doc);
};

// ---------- money helpers ----------
const lineTaxable = (l) => {
  if (l.taxableValue) return toPaise(l.taxableValue);
  if (!l.qty || !l.rate) return 0n;
  let v = toPaise(mulRate(l.rate, String(l.qty)));
  if (l.discountPct && Number(l.discountPct) > 0) v -= toPaise(mulRate(fromPaise(v), (Number(l.discountPct) / 100).toFixed(6)));
  return v;
};
export const computeTotals = (lines, sellerState, buyerState) => {
  let taxable = 0n; let tax = 0n;
  for (const l of lines) {
    const t = lineTaxable(l);
    taxable += t;
    if (l.gstRate) tax += toPaise(mulRate(fromPaise(t), (Number(l.gstRate) / 100).toFixed(6)));
  }
  const intra = !sellerState || !buyerState || sellerState === buyerState;
  const half = tax / 2n;
  return {
    taxable: fromPaise(taxable),
    cgst: fromPaise(intra ? half : 0n), sgst: fromPaise(intra ? tax - half : 0n), igst: fromPaise(intra ? 0n : tax),
    cess: "0.00", roundOff: "0.00", grand: fromPaise(taxable + tax),
  };
};

const partyKeyOf = (party, master) => String(party?.gstin || master?.id || normName(party?.name) || "unknown").toUpperCase().replace(/\s+/g, "_");
export const externalRefFor = (type, party, master, fy, number) => `imp:${type}:${partyKeyOf(party, master)}:${fy}:${normInvNo(number)}`;

// ---------- planning ----------
const supplierFields = (rec, existing) => {
  const set = {};
  const missing = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
  if (rec.pan && missing(existing.pan)) set.pan = rec.pan;
  if (rec.udyam && missing(existing.udyam?.number) && rec.msmeCategory) { set.udyam = { number: rec.udyam, category: rec.msmeCategory }; set.msme = true; }
  if (rec.paymentTermsDays !== undefined && (existing.paymentTermsDays === undefined || existing.paymentTermsDays === 30) && rec.paymentTermsDays !== existing.paymentTermsDays) set.paymentTermsDays = rec.paymentTermsDays;
  if (rec.tdsSection && missing(existing.tdsSection)) set.tdsSection = rec.tdsSection;
  if (rec.aatoBand && missing(existing.aatoBand)) set.aatoBand = rec.aatoBand;
  if (rec.einvoiceApplicable !== undefined && existing.einvoiceApplicable === undefined) set.einvoiceApplicable = rec.einvoiceApplicable;
  if ((rec.email || rec.phone) && missing(existing.contacts)) set.contacts = [{ name: rec.contactName || rec.legalName, ...(rec.email && /\S+@\S+\.\S+/.test(rec.email) ? { email: rec.email } : {}), ...(rec.phone ? { phone: rec.phone.slice(0, 20) } : {}) }];
  if (rec.address && missing(existing.addresses)) set.addresses = [{ label: "Registered", ...Object.fromEntries(Object.entries(rec.address).filter(([, v]) => v)) }];
  return set;
};

const planSupplier = (ctx, rec, seenInFile) => {
  const issues = [...(rec.issues || [])];
  if (issues.some((i) => i.severity === "error")) return { action: "error", issues };
  const fileKey = rec.gstin || normName(rec.legalName);
  if (seenInFile.has(fileKey)) return { action: "duplicate", issues: [...issues, warn(`Same supplier appears twice in this file (${rec.legalName})`)] };
  seenInFile.add(fileKey);
  const { supplier, by, newBranch, nameClash } = findSupplier(ctx, { name: rec.legalName, gstin: rec.gstin });
  if (nameClash) issues.push(warn(`A supplier named "${nameClash.legalName}" already exists with a different PAN — created as a separate supplier; merge if it is the same business`));
  if (!supplier) return { action: "create", issues };
  const set = supplierFields(rec, supplier);
  const addGstin = rec.gstin && !(supplier.gstins || []).some((g) => g.gstin === rec.gstin) ? rec.gstin : null;
  if (newBranch && addGstin) issues.push(warn(`Same PAN as ${supplier.legalName} — GSTIN ${rec.gstin} added as another registration of that supplier`));
  const hasBank = rec.bank && !(supplier.bankAccounts || []).some((b) => b.accountHash === accountHash(rec.bank.accountNo, rec.bank.ifsc));
  if (!Object.keys(set).length && !addGstin && !hasBank) return { action: "unchanged", supplierId: supplier.id, matchedBy: by, issues };
  return { action: "update", supplierId: supplier.id, matchedBy: by, set, addGstin, addBank: hasBank ? rec.bank : null, issues, changes: [...Object.keys(set), ...(addGstin ? ["gstin"] : []), ...(hasBank ? ["bank account (pending approval)"] : [])] };
};

const planItem = async (ctx, rec, seenInFile) => {
  const issues = [...(rec.issues || [])];
  if (issues.some((i) => i.severity === "error")) return { action: "error", issues };
  if (seenInFile.has(rec.code)) return { action: "duplicate", issues: [...issues, warn(`Item ${rec.code} appears twice in this file`)] };
  seenInFile.add(rec.code);
  const items = await getItems(ctx);
  const existing = items.get(rec.code.toUpperCase());
  if (!existing) return { action: "create", issues };
  const set = {};
  if (rec.hsn && !existing.hsn) set.hsn = rec.hsn;
  if (rec.gstRate && !existing.defaultGstRate) set.defaultGstRate = rec.gstRate;
  return Object.keys(set).length ? { action: "update", itemId: existing.id, set, issues, changes: Object.keys(set) } : { action: "unchanged", itemId: existing.id, issues };
};

const matchPoLine = (po, l) => {
  if (!po?.lines?.length) return undefined;
  if (l.poLineNo && po.lines.some((x) => x.lineNo === l.poLineNo)) return l.poLineNo;
  const sku = String(l.sku || "").toUpperCase();
  if (sku) { const m = po.lines.find((x) => String(x.sku || "").toUpperCase() === sku); if (m) return m.lineNo; }
  const d = normName(l.description || l.stockItem);
  if (d) { const m = po.lines.find((x) => normName(x.description) === d || normName(x.sku) === d); if (m) return m.lineNo; }
  if (po.lines.length === 1) return po.lines[0].lineNo;
  return undefined;
};

const planDocument = async (ctx, rec) => {
  const issues = [...(rec.issues || [])];
  const notes = [];
  if (!rec.number) issues.push(err("Document number is missing", "number"));
  if (!rec.date) issues.push(err("Document date is missing or invalid", "date"));
  if (issues.some((i) => i.severity === "error")) return { action: "error", issues, notes };
  const fy = fyOf(rec.invoiceDate || rec.date);
  const party = rec.supplier || {};
  const found = findSupplier(ctx, party);
  const master = found.supplier;
  if (!master) {
    if (party.gstin || (party.name && party.name !== "Unknown party")) notes.push(`new supplier ${party.name || party.gstin} will be added to the master`);
    else issues.push(err("No supplier GSTIN or name — cannot tell who this document is from", "supplier"));
  }
  if (issues.some((i) => i.severity === "error")) return { action: "error", issues, notes };

  // duplicates: already imported, or the same document arrived another way
  if (rec.type === "PAYMENT_OUT" && rec.payment?.utr) {
    const dup = await Document.findOne({ groupId: ctx.groupId, type: { $in: ["PAYMENT_OUT", "ADVANCE_OUT"] }, "payment.utr": rec.payment.utr }, { id: 1 }).lean();
    if (dup) return { action: "duplicate", existingId: dup.id, issues: [...issues, warn(`Payment with UTR ${rec.payment.utr} already exists (${dup.id})`)], notes };
  }
  const existing = await findDoc(ctx, rec.type, rec.number, party, master, { requireParty: rec.type !== "PO", fy });
  if (existing) return { action: "duplicate", existingId: existing.id, issues: [...issues, warn(`${rec.type} ${rec.number} is already in Satya${existing.id ? ` (${existing.id})` : " earlier in this file"} — skipped`)], notes };

  // references
  const lines = [];
  let pending = false;
  for (const [i, l] of (rec.lines || []).entries()) {
    const refs = {};
    if (l.poNumber && rec.type !== "PO") {
      const po = await findDoc(ctx, "PO", l.poNumber, party, master, { requireParty: false });
      if (po) {
        refs.poId = po.id;
        const poLineNo = matchPoLine(po, l);
        if (poLineNo !== undefined) refs.poLineNo = poLineNo;
        else issues.push(warn(`Line ${l.lineNo || i + 1}: could not tell which line of PO ${l.poNumber} this is`, "po_line_no"));
      } else {
        refs.poNumber = l.poNumber; pending = true;
        issues.push(warn(`PO ${l.poNumber} is not in Satya yet — the line will link when the PO is imported`, "po_number"));
      }
    }
    if (l.grnNumber && rec.type !== "GRN") {
      const grn = await findDoc(ctx, "GRN", l.grnNumber, party, master, { requireParty: false });
      if (grn) {
        refs.grnId = grn.id;
        const gl = (grn.lines || []).find((x) => (refs.poLineNo !== undefined && x.refs?.poLineNo === refs.poLineNo) || (l.sku && x.sku === l.sku));
        if (gl) refs.grnLineNo = gl.lineNo;
        if (!refs.poId && grn.lines?.[0]?.refs?.poId) { refs.poId = grn.lines[0].refs.poId; if (gl?.refs?.poLineNo) refs.poLineNo = gl.refs.poLineNo; }
      } else { refs.grnNumber = l.grnNumber; pending = true; }
    }
    lines.push({ ...l, refs });
  }
  let invoice = null;
  if (rec.refs?.invoiceNumber && ["CREDIT_NOTE_IN", "DEBIT_NOTE_OUT"].includes(rec.type)) {
    invoice = await findDoc(ctx, "INVOICE_IN", rec.refs.invoiceNumber, party, master);
    if (invoice) notes.push(`against invoice ${rec.refs.invoiceNumber}`);
    else { pending = true; issues.push(warn(`Invoice ${rec.refs.invoiceNumber} not found for this supplier — the note is stored unlinked`, "against_invoice_number")); }
  }
  const allocations = [];
  if (rec.type === "PAYMENT_OUT") {
    if (!rec.payment?.amount || !(Number(rec.payment.amount) > 0)) issues.push(err("Payment amount is missing", "amount"));
    for (const a of rec.payment?.allocations || []) {
      const inv = await findDoc(ctx, "INVOICE_IN", a.invoiceNumber, party, master);
      if (inv && a.amount && Number(a.amount) > 0) allocations.push({ documentId: inv.id, amount: a.amount, basis: "reference", invoiceNumber: a.invoiceNumber });
      else issues.push(warn(`Bill ${a.invoiceNumber}: ${inv ? "no amount given" : "no matching purchase invoice for this supplier"} — left for review`, "invoice_number"));
    }
    const allocated = allocations.reduce((s, a) => s + toPaise(a.amount), 0n);
    const cap = toPaise(rec.payment?.amount) + toPaise(rec.payment?.tdsAmount);
    if (allocated > cap) issues.push(warn(`Bill-wise amounts (₹${fromPaise(allocated)}) exceed the payment plus TDS (₹${fromPaise(cap)})`, "allocated_amount"));
    if (!rec.payment?.utr && rec.payment?.mode !== "CHEQUE") issues.push(warn("No UTR — bank-statement matching will rely on amount and date", "utr"));
  }
  if (rec.type === "INVOICE_IN" && !lines.some((l) => l.refs.poId) && !pending) notes.push("no PO reference — goes to review for PO matching");
  if (issues.some((i) => i.severity === "error")) return { action: "error", issues, notes };
  return { action: "create", fy, master, newSupplier: !master, lines, invoice, allocations, pending, issues, notes };
};

// ---------- public API ----------
const sortRecords = (records) => {
  const masters = records.filter((r) => r.kind !== "document");
  const docs = records.filter((r) => r.kind === "document")
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || String(a.date || "").localeCompare(String(b.date || "")));
  return [...masters.filter((r) => r.kind === "supplier"), ...masters.filter((r) => r.kind === "item"), ...docs];
};

const describe = (rec) => rec.kind === "supplier" ? { kind: "supplier", label: rec.legalName, gstin: rec.gstin || null }
  : rec.kind === "item" ? { kind: "item", label: `${rec.code} — ${rec.description}` }
    : { kind: rec.type, label: `${rec.type} ${rec.number || "(no number)"}`, number: rec.number || null, date: rec.date || null, party: rec.supplier?.name || rec.supplier?.gstin || null, amount: rec.totals?.grand || rec.payment?.amount || null };

const tally = (summary, rec, action) => {
  const k = rec.kind === "document" ? rec.type : rec.kind;
  summary.byType[k] = summary.byType[k] || { create: 0, update: 0, unchanged: 0, duplicate: 0, error: 0 };
  summary.byType[k][action] = (summary.byType[k][action] || 0) + 1;
  summary[action] = (summary[action] || 0) + 1;
};

/** Dry run over records. Returns {summary, rows, issues, canCommit}. */
export const planRecords = async (ctx, records) => {
  const summary = { create: 0, update: 0, unchanged: 0, duplicate: 0, error: 0, warnings: 0, byType: {}, pendingRefs: 0, newSuppliers: 0 };
  const rows = [];
  const issues = [];
  const seenSup = new Set(); const seenItem = new Set();
  const newSup = new Set();
  for (const rec of sortRecords(records)) {
    const p = rec.kind === "supplier" ? planSupplier(ctx, rec, seenSup)
      : rec.kind === "item" ? await planItem(ctx, rec, seenItem)
        : await planDocument(ctx, rec);
    if (rec.kind === "supplier" && p.action === "create") {
      // later documents in this file resolve to the supplier about to be created
      indexSupplier(ctx, { id: `planned:${rec.gstin || rec.legalName}`, legalName: rec.legalName, gstins: rec.gstin ? [{ gstin: rec.gstin }] : [], pan: rec.pan });
    }
    if (rec.kind === "document" && p.action === "create") {
      remember(ctx, rec.type, { id: null, number: rec.number, fy: p.fy, seller: { name: rec.supplier?.name, gstin: rec.supplier?.gstin }, supplierId: p.master?.id, lines: p.lines });
      if (p.pending) summary.pendingRefs++;
      if (p.newSupplier) newSup.add(rec.supplier?.gstin || normName(rec.supplier?.name));
    }
    tally(summary, rec, p.action);
    for (const i of p.issues || []) {
      if (i.severity === "warning") summary.warnings++;
      issues.push({ ref: rec.ref, line: i.line ?? rec.source?.lines?.[0], ...i });
    }
    rows.push({ ref: rec.ref, ...describe(rec), action: p.action, existingId: p.existingId || p.supplierId || p.itemId || null, changes: p.changes || undefined, notes: p.notes || [], issues: (p.issues || []).length });
  }
  summary.newSuppliers = newSup.size;
  return { summary, rows, issues, canCommit: summary.create + summary.update > 0 };
};

const supplierDoc = (ctx, rec) => ({
  id: newId("sup"), groupId: ctx.groupId, legalName: rec.legalName,
  tradeNames: rec.tradeName ? [rec.tradeName] : [],
  gstins: rec.gstin ? [{ gstin: rec.gstin, stateCode: rec.stateCode || rec.gstin.slice(0, 2), status: "unverified" }] : [],
  ...(rec.pan || rec.gstin ? { pan: rec.pan || rec.gstin.slice(2, 12) } : {}),
  ...(rec.udyam && rec.msmeCategory ? { udyam: { number: rec.udyam, category: rec.msmeCategory } } : {}),
  msme: Boolean(rec.msmeCategory || rec.udyam),
  ...(rec.paymentTermsDays !== undefined ? { paymentTermsDays: rec.paymentTermsDays } : {}),
  ...(rec.tdsSection ? { tdsSection: rec.tdsSection } : {}),
  ...(rec.aatoBand ? { aatoBand: rec.aatoBand } : {}),
  ...(rec.einvoiceApplicable !== undefined ? { einvoiceApplicable: rec.einvoiceApplicable } : {}),
  contacts: rec.email || rec.phone ? [{ name: rec.contactName || rec.legalName, ...(rec.email && /\S+@\S+\.\S+/.test(rec.email) ? { email: rec.email } : {}), ...(rec.phone ? { phone: rec.phone.slice(0, 20) } : {}) }] : [],
  addresses: rec.address ? [{ label: "Registered", ...Object.fromEntries(Object.entries(rec.address).filter(([, v]) => v)) }] : [],
  bankAccounts: rec.bank ? [{ id: newId("bnk"), accountMasked: maskAccount(rec.bank.accountNo), ifsc: rec.bank.ifsc, accountHash: accountHash(rec.bank.accountNo, rec.bank.ifsc), holderName: rec.legalName, status: "pending_change", proposedBy: ctx.actor }] : [],
  tags: ["imported"],
});

const ensureSupplierForDoc = async (ctx, party) => {
  const found = findSupplier(ctx, party);
  if (found.supplier && !String(found.supplier.id).startsWith("planned:")) return found.supplier;
  const g = checkGstin(party.gstin);
  const created = await Supplier.create(supplierDoc(ctx, { legalName: party.name && party.name !== "Unknown party" ? party.name : party.gstin, gstin: g.ok ? g.gstin : "", stateCode: g.ok ? g.stateCode : "", pan: g.ok ? g.pan : "" }));
  const lean = created.toObject();
  indexSupplier(ctx, lean);
  ctx.createdSuppliers = (ctx.createdSuppliers || 0) + 1;
  return lean;
};

const sellerOf = (master, party) => {
  const gstin = party.gstin || master?.gstins?.[0]?.gstin;
  return {
    name: master?.legalName || party.name || gstin || "Supplier",
    ...(gstin ? { gstin, stateCode: gstin.slice(0, 2), pan: gstin.slice(2, 12) } : {}),
    ...(master ? { supplierId: master.id } : {}),
    ...(master?.udyam?.number && master?.udyam?.category ? { udyam: { number: master.udyam.number, category: master.udyam.category } } : {}),
  };
};

const cleanLine = (l, i, items) => {
  const item = l.sku ? items.get(String(l.sku).toUpperCase()) : null;
  const out = {
    lineNo: l.lineNo || i + 1,
    ...(item ? { itemId: item.id } : {}),
    ...(l.sku ? { sku: String(l.sku).slice(0, 60) } : {}),
    description: String(l.description || item?.description || l.sku || `Line ${i + 1}`).slice(0, 500),
    ...(l.hsn || item?.hsn ? { hsn: l.hsn || item.hsn } : {}),
    uom: l.uom || item?.uom || "EA",
    qty: l.qty || "1",
    ...(l.rate ? { rate: l.rate } : {}),
    ...(l.discountPct ? { discountPct: l.discountPct } : {}),
    ...(l.gstRate || item?.defaultGstRate ? { gstRate: l.gstRate || item.defaultGstRate } : {}),
    ...(l.taxableValue ? { taxableValue: l.taxableValue } : {}),
    ...(l.scheduleDate ? { scheduleDate: l.scheduleDate } : {}),
    ...(l.acceptedQty !== undefined ? { acceptedQty: l.acceptedQty } : {}),
    ...(l.rejectedQty !== undefined ? { rejectedQty: l.rejectedQty } : {}),
    ...(l.refs && Object.keys(l.refs).length ? { refs: l.refs } : {}),
  };
  return out;
};

const writeDocument = async (ctx, rec, plan) => {
  const items = await getItems(ctx);
  const party = rec.supplier || {};
  const master = plan.master && !String(plan.master.id).startsWith("planned:") ? plan.master : await ensureSupplierForDoc(ctx, party);
  const seller = sellerOf(master, party);
  const date = rec.invoiceDate || rec.date;
  const fy = fyOf(date);
  let lines = (plan.lines || []).map((l, i) => cleanLine(l, i, items));
  if (["CREDIT_NOTE_IN", "DEBIT_NOTE_OUT"].includes(rec.type)) {
    if (!lines.length) lines = [{ lineNo: 1, description: rec.narration || `Adjustment against ${rec.refs?.invoiceNumber || "invoice"}`, uom: "EA", qty: "1", ...(rec.totals?.taxable ? { rate: rec.totals.taxable, taxableValue: rec.totals.taxable } : {}) }];
    if (plan.invoice) lines = lines.map((l) => ({ ...l, refs: { ...(l.refs || {}), invoiceId: plan.invoice.id } }));
    else if (rec.refs?.invoiceNumber) lines = lines.map((l) => ({ ...l, refs: { ...(l.refs || {}), invoiceNumber: rec.refs.invoiceNumber } }));
  }
  let totals = rec.totals && rec.totals.grand ? rec.totals : undefined;
  if (!totals && ["PO", "INVOICE_IN"].includes(rec.type) && lines.length) totals = computeTotals(lines, seller.stateCode, ctx.buyer.stateCode);
  if (totals && rec.totals?.taxable && !rec.totals.grand) totals = { ...totals, taxable: rec.totals.taxable };
  const payment = rec.type === "PAYMENT_OUT" ? {
    amount: rec.payment.amount, mode: rec.payment.mode || "OTHER", valueDate: rec.payment.valueDate || rec.date,
    ...(rec.payment.utr ? { utr: rec.payment.utr } : {}),
    ...(rec.payment.chequeNo ? { chequeNo: rec.payment.chequeNo } : {}),
    ...(rec.payment.tdsAmount ? { tdsAmount: rec.payment.tdsAmount, tds: { amount: rec.payment.tdsAmount, ...(rec.payment.tdsSection ? { section: rec.payment.tdsSection } : {}) } } : {}),
    allocations: (plan.allocations || []).map(({ documentId, amount, basis }) => ({ documentId, amount, basis })),
  } : undefined;
  const externalRef = rec.type === "PAYMENT_OUT" && rec.payment?.utr ? `imp:PAYMENT_OUT:utr:${rec.payment.utr}` : externalRefFor(rec.type, party, master, fy, rec.number);
  const body = {
    id: newId("doc"), groupId: ctx.groupId, entityId: ctx.entityId, type: rec.type,
    number: String(rec.number).slice(0, 80), externalRef, date, fy, status: STATUS_FOR[rec.type] || "posted", revision: 0,
    seller, buyer: ctx.buyer, supplierId: master?.id,
    ...(rec.placeOfSupply && /^\d{2}$/.test(rec.placeOfSupply) ? { placeOfSupply: rec.placeOfSupply } : {}),
    currency: "INR", lines, charges: [],
    ...(totals ? { totals } : {}),
    ...(rec.gst && Object.keys(rec.gst).length ? { gst: rec.gst } : {}),
    ...(rec.terms ? { terms: rec.terms } : {}),
    ...(payment ? { payment } : {}),
    source: { ...(rec.source || {}), ...(ctx.importRunId ? { importRunId: ctx.importRunId } : {}), ...(plan.pending ? { pendingRefs: true } : {}), ...(rec.narration ? { narration: String(rec.narration).slice(0, 300) } : {}) },
    provenance: ctx.provenance, observedAt: new Date().toISOString(), createdBy: ctx.actor,
    ...(rec.type === "PO" ? { issuedAt: new Date(`${rec.date}T00:00:00+05:30`).toISOString() } : {}),
  };
  try {
    const doc = await Document.create(body);
    return doc.toObject();
  } catch (e) {
    if (e?.code === 11000) return null;
    throw e;
  }
};

/** QC document for GRN lines that carry accepted/rejected quantities. */
const writeQcFor = async (ctx, grn) => {
  const lines = (grn.lines || []).filter((l) => l.acceptedQty !== undefined || l.rejectedQty !== undefined);
  if (!lines.length) return null;
  const doc = await Document.create({
    id: newId("doc"), groupId: ctx.groupId, entityId: ctx.entityId, type: "QC",
    number: `QC-${grn.number}`.slice(0, 80), externalRef: `imp:QC:${grn.id}`, date: grn.date, fy: grn.fy, status: "confirmed", revision: 0,
    seller: grn.seller, buyer: grn.buyer, supplierId: grn.supplierId, currency: "INR",
    lines: lines.map((l, i) => {
      const accepted = l.acceptedQty !== undefined ? l.acceptedQty : String(Math.max(0, Number(l.qty) - Number(l.rejectedQty || 0)));
      return {
        lineNo: i + 1, description: l.description, uom: l.uom, qty: l.qty, acceptedQty: accepted,
        rejectedQty: l.rejectedQty !== undefined ? l.rejectedQty : String(Math.max(0, Number(l.qty) - Number(accepted))),
        refs: { ...(l.refs?.poId ? { poId: l.refs.poId, poLineNo: l.refs.poLineNo } : {}), grnId: grn.id, grnLineNo: l.lineNo },
      };
    }),
    source: { ...(grn.source || {}), derivedFrom: grn.id }, provenance: ctx.provenance, observedAt: new Date().toISOString(), createdBy: ctx.actor,
  }).catch((e) => { if (e?.code === 11000) return null; throw e; });
  return doc ? doc.toObject() : null;
};

/** Plan + write. Returns {summary, rows, issues, createdDocumentIds, createdDocs}. */
export const commitRecords = async (ctx, records) => {
  const summary = { create: 0, update: 0, unchanged: 0, duplicate: 0, error: 0, warnings: 0, byType: {}, pendingRefs: 0, suppliersCreated: 0, itemsCreated: 0 };
  const rows = [];
  const issues = [];
  const created = [];
  const seenSup = new Set(); const seenItem = new Set();
  for (const rec of sortRecords(records)) {
    let p;
    let resultId = null;
    if (rec.kind === "supplier") {
      p = planSupplier(ctx, rec, seenSup);
      if (p.action === "create") {
        const s = await Supplier.create(supplierDoc(ctx, rec));
        indexSupplier(ctx, s.toObject()); resultId = s.id; summary.suppliersCreated++;
      } else if (p.action === "update") {
        const update = { $set: p.set || {} };
        if (p.addGstin) update.$push = { gstins: { gstin: p.addGstin, stateCode: p.addGstin.slice(0, 2), status: "unverified" } };
        if (p.addBank) update.$push = { ...(update.$push || {}), bankAccounts: { id: newId("bnk"), accountMasked: maskAccount(p.addBank.accountNo), ifsc: p.addBank.ifsc, accountHash: accountHash(p.addBank.accountNo, p.addBank.ifsc), holderName: rec.legalName, status: "pending_change", proposedBy: ctx.actor } };
        const s = await Supplier.findOneAndUpdate({ groupId: ctx.groupId, id: p.supplierId }, update, { returnDocument: "after" }).lean();
        if (s) indexSupplier(ctx, s);
        resultId = p.supplierId;
      } else resultId = p.supplierId || null;
    } else if (rec.kind === "item") {
      p = await planItem(ctx, rec, seenItem);
      if (p.action === "create") {
        const it = await Item.create({ id: newId("itm"), groupId: ctx.groupId, code: rec.code, description: rec.description, ...(rec.hsn ? { hsn: rec.hsn } : {}), uom: rec.uom || "EA", ...(rec.gstRate ? { defaultGstRate: rec.gstRate } : {}) })
          .catch((e) => { if (e?.code === 11000) return null; throw e; });
        if (it) { ctx.items.set(rec.code.toUpperCase(), it.toObject()); resultId = it.id; summary.itemsCreated++; }
      } else if (p.action === "update") {
        await Item.updateOne({ groupId: ctx.groupId, id: p.itemId }, { $set: p.set });
        resultId = p.itemId;
      } else resultId = p.itemId || null;
    } else {
      p = await planDocument(ctx, rec);
      if (p.action === "create") {
        const doc = await writeDocument(ctx, rec, p);
        if (doc) {
          created.push(doc); resultId = doc.id;
          const idx = await indexFor(ctx, rec.type);
          addToIndex(idx, doc);
          if (p.pending) summary.pendingRefs++;
          if (doc.type === "GRN") {
            const qc = await writeQcFor(ctx, doc);
            if (qc) { created.push(qc); summary.byType.QC = summary.byType.QC || { create: 0 }; summary.byType.QC.create++; }
          }
        } else p = { ...p, action: "duplicate" };
      } else resultId = p.existingId || null;
    }
    tally(summary, rec, p.action);
    for (const i of p.issues || []) {
      if (i.severity === "warning") summary.warnings++;
      issues.push({ ref: rec.ref, line: i.line ?? rec.source?.lines?.[0], ...i });
    }
    rows.push({ ref: rec.ref, ...describe(rec), action: p.action, id: resultId, changes: p.changes || undefined, notes: p.notes || [] });
  }
  summary.suppliersCreated += ctx.createdSuppliers || 0;
  return { summary, rows, issues, createdDocumentIds: created.map((d) => d.id), createdDocs: created };
};
