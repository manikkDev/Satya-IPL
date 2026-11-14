// TallyPrime XML export -> Satya import records.
//
// Reads what "Export > Day Book / Vouchers" and "Export > Masters" (XML) or
// the HTTP XML interface on port 9000 return: ENVELOPE > BODY > IMPORTDATA >
// REQUESTDATA > TALLYMESSAGE > {VOUCHER | LEDGER | STOCKITEM | VOUCHERTYPE}.
// Also accepts the <ENVELOPE><BODY><DATA><COLLECTION> shape an Export
// request returns. Amount signs follow Tally (negative = debit); only
// magnitudes are used, the role of each ledger decides the meaning.
//
// Voucher type -> Satya document:
//   Purchase Order               -> PO (status issued)
//   Receipt Note                 -> GRN (status confirmed)
//   Rejections Out               -> RETURN (to supplier)
//   Purchase                     -> INVOICE_IN (number = supplier REFERENCE)
//   Debit Note                   -> DEBIT_NOTE_OUT (against the bill in BILLALLOCATIONS)
//   Payment                      -> PAYMENT_OUT (bill-wise allocations, UTR from BANKALLOCATIONS)
// Custom voucher types resolve through their PARENT (VOUCHERTYPE masters in
// the same file) or by name. Sales-side and journal vouchers are skipped.
import { parseXml, kids, kid, textOf, findAll } from "./xml.js";
import { parseDate, parseAmount, parseQty, normUom, checkGstin, checkPan, checkUdyam, checkHsn, normGstRate } from "./normalize.js";

const TYPE_BY_NAME = [
  [/purchase\s*order/i, "PO"],
  [/receipt\s*note|goods\s*receipt|\bgrn\b|material\s*in(ward)?/i, "GRN"],
  [/rejections?\s*out|purchase\s*return/i, "RETURN"],
  [/debit\s*note/i, "DEBIT_NOTE_OUT"],
  [/^purchase|purchase/i, "INVOICE_IN"],
  [/^payment|payment/i, "PAYMENT_OUT"],
];
const SKIP_HINT = /sales|receipt$|^receipt|journal|contra|delivery\s*note|rejections?\s*in|credit\s*note|stock\s*journal|physical|memorandum|reversing/i;

export const tallyTypeFor = (name, parents = new Map()) => {
  let n = String(name || "");
  for (let hop = 0; hop < 4 && parents.has(n) && parents.get(n) !== n; hop++) n = parents.get(n);
  for (const candidate of [n, String(name || "")]) {
    if (/receipt\s*note/i.test(candidate)) return "GRN"; // before "receipt" skip-hint
    if (SKIP_HINT.test(candidate) && !/purchase|payment|debit\s*note|rejections?\s*out/i.test(candidate)) continue;
    for (const [rx, type] of TYPE_BY_NAME) if (rx.test(candidate)) return type;
  }
  return null;
};

const yes = (v) => /^yes$/i.test(String(v || "").trim());
const abs = (v) => parseAmount(v)?.value ?? null;
const clean = (v) => {
  const s = String(v ?? "").trim();
  return !s || /^(not applicable|any|end of list|primary)$/i.test(s) ? "" : s;
};

const TAX = [
  ["cgst", /\bcgst\b|central\s*tax/i],
  ["sgst", /\b(sgst|utgst)\b|state\s*tax/i],
  ["igst", /\bigst\b|integrated\s*tax/i],
  ["cess", /\bcess\b/i],
  ["roundOff", /round(ed|ing)?\s*off|rounding/i],
  ["tds", /\btds\b|tax\s*deducted/i],
];
const ledgerRole = (name) => (TAX.find(([, rx]) => rx.test(name)) || [null])[0];

const rateOf = (text) => {
  // "9850.00/Nos" | "9,850.00/Nos"
  const [amt, unit] = String(text || "").split("/");
  return { rate: abs(amt), uom: unit ? normUom(unit) : null };
};

/** All TALLYMESSAGE children (or COLLECTION children) as a flat list. */
const messages = (root) => {
  const out = [];
  for (const m of findAll(root, "TALLYMESSAGE")) out.push(...m.children);
  if (!out.length) for (const c of findAll(root, "COLLECTION")) out.push(...c.children);
  return out;
};

