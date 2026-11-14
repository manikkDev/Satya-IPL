// Pure builder: stories + master data + a clock -> every record the curated
// demo writes (entity patch, suppliers, items, policy, documents, links,
// cases). No I/O here, so --dry-run and the validator see exactly what a
// real run would write.
import crypto from "node:crypto";
import { ENTITY, SUPPLIERS, supplierByKey, ITEMS, itemByCode } from "./company.js";
import { STORIES } from "./stories.js";
import { makeClock, fyOf, fyShort, istStamp, addDays } from "./dates.js";
import { toPaise, fmt, lineAmount, lineTax, splitProRata } from "./money.js";
import { makeUtr, makeIrn, digitsFrom, gstinChecksum } from "./india.js";

export const PROVENANCE = "CONSTRUCTED_DEMO";
const TIMES = { PO: "10:15", GRN: "15:30", QC: "12:00", RETURN: "16:00", INVOICE_IN: "17:10", CREDIT_NOTE_IN: "14:20", PAYMENT_OUT: "11:05" };

// Codes that make a data deviation legitimate for a story (validator uses this).
export const DEVIATION_CODES = {
  overBilled: ["INVOICE_QTY_EXCEEDS_RECEIVED", "RECEIPT_EVIDENCE_MISSING"],
  priceVariance: ["PRICE_VARIANCE"],
  gstinInvalid: ["TAX_GSTIN_INVALID"],
  taxType: ["TAX_TYPE_MISMATCH"],
  unreferencedPayment: ["PAY_UNALLOCATED"],
  noEway: ["TAX_EWAYBILL_MISSING"],
};

const docId = (story, key) => `doc_cur_${story.id.toLowerCase()}_${key}`;
const caseId = (story) => `case_cur_${story.id.toLowerCase()}`;

const buyerParty = () => ({ name: ENTITY.legalName, gstin: ENTITY.gstin, pan: ENTITY.pan, stateCode: ENTITY.stateCode });
const sellerParty = (s, { gstin } = {}) => ({
  name: s.legalName, gstin: gstin || s.gstin, pan: s.pan, stateCode: s.stateCode, supplierId: s.id,
  ...(s.udyam ? { udyam: { number: s.udyam.number, category: s.udyam.category } } : {}),
});
const shipTo = () => ({
  label: ENTITY.shipping.label, line1: ENTITY.shipping.line1, city: ENTITY.shipping.city,
  state: ENTITY.shipping.state, stateCode: ENTITY.shipping.stateCode, pin: ENTITY.shipping.pin,
  pincode: ENTITY.shipping.pin, country: "IN", contact: ENTITY.shipping.contact,
});

// Deliberate data-entry error: transpose two adjacent PAN digits so the
// checksum no longer matches (state code and length stay plausible).
export const typoGstin = (gstin) => {
  for (let i = 7; i < 10; i++) {
    const a = gstin[i], b = gstin[i + 1];
    if (a === b) continue;
    const swapped = gstin.slice(0, i) + b + a + gstin.slice(i + 2);
    if (gstinChecksum(swapped.slice(0, 14)) !== swapped[14]) return swapped;
  }
  throw new Error(`Could not build a failing transposition for ${gstin}`);
};

// Price a set of lines {qty, rate, gstRate}; returns per-line amounts (paise)
// and document totals as decimal strings.
export const priceLines = (lines, intraState) => {
  const priced = lines.map((l) => {
    const taxable = lineAmount(l.qty, l.rate);
    const t = lineTax(taxable, l.gstRate, intraState);
    return { ...l, taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: taxable + t.tax };
  });
  const s = (k) => priced.reduce((acc, l) => acc + l[k], 0n);
  const totals = {
    taxable: fmt(s("taxable")), cgst: fmt(s("cgst")), sgst: fmt(s("sgst")), igst: fmt(s("igst")),
    cess: "0.00", roundOff: "0.00", grand: fmt(s("total")),
  };
  return { priced, totals };
};