const parseLedgerMaster = (el) => {
  const name = el.attrs.NAME || textOf(el, "NAME") || textOf(kid(el, "LANGUAGENAME.LIST") ? kid(kid(el, "LANGUAGENAME.LIST"), "NAME.LIST") : null, "NAME");
  const parent = textOf(el, "PARENT");
  const reg = kid(el, "LEDGSTREGDETAILS.LIST");
  const gstinRaw = textOf(el, "PARTYGSTIN") || textOf(reg, "GSTIN") || textOf(el, "GSTIN");
  const mailing = kid(el, "LEDMAILINGDETAILS.LIST");
  const address = [...kids(mailing || el, "ADDRESS.LIST")].flatMap((a) => kids(a, "ADDRESS").map((x) => x.text.trim())).filter(Boolean);
  const msme = kid(el, "MSMEREGISTRATIONDETAILS.LIST");
  const udyamRaw = textOf(msme, "MSMEUDYAMREGNUMBER") || textOf(msme, "UDYAMREGNUMBER") || textOf(el, "UDYAMREGNUMBER") || textOf(el, "MSMEUDYAMREGNUMBER");
  const category = (textOf(msme, "MSMEENTERPRISETYPE") || textOf(msme, "TYPEOFENTERPRISE") || textOf(el, "MSMEENTERPRISETYPE")).toLowerCase();
  const credit = /(\d+)/.exec(textOf(el, "BILLCREDITPERIOD") || "");
  return {
    name: String(name || "").trim(),
    parent,
    gstin: gstinRaw ? gstinRaw.toUpperCase() : "",
    pan: (textOf(el, "INCOMETAXNUMBER") || textOf(el, "PANNUMBER")).toUpperCase(),
    stateName: textOf(mailing, "STATE") || textOf(el, "LEDSTATENAME") || textOf(el, "STATENAME"),
    pincode: textOf(mailing, "PINCODE") || textOf(el, "PINCODE"),
    address,
    email: textOf(el, "EMAIL") || textOf(el, "LEDGEREMAIL"),
    phone: textOf(el, "LEDGERPHONE") || textOf(el, "LEDGERMOBILE"),
    contact: textOf(el, "LEDGERCONTACT"),
    udyam: udyamRaw.toUpperCase(),
    msmeCategory: ["micro", "small", "medium"].find((c) => category.includes(c)) || "",
    creditDays: credit ? Number(credit[1]) : undefined,
    guid: textOf(el, "GUID"),
  };
};

const parseStockItem = (el) => {
  const gst = findAll(el, "GSTDETAILS.LIST");
  const hsnList = findAll(el, "HSNDETAILS.LIST");
  const hsn = textOf(hsnList.at(-1), "HSNCODE") || textOf(gst.at(-1), "HSNCODE") || textOf(el, "HSNCODE");
  let gstRate = "";
  for (const r of findAll(el, "RATEDETAILS.LIST")) {
    if (/igst|integrated/i.test(textOf(r, "GSTRATEDUTYHEAD"))) gstRate = textOf(r, "GSTRATE");
  }
  return {
    name: String(el.attrs.NAME || textOf(el, "NAME")).trim(),
    parent: textOf(el, "PARENT"),
    uom: normUom(textOf(el, "BASEUNITS")),
    hsn: hsn.replace(/\s/g, ""),
    gstRate: gstRate ? String(Number(gstRate)) : "",
    description: textOf(el, "DESCRIPTION") || textOf(el, "NARRATION"),
    partNo: textOf(el, "MAILINGNAME") || textOf(findAll(el, "PARTNO.LIST")[0], "PARTNO"),
  };
};

const inventoryEntries = (v) => [
  ...kids(v, "ALLINVENTORYENTRIES.LIST"), ...kids(v, "INVENTORYENTRIES.LIST"),
  ...kids(v, "INVENTORYENTRIESIN.LIST"), ...kids(v, "INVENTORYENTRIESOUT.LIST"),
];
const ledgerEntries = (v) => [...kids(v, "LEDGERENTRIES.LIST"), ...kids(v, "ALLLEDGERENTRIES.LIST")];

const voucherLines = (v, stock) => inventoryEntries(v).map((e, i) => {
  const itemName = textOf(e, "STOCKITEMNAME");
  const master = stock.get(itemName);
  const qty = parseQty(textOf(e, "BILLEDQTY") || textOf(e, "ACTUALQTY"));
  const actual = parseQty(textOf(e, "ACTUALQTY"));
  const { rate, uom: rateUom } = rateOf(textOf(e, "RATE"));
  const batch = kids(e, "BATCHALLOCATIONS.LIST");
  const poNumber = batch.map((b) => clean(textOf(b, "ORDERNO"))).find(Boolean) || "";
  const grnNumber = batch.map((b) => clean(textOf(b, "TRACKINGNUMBER"))).find(Boolean) || "";
  const purchaseLedger = textOf(kids(e, "ACCOUNTINGALLOCATIONS.LIST")[0], "LEDGERNAME");
  return {
    lineNo: i + 1,
    description: itemName || textOf(e, "STOCKITEMDESCRIPTION") || `Line ${i + 1}`,
    sku: master?.partNo || "",
    stockItem: itemName,
    hsn: checkHsn(master?.hsn).ok ? master.hsn : "",
    gstRate: master?.gstRate || "",
    qty: qty?.qty || "",
    actualQty: actual?.qty || qty?.qty || "",
    uom: qty?.uom || rateUom || master?.uom || "EA",
    rate: rate || "",
    taxableValue: abs(textOf(e, "AMOUNT")) || "",
    poNumber, grnNumber,
    dueDate: parseDate(batch.map((b) => textOf(b, "ORDERDUEDATE")).find(Boolean)) || null,
    purchaseLedger,
  };
});

const knownParty = (name, ledgers) => {
  const l = ledgers.get(name);
  return l && /sundry\s*creditors|creditors|suppliers|vendors/i.test(l.parent || "");
};