const lineMoney = (p) => ({
  taxableValue: fmt(p.taxable), gstRate: p.gstRate, cgst: fmt(p.cgst), sgst: fmt(p.sgst), igst: fmt(p.igst), cess: "0.00", lineTotal: fmt(p.total),
});

const fill = (template, fy) => template.replace("{FY4}", fyShort(fy).replace("-", "")).replace("{FY}", fyShort(fy));

// Supplier invoice numbers in each supplier's own style, monotone in date.
const INVOICE_RATE = { shakti: 0.9, kaveri: 4.2, rathod: 0.6, deccan: 0.5, maratha: 0.45, meridian: 0.19, saurashtra: 1.3, kongu: 1.6, aravali: 0.8, indrayani: 2.1, godavari: 6.5 };
const INVOICE_BASE = { shakti: 41, kaveri: 1188, rathod: 120, deccan: 37, maratha: 14, meridian: 0, saurashtra: 402, kongu: 88, aravali: 211, indrayani: 140, godavari: 3104 };

const assignSupplierNumbers = (invoices) => {
  const bySupplier = new Map();
  for (const inv of invoices) bySupplier.set(inv.supplier.key, [...(bySupplier.get(inv.supplier.key) || []), inv]);
  for (const [key, list] of bySupplier) {
    const supplier = supplierByKey[key];
    const explicit = list.filter((x) => x.event.number);
    const anchor = explicit.length
      ? { day: explicit[0].day, seq: Number(explicit[0].event.number.match(/(\d+)$/)[1]) }
      : { day: 220, seq: INVOICE_BASE[key] };
    const rate = INVOICE_RATE[key];
    let last = -Infinity;
    for (const inv of [...list].sort((a, b) => b.day - a.day || a.order - b.order)) {
      if (inv.event.number) { inv.number = inv.event.number; continue; }
      let seq = anchor.seq + Math.round((anchor.day - inv.day) * rate);
      if (seq <= last) seq = last + 1;
      last = seq;
      inv.number = `${fill(supplier.invoicePrefix, inv.fy)}${String(seq).padStart(supplier.invoicePad, "0")}`;
    }
  }
};