/** Parse a Tally XML buffer into {suppliers, items, documents, skipped, issues, stats}. */
export const parseTallyXml = (input) => {
  const root = parseXml(input);
  const issues = [];
  const all = messages(root);
  if (!all.length && !findAll(root, "VOUCHER").length) {
    const err = textOf(findAll(root, "LINEERROR")[0]) || "";
    throw Object.assign(new Error(err ? `Tally returned an error: ${err}` : "This does not look like a TallyPrime XML export (no TALLYMESSAGE / VOUCHER elements)"), { status: 422 });
  }
  const parents = new Map();
  for (const vt of all.filter((e) => e.name.toUpperCase() === "VOUCHERTYPE")) {
    parents.set(String(vt.attrs.NAME || textOf(vt, "NAME")).trim(), textOf(vt, "PARENT"));
  }
  const ledgers = new Map();
  for (const el of all.filter((e) => e.name.toUpperCase() === "LEDGER")) {
    const l = parseLedgerMaster(el);
    if (l.name) ledgers.set(l.name, l);
  }
  const stock = new Map();
  for (const el of all.filter((e) => e.name.toUpperCase() === "STOCKITEM")) {
    const s = parseStockItem(el);
    if (s.name) stock.set(s.name, s);
  }

  // suppliers: creditor ledgers or any ledger carrying a GSTIN that vouchers use as a party
  const suppliers = [];
  for (const l of ledgers.values()) {
    if (!/sundry\s*creditors|creditors|suppliers|vendors/i.test(l.parent || "")) continue;
    const g = checkGstin(l.gstin);
    const p = checkPan(l.pan || g.pan);
    const u = checkUdyam(l.udyam);
    const rowIssues = [];
    if (l.gstin && !g.ok) rowIssues.push({ field: "gstin", severity: "warning", message: `${l.name}: ${g.reason} (${l.gstin})` });
    if (l.udyam && !u.ok) rowIssues.push({ field: "udyam", severity: "warning", message: `${l.name}: Udyam number "${l.udyam}" is not in UDYAM-XX-00-0000000 form` });
    suppliers.push({
      kind: "supplier", ref: l.name, legalName: l.name,
      gstin: g.ok ? g.gstin : "", stateCode: g.ok ? g.stateCode : "", pan: p.ok ? p.pan : "",
      udyam: u.ok ? u.udyam : "", msmeCategory: l.msmeCategory, paymentTermsDays: l.creditDays,
      email: l.email, phone: l.phone, contactName: l.contact,
      address: l.address.length || l.pincode ? { line1: l.address.join(", "), state: l.stateName, pin: l.pincode } : null,
      issues: rowIssues, source: { channel: "tally", sourceSystem: "tally", ledger: l.name, guid: l.guid },
    });
  }
  const items = [...stock.values()].map((s) => ({
    kind: "item", ref: s.name, code: (s.partNo || s.name).slice(0, 40), description: s.description || s.name,
    hsn: s.hsn, uom: s.uom, gstRate: normGstRate(s.gstRate) || "",
    issues: s.hsn && !checkHsn(s.hsn).ok ? [{ field: "hsn", severity: "warning", message: `${s.name}: HSN "${s.hsn}" is not 4–8 digits` }] : [],
  }));

  const documents = [];
  const skipped = {};
  const vouchers = all.filter((e) => e.name.toUpperCase() === "VOUCHER");
  vouchers.forEach((v, idx) => {
    const vchType = v.attrs.VCHTYPE || textOf(v, "VOUCHERTYPENAME");
    const type = tallyTypeFor(vchType, parents);
    if (!type) { skipped[vchType || "unknown"] = (skipped[vchType || "unknown"] || 0) + 1; return; }
    if (yes(textOf(v, "ISCANCELLED")) || yes(textOf(v, "ISOPTIONAL")) || yes(textOf(v, "ISDELETED"))) { skipped[`${vchType} (cancelled/optional)`] = (skipped[`${vchType} (cancelled/optional)`] || 0) + 1; return; }
    const ref = `voucher ${idx + 1} (${vchType} ${textOf(v, "VOUCHERNUMBER") || ""})`.trim();
    const vIssues = [];
    const voucherNumber = textOf(v, "VOUCHERNUMBER");
    const vDate = parseDate(textOf(v, "DATE"));
    const partyName = textOf(v, "PARTYLEDGERNAME") || textOf(v, "PARTYNAME") || textOf(v, "BASICBUYERNAME");
    const les = ledgerEntries(v).map((e) => ({
      name: textOf(e, "LEDGERNAME"), amount: abs(textOf(e, "AMOUNT")) || "0.00",
      isParty: yes(textOf(e, "ISPARTYLEDGER")),
      bills: kids(e, "BILLALLOCATIONS.LIST").map((b) => ({ name: clean(textOf(b, "NAME")), type: textOf(b, "BILLTYPE"), amount: abs(textOf(b, "AMOUNT")) || "0.00", creditDays: /(\d+)/.exec(textOf(b, "BILLCREDITPERIOD") || "")?.[1] })),
      bank: kids(e, "BANKALLOCATIONS.LIST").map((b) => ({ txType: textOf(b, "TRANSACTIONTYPE"), instrument: clean(textOf(b, "INSTRUMENTNUMBER")) || clean(textOf(b, "UNIQUEREFERENCENUMBER")), date: parseDate(textOf(b, "INSTRUMENTDATE") || textOf(b, "BANKERSDATE")) })),
    }));
    const party = les.find((e) => e.isParty) || les.find((e) => e.name === partyName) || les.find((e) => knownParty(e.name, ledgers)) || null;
    const partyLedger = ledgers.get(party?.name || partyName);
    const gstinRaw = textOf(v, "PARTYGSTIN") || partyLedger?.gstin || "";
    const g = checkGstin(gstinRaw);
    if (gstinRaw && !g.ok) vIssues.push({ field: "gstin", severity: "warning", message: `${ref}: party GSTIN ${gstinRaw} — ${g.reason}` });
    const supplier = { name: party?.name || partyName || "Unknown party", gstin: g.ok ? g.gstin : "" };
    if (!supplier.name || supplier.name === "Unknown party") vIssues.push({ field: "party", severity: "error", message: `${ref}: no party ledger` });
    if (!vDate) vIssues.push({ field: "date", severity: "error", message: `${ref}: missing or invalid DATE` });

    const lines = voucherLines(v, stock);
    const tax = { cgst: 0n, sgst: 0n, igst: 0n, cess: 0n, roundOff: 0n, tds: 0n };
    const toP = (s) => BigInt(Math.round(Number(s || 0) * 100));
    const otherLedgers = [];
    for (const e of les) {
      if (e === party) continue;
      const role = ledgerRole(e.name);
      if (role) tax[role] += toP(e.amount);
      else otherLedgers.push(e);
    }
    const fmt = (p) => `${p / 100n}.${String(p % 100n).padStart(2, "0")}`;
    const lineTaxable = lines.reduce((s, l) => s + toP(l.taxableValue), 0n);
    const source = { channel: "tally", sourceSystem: "tally", voucherType: vchType, voucherNumber, guid: textOf(v, "GUID") || v.attrs.REMOTEID || "", masterId: textOf(v, "MASTERID") };
    const narration = textOf(v, "NARRATION");

    if (type === "PAYMENT_OUT") {
      const bankLe = otherLedgers.find((e) => e.bank.length) || otherLedgers[0];
      const bank = bankLe?.bank?.[0] || {};
      const amount = bankLe?.amount || party?.amount;
      const txType = String(bank.txType || "").toUpperCase();
      const mode = /RTGS/.test(txType) ? "RTGS" : /NEFT|E-FUND|ELECTRONIC/.test(txType) ? "NEFT" : /IMPS/.test(txType) ? "IMPS" : /UPI/.test(txType) ? "UPI" : /CHEQUE|CHQ|DD/.test(txType) ? "CHEQUE" : "OTHER";
      const instrument = String(bank.instrument || "").toUpperCase().replace(/\s/g, "");
      documents.push({
        kind: "document", ref, type, number: voucherNumber, date: vDate, supplier, narration, source, issues: vIssues,
        payment: {
          amount, mode, valueDate: bank.date || vDate,
          utr: /^[A-Z0-9]{6,35}$/.test(instrument) && mode !== "CHEQUE" ? instrument : null,
          chequeNo: mode === "CHEQUE" ? instrument : null,
          tdsAmount: tax.tds ? fmt(tax.tds) : null,
          allocations: (party?.bills || []).filter((b) => b.name && /agst/i.test(b.type || "agst")).map((b) => ({ invoiceNumber: b.name, amount: b.amount })),
          onAccount: (party?.bills || []).filter((b) => /on\s*account|advance/i.test(b.type)).reduce((s, b) => s + Number(b.amount), 0) || 0,
        },
      });
      return;
    }

    const taxable = lineTaxable || otherLedgers.reduce((s, e) => s + toP(e.amount), 0n);
    const taxTotal = tax.cgst + tax.sgst + tax.igst;
    // single effective rate across the voucher: fill missing line rates when it is a GST slab
    const effRate = taxable > 0n && taxTotal > 0n ? normGstRate(String(Number(taxTotal * 10000n / taxable) / 100)) : null;
    for (const l of lines) if (!l.gstRate && effRate) l.gstRate = effRate;
    const grand = party ? toP(party.amount) : taxable + taxTotal + tax.cess;
    const roundOff = grand - (taxable + taxTotal + tax.cess);
    const totals = (type === "INVOICE_IN" || type === "DEBIT_NOTE_OUT") ? {
      taxable: fmt(taxable), cgst: fmt(tax.cgst), sgst: fmt(tax.sgst), igst: fmt(tax.igst), cess: fmt(tax.cess),
      roundOff: roundOff >= 0n ? fmt(roundOff) : `-${fmt(-roundOff)}`, grand: fmt(grand),
    } : (lineTaxable ? { taxable: fmt(lineTaxable) } : undefined);
    const bills = party?.bills || [];
    const creditDays = bills.map((b) => Number(b.creditDays)).find((n) => Number.isFinite(n)) ?? partyLedger?.creditDays;
    const doc = {
      kind: "document", ref, type, date: vDate, supplier, narration, source, issues: vIssues, lines, totals,
      number: type === "INVOICE_IN" ? (textOf(v, "REFERENCE") || voucherNumber) : voucherNumber,
      invoiceDate: type === "INVOICE_IN" ? (parseDate(textOf(v, "REFERENCEDATE")) || vDate) : undefined,
      placeOfSupply: textOf(v, "PLACEOFSUPPLY"),
      gst: {
        ...(textOf(v, "IRN") ? { irn: textOf(v, "IRN") } : {}),
        ...(findAll(v, "EWAYBILLDETAILS.LIST").length ? { ewayBillNo: textOf(findAll(v, "EWAYBILLDETAILS.LIST")[0], "BILLNUMBER") } : {}),
      },
      terms: creditDays !== undefined ? { creditDays } : undefined,
      refs: {
        invoiceNumber: type === "DEBIT_NOTE_OUT" ? (bills.find((b) => /agst/i.test(b.type || ""))?.name || "") : "",
      },
    };
    if (type === "INVOICE_IN" && !textOf(v, "REFERENCE")) vIssues.push({ field: "number", severity: "warning", message: `${ref}: no supplier invoice number (REFERENCE) — the Tally voucher number is used` });
    if (type !== "DEBIT_NOTE_OUT" && !lines.length && type !== "INVOICE_IN") vIssues.push({ field: "lines", severity: "error", message: `${ref}: no inventory lines` });
    documents.push(doc);
  });

  const stats = {
    vouchers: vouchers.length, documents: documents.length, suppliers: suppliers.length, items: items.length,
    byType: documents.reduce((m, d) => ({ ...m, [d.type]: (m[d.type] || 0) + 1 }), {}),
    skipped,
  };
  return { suppliers, items, documents, issues, stats };
};