export const buildDataset = ({ today, groupId, entityId, actors }) => {
  const clock = makeClock(today);
  const { analyst, manager } = actors;
  const documents = [];
  const links = [];
  const cases = [];
  const exceptions = {}; // docId -> {story, flags}
  const ourNumbered = []; // {doc, type, fy, sortKey}
  const supplierInvoices = [];
  const storyIndex = {};
  let order = 0;

  const stamp = (date, type) => istStamp(date, TIMES[type] || "10:00");
  const base = (story, type, key, date, observedDay) => {
    const observedDate = observedDay !== undefined ? clock.daysAgo(observedDay) : date;
    const observedAt = stamp(observedDate, type);
    return {
      id: docId(story, key), groupId, entityId, type, number: null, date, fy: fyOf(date), revision: 0,
      currency: "INR", charges: [], source: { channel: "created_in_satya" }, provenance: PROVENANCE,
      observedAt, createdAt: new Date(observedAt), updatedAt: new Date(observedAt),
      createdBy: analyst, caseId: caseId(story),
    };
  };
  const link = (fromId, toId, kind, extra = {}) =>
    links.push({ id: `lnk_${fromId}_${kind}_${toId}`, groupId, fromId, toId, kind, certainty: "CONFIRMED", basis: "reference", createdBy: "satya:seed", lineRefs: [], ...extra });

  for (const story of STORIES) {
    const supplier = supplierByKey[story.supplier];
    if (!supplier) throw new Error(`${story.id}: unknown supplier ${story.supplier}`);
    const intra = supplier.stateCode === ENTITY.stateCode;
    const poDate = clock.daysAgo(story.po.day);
    const poId = docId(story, "po");
    const meta = { story, docs: {}, invoices: {}, grns: {}, payments: [], cns: {} };
    storyIndex[story.id] = meta;

    // ---- PO ----
    let poLines = story.po.lines.map(([code, qty, rate, schedule], i) => {
      const item = itemByCode[code];
      if (!item) throw new Error(`${story.id}: unknown item ${code}`);
      return { lineNo: i + 1, itemId: item.id, sku: item.code, description: item.description, hsn: item.hsn, uom: item.uom, qty, rate, gstRate: item.gstRate, scheduleDate: addDays(poDate, schedule), refs: { poId, poLineNo: i + 1 } };
    });
    const shortClose = story.events.find((e) => e.type === "SHORT_CLOSE");
    const originalQty = Object.fromEntries(poLines.map((l) => [l.lineNo, l.qty]));
    if (shortClose) poLines = poLines.map((l) => (shortClose.lines[l.lineNo] ? { ...l, qty: shortClose.lines[l.lineNo] } : l));
    const poPriced = priceLines(poLines, intra);
    const poValue = Number(poPriced.totals.grand);
    const approvals = [
      { actor: analyst, action: "submit", role: "buyer", comment: "Submitted for approval", at: istStamp(poDate, "09:20") },
      { actor: manager, action: "approve", role: "ap_manager", comment: "Rates checked against last purchase — within band", at: istStamp(poDate, "09:55") },
      { actor: manager, action: "issue", role: "ap_manager", at: stamp(poDate, "PO") },
    ];
    const freeText = [...(story.po.freeText || [])];
    if (shortClose) {
      const scDate = clock.daysAgo(shortClose.day);
      approvals.push({ actor: manager, action: "short_close", role: "ap_manager", comment: shortClose.reason, at: istStamp(scDate, "15:20") });
      for (const [no, qty] of Object.entries(shortClose.lines)) freeText.push(`Short-closed on ${scDate}: line ${no} reduced from ${originalQty[no]} to ${qty} ${poLines[no - 1].uom}`);
    }
    const po = {
      ...base(story, "PO", "po", poDate),
      number: null, ...(story.externalRef ? { externalRef: story.externalRef } : {}),
      status: story.poStatus, revision: shortClose ? 4 : 3,
      seller: sellerParty(supplier), buyer: buyerParty(), supplierId: supplier.id, shipTo: shipTo(), placeOfSupply: ENTITY.stateCode,
      lines: poLines.map((l, i) => ({ ...l, ...lineMoney(poPriced.priced[i]) })),
      totals: poPriced.totals,
      terms: {
        paymentTerms: supplier.msme && supplier.udyam.category !== "medium"
          ? `${supplier.termsDays} days from acceptance (MSME — MSMED Act s.15 applies)`
          : `${supplier.termsDays} days from acceptance`,
        creditDays: supplier.termsDays,
        deliveryTerms: "FOR Chakan works, freight and transit insurance included",
        inspection: "Visual, dimensional and functional check at receipt; acceptance subject to QC",
        warranty: "12 months from commissioning or 18 months from supply, whichever is earlier",
        ...(freeText.length ? { freeText } : {}),
      },
      approvals, requiredApprovers: poValue <= 1000000 ? ["ap_manager", "entity_admin"] : ["group_admin"],
      issuedAt: stamp(poDate, "PO"),
    };
    documents.push(po);
    meta.docs.po = po;
    ourNumbered.push({ doc: po, prefix: "PO", day: story.po.day, order: order++ });

    // ---- events ----
    const received = {}; // lineNo -> qty (paise-free ints as Number)
    let grnCount = 0;
    for (const ev of story.events) {
      const date = clock.daysAgo(ev.day);
      if (ev.type === "SHORT_CLOSE") continue;

      if (ev.type === "GRN") {
        grnCount++;
        const key = ev.key || `grn${grnCount}`;
        const grn = {
          ...base(story, "GRN", key, date), status: "confirmed",
          externalRef: `DC ${digitsFrom(`${story.id}${key}dc`, 4)}`,
          seller: sellerParty(supplier), buyer: buyerParty(), supplierId: supplier.id, shipTo: shipTo(),
          lines: Object.entries(ev.lines).map(([no, qty]) => {
            const l = poLines[no - 1];
            received[no] = (received[no] || 0) + Number(qty);
            return { lineNo: Number(no), itemId: l.itemId, sku: l.sku, description: l.description, hsn: l.hsn, uom: l.uom, qty, refs: { poId, poLineNo: Number(no) } };
          }),
          ...(ev.remarks ? { remarks: ev.remarks } : {}),
        };
        documents.push(grn);
        meta.grns[key] = grn;
        ourNumbered.push({ doc: grn, prefix: "GRN", day: ev.day, order: order++ });
        link(grn.id, poId, "RECEIVES", { qty: String(grn.lines.reduce((s, l) => s + Number(l.qty), 0)), lineRefs: grn.lines.map((l) => ({ fromLineNo: l.lineNo, toLineNo: l.lineNo })) });
        continue;
      }

      if (ev.type === "QC") {
        const grnKeys = Object.keys(meta.grns);
        const lines = [];
        if (ev.grnSplit) {
          for (const [gKey, qty] of Object.entries(ev.grnSplit)) {
            const l = poLines[0];
            lines.push({ lineNo: lines.length + 1, itemId: l.itemId, sku: l.sku, description: l.description, uom: l.uom, qty, acceptedQty: qty, rejectedQty: "0", refs: { poId, poLineNo: 1, grnId: meta.grns[gKey].id, grnLineNo: 1 } });
          }
        } else {
          const grn = meta.grns[grnKeys[grnKeys.length - 1]];
          for (const [no, [inspected, accepted, reason]] of Object.entries(ev.lines)) {
            const l = poLines[no - 1];
            const rejected = String(Number(inspected) - Number(accepted));
            lines.push({
              lineNo: Number(no), itemId: l.itemId, sku: l.sku, description: l.description, uom: l.uom,
              qty: inspected, acceptedQty: accepted, rejectedQty: rejected, ...(reason ? { rejectReason: reason } : {}),
              refs: { poId, poLineNo: Number(no), grnId: grn.id, grnLineNo: Number(no) },
            });
          }
        }
        const qc = { ...base(story, "QC", "qc", date), status: "confirmed", seller: sellerParty(supplier), buyer: buyerParty(), supplierId: supplier.id, lines };
        documents.push(qc);
        meta.docs.qc = qc;
        ourNumbered.push({ doc: qc, prefix: "QC", day: ev.day, order: order++ });
        link(qc.id, poId, "INSPECTS");
        for (const g of new Set(lines.map((l) => l.refs.grnId))) link(qc.id, g, "INSPECTS");
        continue;
      }

      if (ev.type === "RET") {
        const grn = Object.values(meta.grns)[0];
        const ret = {
          ...base(story, "RETURN", "ret", date), status: "confirmed",
          seller: sellerParty(supplier), buyer: buyerParty(), supplierId: supplier.id,
          lines: Object.entries(ev.lines).map(([no, qty]) => {
            const l = poLines[no - 1];
            return { lineNo: Number(no), itemId: l.itemId, sku: l.sku, description: l.description, hsn: l.hsn, uom: l.uom, qty, refs: { poId, poLineNo: Number(no), grnId: grn.id, grnLineNo: Number(no) } };
          }),
          ...(ev.remarks ? { remarks: ev.remarks } : {}),
        };
        documents.push(ret);
        meta.docs.ret = ret;
        ourNumbered.push({ doc: ret, prefix: "RTN", day: ev.day, order: order++ });
        link(ret.id, poId, "RETURNS");
        link(ret.id, grn.id, "RETURNS");
        continue;
      }

      if (ev.type === "INV") {
        const invoiceDate = ev.sameDateAs ? meta.invoices[ev.sameDateAs].date : date;
        const taxIntra = ev.forceIgst ? false : intra;
        const lines = Object.entries(ev.lines).map(([no, qty], i) => {
          const l = poLines[no - 1];
          return { lineNo: i + 1, itemId: l.itemId, sku: l.sku, description: l.description, hsn: l.hsn, uom: l.uom, qty, rate: ev.rates?.[no] || story.po.lines[no - 1][2], gstRate: l.gstRate, refs: { poId, poLineNo: Number(no) } };
        });
        const { priced, totals } = priceLines(lines, taxIntra);
        const sellerGstin = ev.gstinTypo ? typoGstin(supplier.gstin) : supplier.gstin;
        const inv = {
          ...base(story, "INVOICE_IN", ev.key, invoiceDate, ev.day), status: "posted",
          seller: sellerParty(supplier, { gstin: sellerGstin }), buyer: buyerParty(), supplierId: supplier.id,
          placeOfSupply: ENTITY.stateCode, shipTo: shipTo(),
          lines: lines.map((l, i) => ({ ...l, ...lineMoney(priced[i]) })),
          totals,
          terms: { paymentTerms: `${supplier.termsDays} days`, creditDays: supplier.termsDays },
          source: { channel: ev.channel || "upload_pdf" },
        };
        meta.invoices[ev.key] = inv;
        supplierInvoices.push({ doc: inv, supplier, event: ev, day: ev.sameDateAs ? story.events.find((e) => e.key === ev.sameDateAs).day : ev.day, fy: inv.fy, order: order++ });
        documents.push(inv);
        link(inv.id, poId, "BILLS", { lineRefs: inv.lines.map((l) => ({ fromLineNo: l.lineNo, toLineNo: l.refs.poLineNo })) });
        exceptions[inv.id] = { story: story.id, gstinTypo: Boolean(ev.gstinTypo), forceIgst: Boolean(ev.forceIgst), noEway: Boolean(ev.noEway), duplicateOf: ev.duplicateOf ? meta.invoices[ev.duplicateOf].id : null, rateOverride: Boolean(ev.rates) };
        continue;
      }

      if (ev.type === "CN") {
        const inv = meta.invoices[ev.invoice];
        const lines = Object.entries(ev.lines).map(([no, qty], i) => {
          const il = inv.lines.find((l) => l.refs.poLineNo === Number(no));
          return { lineNo: i + 1, itemId: il.itemId, sku: il.sku, description: `Credit for rejected ${il.description}`, hsn: il.hsn, uom: il.uom, qty, rate: il.rate, gstRate: il.gstRate, refs: { poId, poLineNo: Number(no), invoiceId: inv.id, invoiceLineNo: il.lineNo } };
        });
        const { priced, totals } = priceLines(lines, intra);
        const cn = {
          ...base(story, "CREDIT_NOTE_IN", ev.key, date), status: "posted",
          seller: sellerParty(supplier), buyer: buyerParty(), supplierId: supplier.id, placeOfSupply: ENTITY.stateCode,
          lines: lines.map((l, i) => ({ ...l, ...lineMoney(priced[i]) })), totals,
          source: { channel: "upload_pdf" },
        };
        meta.cns[ev.key] = cn;
        cn.pendingNumber = { supplier, invoice: inv };
        documents.push(cn);
        link(cn.id, inv.id, "ADJUSTS", { amount: { amount: totals.grand, currency: "INR" } });
        link(cn.id, poId, "ADJUSTS");
        continue;
      }

      if (ev.type === "PAY") {
        const pay = {
          ...base(story, "PAYMENT_OUT", ev.key, date), status: "posted",
          seller: sellerParty(supplier), buyer: buyerParty(), supplierId: supplier.id,
          source: { channel: "bank_csv", sourceSystem: "HDFC net banking statement" },
          lines: [],
        };
        const bank = supplier.bankMasked;
        if (ev.unreferenced) {
          pay.payment = { amount: ev.unreferenced, mode: ev.mode, valueDate: date, bankAccountMasked: bank, allocations: [] };
          meta.payments.push({ pay, ev, unreferenced: true });
        } else {
          const allocations = [];
          for (const [invKey, how] of ev.alloc) {
            const inv = meta.invoices[invKey];
            const already = meta.payments.flatMap((p) => p.pay.payment.allocations).filter((a) => a.documentId === inv.id).reduce((s, a) => s + toPaise(a.amount), 0n);
            const credit = Object.values(meta.cns).filter((c) => c.lines.some((l) => l.refs.invoiceId === inv.id)).reduce((s, c) => s + toPaise(c.totals.grand), 0n);
            const grand = toPaise(inv.totals.grand);
            const amount = how === "full" || how === "rest" ? grand - already : how === "netOfCredit" ? grand - credit - already : toPaise(how);
            allocations.push({ documentId: inv.id, amount: fmt(amount), basis: "reference" });
            // per-PO-line split so the engine ledger carries paid value
            // weights are each line's value net of credit notes on that line,
            // so a net-of-credit payment never exceeds a line's net billing
            const creditOn = (l) => Object.values(meta.cns).flatMap((c) => c.lines).filter((x) => x.refs.invoiceId === inv.id && x.refs.invoiceLineNo === l.lineNo).reduce((s, x) => s + toPaise(x.lineTotal), 0n);
            const shares = splitProRata(amount, inv.lines.map((l) => toPaise(l.lineTotal) - creditOn(l)));
            inv.lines.forEach((l, i) => pay.lines.push({
              lineNo: pay.lines.length + 1, description: `Against invoice line ${l.lineNo}`, uom: "NOS", qty: "1",
              lineTotal: fmt(shares[i]), refs: { poId, poLineNo: l.refs.poLineNo, invoiceId: inv.id, invoiceLineNo: l.lineNo },
            }));
          }
          const total = allocations.reduce((s, a) => s + toPaise(a.amount), 0n);
          pay.payment = { amount: fmt(total), mode: ev.mode, valueDate: date, bankAccountMasked: bank, allocations };
          meta.payments.push({ pay, ev });
          for (const a of allocations) link(pay.id, a.documentId, "SETTLES", { amount: { amount: a.amount, currency: "INR" } });
        }
        if (ev.label) pay.externalRef = `${ev.label} · ${ev.unreferenced ? "NEFT/vendor transfer" : "NEFT/remittance"}`;
        documents.push(pay);
        ourNumbered.push({ doc: pay, prefix: "PV", day: ev.day, order: order++ });
        exceptions[pay.id] = { story: story.id, unreferenced: Boolean(ev.unreferenced) };
        continue;
      }
      throw new Error(`${story.id}: unknown event ${ev.type}`);
    }

    const subjectIds = [poId, ...meta.payments.filter((p) => p.unreferenced).map((p) => p.pay.id)];
    const last = documents.filter((d) => d.caseId === caseId(story)).reduce((m, d) => (d.observedAt > m ? d.observedAt : m), po.observedAt);
    cases.push({
      id: caseId(story), groupId, entityId, kind: "po", subjectIds,
      title: `PO ${"{number}"} — ${supplier.legalName}${story.externalRef ? ` (${story.externalRef})` : ""}`,
      status: story.caseStatus, revision: 0, priority: story.priority || (story.expected.length ? "normal" : "low"),
      ...(story.caseStatus === "resolved" ? {} : { assignee: analyst }),
      createdAt: new Date(po.observedAt), updatedAt: new Date(last),
    });
  }

  // ---- our own document numbers: contiguous per type per FY, by date ----
  const counters = {};
  for (const n of ourNumbered.sort((a, b) => b.day - a.day || a.order - b.order)) {
    const k = `${n.prefix}|${n.doc.fy}`;
    counters[k] = (counters[k] || 0) + 1;
    n.doc.number = `${ENTITY.code}/${n.prefix}/${fyShort(n.doc.fy)}/${String(counters[k]).padStart(6, "0")}`;
  }
  assignSupplierNumbers(supplierInvoices);
  for (const entry of supplierInvoices) {
    const { doc, supplier } = entry;
    doc.number = entry.number;
    const grand = toPaise(doc.totals.grand);
    const ex = exceptions[doc.id];
    doc.gst = {
      ...(supplier.einvoice ? {
        irn: makeIrn(doc.seller.gstin, doc.fy, "INV", doc.number),
        ackNo: `1${fyShort(doc.fy).slice(0, 2)}${digitsFrom(`${doc.id}ack`, 12)}`,
        ackDate: istStamp(doc.date, "11:40"),
      } : {}),
      ...(grand > 5000000n && !ex.noEway ? { ewayBillNo: `${1 + (Number(digitsFrom(`${doc.id}ewb0`, 1)) % 4)}${digitsFrom(`${doc.id}ewb`, 11)}` } : {}),
      reverseCharge: false, supplyType: "B2B",
    };
  }
  // credit-note numbers in the supplier's style
  for (const d of documents.filter((x) => x.type === "CREDIT_NOTE_IN")) {
    const { supplier } = d.pendingNumber;
    delete d.pendingNumber;
    d.number = `${supplier.invoicePrefix.split("/")[0]}/CN/${fyShort(d.fy)}/${digitsFrom(`${d.id}cn`, 3)}`;
    if (supplier.einvoice) d.gst = { irn: makeIrn(d.seller.gstin, d.fy, "CRN", d.number), ackNo: `1${fyShort(d.fy).slice(0, 2)}${digitsFrom(`${d.id}ack`, 12)}`, ackDate: istStamp(d.date, "11:40"), reverseCharge: false, supplyType: "B2B" };
  }
  // payment UTRs + human descriptions now that invoice numbers exist
  const byId = new Map(documents.map((d) => [d.id, d]));
  let utrSeq = 0;
  for (const d of documents.filter((x) => x.type === "PAYMENT_OUT").sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    utrSeq++;
    const p = d.payment;
    const utr = makeUtr(p.mode, p.valueDate, Number(digitsFrom(`${d.id}utr`, 5)) * 10 + (utrSeq % 10));
    if (utr) p.utr = utr;
    else d.externalRef = `CHQ ${digitsFrom(`${d.id}chq`, 6)} · HDFC Bank Chakan`;
    for (const l of d.lines) l.description = `Against ${byId.get(l.refs.invoiceId).number} line ${l.refs.invoiceLineNo}`;
  }
  // PO-numbered case titles + content hash for issued POs
  for (const c of cases) {
    const po = byId.get(c.subjectIds[0]);
    c.title = c.title.replace("{number}", po.number);
  }
  for (const po of documents.filter((d) => d.type === "PO")) po.contentHash = contentHash(po);

  // ---- masters ----
  const preferred = {};
  for (const story of STORIES) for (const [code] of story.po.lines) preferred[code] = [...new Set([...(preferred[code] || []), supplierByKey[story.supplier].id])];
  const items = ITEMS.map((i) => ({ id: i.id, groupId, code: i.code, description: i.description, specs: {}, hsn: i.hsn, uom: i.uom, defaultGstRate: i.gstRate, aliases: [], preferredSupplierIds: preferred[i.code] || [], provenance: PROVENANCE }));
  const nextSeq = {};
  for (const n of ourNumbered) {
    const k = `${n.prefix}|${n.doc.fy}`;
    nextSeq[k] = Math.max(nextSeq[k] || 1, Number(n.doc.number.slice(-6)) + 1);
  }

  return { today: clock.today, documents, links, cases, items, exceptions, storyIndex, nextSeq };
};

// Same canonicalisation as services/documents.js contentHashOf (kept local so
// the builder stays import-free of mongoose models).
const VOLATILE = new Set(["_id", "__v", "createdAt", "updatedAt", "contentHash", "issuedAt", "observedAt", "caseId"]);
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).filter((k) => !VOLATILE.has(k)).sort().map((k) => [k, canonicalize(value[k])]));
  return value;
};
const contentHash = (doc) => crypto.createHash("sha256").update(JSON.stringify(canonicalize(doc))).digest("hex");

export { SUPPLIERS };
