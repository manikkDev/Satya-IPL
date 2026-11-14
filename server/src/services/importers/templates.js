// CSV / XLSX templates for master and document imports.
//
// One flat sheet per kind. Document kinds repeat the header columns on every
// line row; rows sharing the same document number (and supplier) become one
// document. Column headers are matched loosely (case, spaces, "*" and
// punctuation ignored) and common synonyms are accepted, so a customer's
// own export with "Vendor GSTIN" or "Bill No" still maps.
import { normHeader } from "./csv.js";
import { parseDate, parseAmount, parseQty, normUom, checkGstin, checkPan, checkUdyam, checkHsn, normGstRate, parseBool, normInvNo } from "./normalize.js";

const col = (key, label, opts = {}) => ({ key, label, ...opts });

const SUPPLIER_REF = [
  col("supplier_gstin", "Supplier GSTIN", { aliases: ["vendor gstin", "party gstin", "gstin", "gstin uin", "ctin"], example: "27AAHCS6742Q1ZJ", help: "Preferred way to identify the supplier" }),
  col("supplier_name", "Supplier name", { aliases: ["vendor name", "party name", "supplier", "vendor", "party", "ledger name"], example: "Shakti Industrial Suppliers Pvt Ltd" }),
];
const LINE_COLS = [
  col("line_no", "Line no", { aliases: ["line", "sl no", "s no", "sr no", "line number"], example: "1" }),
  col("item_code", "Item code", { aliases: ["sku", "item", "part no", "material code", "product code"], example: "PMP-MB-2HP" }),
  col("description", "Description", { aliases: ["item description", "item name", "particulars", "material description", "product"], example: "Monoblock pump 2 HP, single-phase" }),
  col("hsn", "HSN/SAC", { aliases: ["hsn", "hsn code", "sac", "hsn sac code"], example: "84137010" }),
  col("qty", "Quantity", { aliases: ["qty", "quantity ordered", "order qty"], example: "15" }),
  col("uom", "Unit", { aliases: ["uom", "unit of measure", "units"], example: "Nos" }),
  col("rate", "Rate", { aliases: ["unit price", "price", "rate per unit", "unit rate"], example: "9850.00" }),
  col("gst_rate", "GST %", { aliases: ["gst rate", "tax rate", "gst", "igst rate"], example: "5" }),
];

export const TEMPLATES = {
  suppliers: {
    label: "Suppliers (vendor master)", group: null,
    columns: [
      col("legal_name", "Legal name", { required: true, aliases: ["supplier name", "vendor name", "name", "party name", "ledger name"], example: "Shakti Industrial Suppliers Pvt Ltd" }),
      col("trade_name", "Trade name", { aliases: ["alias", "short name"], example: "Shakti Industrial" }),
      col("gstin", "GSTIN", { aliases: ["gstin uin", "gst no", "gst number"], example: "27AAHCS6742Q1ZJ" }),
      col("pan", "PAN", { aliases: ["pan no", "income tax number"], example: "AAHCS6742Q" }),
      col("udyam_number", "Udyam number", { aliases: ["udyam", "udyam registration no", "msme number", "udyam no"], example: "UDYAM-MH-26-0012345" }),
      col("msme_category", "MSME category", { aliases: ["msme type", "enterprise type", "msme"], example: "small", help: "micro, small or medium" }),
      col("payment_terms_days", "Payment terms (days)", { aliases: ["credit days", "credit period", "payment terms"], example: "45" }),
      col("tds_section", "TDS section", { aliases: ["tds", "tds nature"], example: "194Q" }),
      col("contact_name", "Contact name", { aliases: ["contact", "contact person"], example: "Vikram Shinde" }),
      col("email", "Email", { aliases: ["email id", "e mail"], example: "accounts@shaktiindustrial.example" }),
      col("phone", "Phone", { aliases: ["mobile", "phone no", "contact no"], example: "+91 98220 31457" }),
      col("address_line1", "Address", { aliases: ["address", "address line 1"], example: "Plot J-88, MIDC Bhosari" }),
      col("city", "City", { example: "Pune" }),
      col("pincode", "PIN code", { aliases: ["pin", "pincode", "postal code"], example: "411026" }),
      col("bank_account_no", "Bank account no", { aliases: ["account no", "account number", "bank account"], example: "38114562017", help: "Stored masked + hashed; goes to maker-checker approval" }),
      col("ifsc", "IFSC", { aliases: ["ifsc code"], example: "SBIN0004261" }),
      col("aato_band", "Turnover band", { aliases: ["aato band", "aato"], example: "<5cr", help: "<5cr, 5-10cr or >=10cr" }),
    ],
  },
  items: {
    label: "Items (material master)", group: null,
    columns: [
      col("code", "Item code", { required: true, aliases: ["item code", "sku", "part no", "material code", "product code"], example: "PMP-MB-2HP" }),
      col("description", "Description", { required: true, aliases: ["item name", "name", "item description", "material description"], example: "Monoblock pump 2 HP, single-phase, ISI marked" }),
      col("hsn", "HSN", { aliases: ["hsn code", "hsn sac"], example: "84137010" }),
      col("uom", "Unit", { aliases: ["uom", "base unit", "units"], example: "Nos" }),
      col("gst_rate", "GST %", { aliases: ["gst rate", "tax rate"], example: "5" }),
    ],
  },
  purchase_orders: {
    label: "Purchase orders (one row per line)", group: ["po_number"], type: "PO",
    columns: [
      col("po_number", "PO number", { required: true, aliases: ["po no", "order no", "order number", "purchase order no"], example: "PO/26-27/0412" }),
      col("po_date", "PO date", { required: true, aliases: ["order date", "date"], example: "05-11-2026" }),
      ...SUPPLIER_REF,
      ...LINE_COLS.map((c) => (c.key === "qty" || c.key === "description" || c.key === "rate" ? { ...c, required: true } : c)),
      col("discount_pct", "Discount %", { aliases: ["discount", "disc"], example: "0" }),
      col("delivery_date", "Delivery date", { aliases: ["schedule date", "due date", "required by"], example: "20-11-2026" }),
      col("payment_terms_days", "Payment terms (days)", { aliases: ["credit days"], example: "45" }),
    ],
  },
  grns: {
    label: "Goods receipts / GRN (one row per line)", group: ["grn_number"], type: "GRN",
    columns: [
      col("grn_number", "GRN number", { required: true, aliases: ["grn no", "receipt note no", "mrn no", "receipt no"], example: "GRN/26-27/0871" }),
      col("grn_date", "GRN date", { required: true, aliases: ["receipt date", "date"], example: "12-11-2026" }),
      col("po_number", "PO number", { aliases: ["po no", "order no"], example: "SATYAD/PO/26-27/000033" }),
      ...SUPPLIER_REF,
      col("po_line_no", "PO line no", { aliases: ["po line"], example: "1" }),
      ...LINE_COLS.filter((c) => ["line_no", "item_code", "description", "uom"].includes(c.key)),
      col("qty_received", "Qty received", { required: true, aliases: ["received qty", "qty", "quantity"], example: "15" }),
      col("qty_accepted", "Qty accepted", { aliases: ["accepted qty"], example: "14" }),
      col("qty_rejected", "Qty rejected", { aliases: ["rejected qty"], example: "1" }),
      col("supplier_invoice_number", "Supplier challan/invoice no", { aliases: ["challan no", "dc no", "invoice no"], example: "SIS/26-27/0241" }),
    ],
  },
  purchase_invoices: {
    label: "Purchase invoices (one row per line)", group: ["invoice_number", "supplier_gstin", "supplier_name"], type: "INVOICE_IN",
    columns: [
      col("invoice_number", "Invoice number", { required: true, aliases: ["invoice no", "bill no", "supplier invoice no", "inv no", "document number", "vendor invoice no"], example: "SIS/26-27/0241" }),
      col("invoice_date", "Invoice date", { required: true, aliases: ["bill date", "inv date", "document date", "date"], example: "12-11-2026" }),
      ...SUPPLIER_REF.map((c) => (c.key === "supplier_gstin" ? { ...c, required: true } : c)),
      col("po_number", "PO number", { aliases: ["po no", "order no"], example: "SATYAD/PO/26-27/000033" }),
      col("grn_number", "GRN number", { aliases: ["grn no", "receipt note no"], example: "GRN/26-27/0871" }),
      col("po_line_no", "PO line no", { aliases: ["po line"], example: "1" }),
      ...LINE_COLS,
      col("taxable_value", "Taxable value (line)", { aliases: ["taxable value", "taxable amount", "assessable value", "line amount", "amount"], example: "147750.00" }),
      col("invoice_taxable", "Invoice taxable total", { aliases: ["total taxable value"], example: "147750.00" }),
      col("cgst", "CGST", { aliases: ["cgst amount", "central tax"], example: "3693.75" }),
      col("sgst", "SGST/UTGST", { aliases: ["sgst amount", "utgst", "state tax"], example: "3693.75" }),
      col("igst", "IGST", { aliases: ["igst amount", "integrated tax"], example: "0.00" }),
      col("cess", "Cess", { aliases: ["cess amount"], example: "0.00" }),
      col("round_off", "Round off", { aliases: ["rounding"], example: "0.00" }),
      col("invoice_total", "Invoice total", { aliases: ["invoice value", "grand total", "total amount", "bill amount", "total"], example: "155137.50" }),
      col("irn", "IRN", { aliases: ["e invoice irn", "irn no"], example: "" }),
      col("ack_date", "IRN ack date", { aliases: ["ack date"], example: "" }),
      col("eway_bill_no", "E-way bill no", { aliases: ["eway bill", "ewb no", "e way bill no"], example: "" }),
      col("due_date", "Due date", { aliases: ["payment due date"], example: "27-12-2026" }),
    ],
  },
  debit_credit_notes: {
    label: "Debit / credit notes (one row per line)", group: ["note_number", "supplier_gstin", "supplier_name"],
    columns: [
      col("note_type", "Note type", { required: true, aliases: ["type", "document type"], example: "credit_note_in", help: "credit_note_in (from supplier) or debit_note_out (raised by you)" }),
      col("note_number", "Note number", { required: true, aliases: ["note no", "cn no", "dn no", "document number"], example: "SIS/CN/26-27/014" }),
      col("note_date", "Note date", { required: true, aliases: ["date"], example: "14-11-2026" }),
      ...SUPPLIER_REF,
      col("against_invoice_number", "Against invoice number", { aliases: ["original invoice no", "invoice no", "ref invoice"], example: "SIS/26-27/0241" }),
      ...LINE_COLS.map((c) => (c.key === "qty" ? { ...c, example: "1" } : c)),
      col("taxable_value", "Taxable value", { aliases: ["taxable amount", "amount"], example: "9850.00" }),
      col("cgst", "CGST", { example: "246.25" }), col("sgst", "SGST/UTGST", { example: "246.25" }), col("igst", "IGST", { example: "0.00" }),
      col("note_total", "Note total", { aliases: ["total", "total amount", "note value"], example: "10342.50" }),
      col("reason", "Reason", { aliases: ["remarks", "narration"], example: "1 pump rejected at QC" }),
    ],
  },
  payments: {
    label: "Supplier payments (one row per invoice settled)", group: ["payment_ref"], type: "PAYMENT_OUT",
    columns: [
      col("payment_ref", "Payment ref / voucher no", { required: true, aliases: ["voucher no", "payment voucher", "payment no", "ref no"], example: "PV/26-27/0311" }),
      col("payment_date", "Payment date", { required: true, aliases: ["date", "value date"], example: "13-11-2026" }),
      ...SUPPLIER_REF,
      col("amount", "Amount paid", { required: true, aliases: ["payment amount", "paid amount", "net amount"], example: "46020.00" }),
      col("utr", "UTR / cheque no", { aliases: ["utr no", "cheque no", "instrument no", "reference"], example: "HDFCN26317720412" }),
      col("mode", "Mode", { aliases: ["payment mode"], example: "NEFT" }),
      col("invoice_number", "Invoice number settled", { aliases: ["invoice no", "bill no", "against invoice", "bill ref"], example: "IFH-0541" }),
      col("allocated_amount", "Amount against this invoice", { aliases: ["allocated amount", "bill amount"], example: "46020.00" }),
      col("tds_amount", "TDS deducted", { aliases: ["tds"], example: "0.00" }),
      col("tds_section", "TDS section", { example: "" }),
    ],
  },
};

export const TEMPLATE_KINDS = Object.keys(TEMPLATES);

/** Header row + example row for a template (CSV/XLSX download). */
export const templateRows = (kind) => {
  const t = TEMPLATES[kind];
  return [t.columns.map((c) => `${c.label}${c.required ? " *" : ""}`), t.columns.map((c) => c.example ?? "")];
};

/** Map header cells to template keys. Returns {map: {index: key}, missing: [labels], unknown: [headers]}. */
export const mapHeaders = (kind, headers) => {
  const t = TEMPLATES[kind];
  const map = {};
  const used = new Set();
  const unknown = [];
  headers.forEach((h, i) => {
    const n = normHeader(String(h).replace(/\*/g, ""));
    if (!n) return;
    const match = t.columns.find((c) => !used.has(c.key) && (normHeader(c.label) === n || normHeader(c.key) === n))
      || t.columns.find((c) => !used.has(c.key) && (c.aliases || []).some((a) => normHeader(a) === n));
    if (match) { map[i] = match.key; used.add(match.key); } else unknown.push(String(h));
  });
  const missing = t.columns.filter((c) => c.required && !used.has(c.key)).map((c) => c.label);
  // supplier ref: at least one of gstin/name when the template has them
  return { map, missing, unknown, used };
};

/** Find the header row (first row matching ≥ 2 columns incl. a required one). */
export const findHeaderRow = (kind, rows) => {
  let best = { index: 0, score: -1 };
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const { used } = mapHeaders(kind, rows[i] || []);
    const req = TEMPLATES[kind].columns.filter((c) => c.required && used.has(c.key)).length;
    const score = used.size + req * 2;
    if (used.size >= 2 && score > best.score) best = { index: i, score };
  }
  return best.index;
};

// ---- row -> record normalisation ----------------------------------------
const issue = (line, field, message, severity = "error") => ({ line, field, severity, message });

const amountField = (row, key, line, issues, { required = false, label = key } = {}) => {
  const raw = row[key];
  if (raw === undefined || String(raw).trim() === "") {
    if (required) issues.push(issue(line, key, `${label} is required`));
    return null;
  }
  const a = parseAmount(raw);
  if (!a) { issues.push(issue(line, key, `${label} "${raw}" is not an amount`)); return null; }
  return a.value;
};
const dateField = (row, key, line, issues, { required = false, label = key } = {}) => {
  const raw = row[key];
  if (raw === undefined || String(raw).trim() === "") { if (required) issues.push(issue(line, key, `${label} is required`)); return null; }
  const d = parseDate(raw);
  if (!d) issues.push(issue(line, key, `${label} "${raw}" is not a date (use DD-MM-YYYY)`));
  return d;
};

const supplierOf = (row, line, issues, { requireGstin = false } = {}) => {
  const rawG = String(row.supplier_gstin || "").trim();
  const g = checkGstin(rawG);
  if (rawG && !g.ok) issues.push(issue(line, "supplier_gstin", `${g.reason} (${rawG})`));
  if (!rawG && requireGstin && !row.supplier_name) issues.push(issue(line, "supplier_gstin", "Supplier GSTIN (or at least the supplier name) is required"));
  if (!rawG && !row.supplier_name) issues.push(issue(line, "supplier_name", "Give the supplier GSTIN or name"));
  return { name: String(row.supplier_name || "").trim(), gstin: g.ok ? g.gstin : "" };
};

const lineOf = (row, line, issues, { qtyKey = "qty", requireQty = true } = {}) => {
  const q = parseQty(row[qtyKey]);
  if (requireQty && (!q || !(Number(q.qty) > 0))) issues.push(issue(line, qtyKey, `Quantity "${row[qtyKey] ?? ""}" must be a number above zero`));
  const hsnRaw = String(row.hsn || "").trim();
  const h = checkHsn(hsnRaw);
  if (hsnRaw && !h.ok) issues.push(issue(line, "hsn", `HSN "${hsnRaw}" must be 4–8 digits`, "warning"));
  const rateRaw = String(row.gst_rate ?? "").trim();
  const gstRate = normGstRate(rateRaw);
  if (rateRaw && gstRate === undefined) issues.push(issue(line, "gst_rate", `GST rate "${rateRaw}" is not a GST slab`, "warning"));
  const rate = row.rate !== undefined && String(row.rate).trim() !== "" ? parseAmount(row.rate)?.value : null;
  if (row.rate !== undefined && String(row.rate).trim() !== "" && !rate) issues.push(issue(line, "rate", `Rate "${row.rate}" is not an amount`));
  return {
    lineNo: Number.parseInt(row.line_no, 10) || undefined,
    sku: String(row.item_code || "").trim(),
    description: String(row.description || row.item_code || "").trim(),
    hsn: h.ok ? h.hsn : "",
    qty: q?.qty || "",
    uom: normUom(row.uom || q?.uom),
    rate: rate || "",
    gstRate: gstRate || "",
    discountPct: row.discount_pct ? String(Number(String(row.discount_pct).replace(/%/g, "")) || "") : "",
    taxableValue: row.taxable_value ? parseAmount(row.taxable_value)?.value || "" : "",
    poNumber: String(row.po_number || "").trim(),
    poLineNo: Number.parseInt(row.po_line_no, 10) || undefined,
    grnNumber: String(row.grn_number || "").trim(),
    acceptedQty: row.qty_accepted ? parseQty(row.qty_accepted)?.qty : undefined,
    rejectedQty: row.qty_rejected ? parseQty(row.qty_rejected)?.qty : undefined,
    scheduleDate: row.delivery_date ? parseDate(row.delivery_date) || undefined : undefined,
    fileLine: line,
  };
};

const NOTE_TYPES = { credit_note_in: "CREDIT_NOTE_IN", "credit note": "CREDIT_NOTE_IN", cn: "CREDIT_NOTE_IN", credit: "CREDIT_NOTE_IN", debit_note_out: "DEBIT_NOTE_OUT", "debit note": "DEBIT_NOTE_OUT", dn: "DEBIT_NOTE_OUT", debit: "DEBIT_NOTE_OUT" };
const MODES = { NEFT: "NEFT", RTGS: "RTGS", IMPS: "IMPS", UPI: "UPI", CHEQUE: "CHEQUE", CHQ: "CHEQUE", CHECK: "CHEQUE", DD: "CHEQUE" };

/**
 * Rows (objects keyed by template key, each with __line) -> records + issues.
 * channel: "csv" | "excel".
 */
export const recordsFromTemplate = (kind, rows, channel) => {
  const t = TEMPLATES[kind];
  const records = [];
  const source = (lines) => ({ channel, sourceSystem: "template", template: kind, lines });
  if (kind === "suppliers") {
    for (const row of rows) {
      const line = row.__line;
      const issues = [];
      const name = String(row.legal_name || "").trim();
      if (name.length < 2) issues.push(issue(line, "legal_name", "Legal name is required"));
      const g = checkGstin(row.gstin);
      if (!g.empty && !g.ok) issues.push(issue(line, "gstin", `${g.reason} (${row.gstin})`));
      const p = checkPan(row.pan || (g.ok ? g.pan : ""));
      if (!p.empty && !p.ok) issues.push(issue(line, "pan", `PAN "${row.pan}" must look like AAAAA9999A`));
      if (g.ok && row.pan && p.ok && g.pan !== p.pan) issues.push(issue(line, "pan", `PAN ${p.pan} does not match the PAN inside GSTIN (${g.pan})`));
      const u = checkUdyam(row.udyam_number);
      if (!u.empty && !u.ok) issues.push(issue(line, "udyam_number", `Udyam number "${row.udyam_number}" should look like UDYAM-MH-26-0012345`, "warning"));
      const cat = String(row.msme_category || "").trim().toLowerCase();
      if (cat && !["micro", "small", "medium"].includes(cat)) issues.push(issue(line, "msme_category", `MSME category "${row.msme_category}" must be micro, small or medium`, "warning"));
      if (u.ok && !cat) issues.push(issue(line, "msme_category", "Udyam number given without a category — MSME payment deadlines need micro/small/medium", "warning"));
      const terms = row.payment_terms_days ? Number.parseInt(row.payment_terms_days, 10) : undefined;
      const acct = String(row.bank_account_no || "").replace(/\s/g, "");
      const ifsc = String(row.ifsc || "").toUpperCase().trim();
      if (acct && !/^\d{9,18}$/.test(acct)) issues.push(issue(line, "bank_account_no", "Bank account number must be 9–18 digits", "warning"));
      if (acct && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) issues.push(issue(line, "ifsc", `IFSC "${row.ifsc || ""}" must look like SBIN0001234`, "warning"));
      const aato = String(row.aato_band || "").replace(/\s/g, "");
      records.push({
        kind: "supplier", ref: `row ${line}`, legalName: name, tradeName: String(row.trade_name || "").trim(),
        gstin: g.ok ? g.gstin : "", stateCode: g.ok ? g.stateCode : "", pan: p.ok ? p.pan : "",
        udyam: u.ok ? u.udyam : "", msmeCategory: ["micro", "small", "medium"].includes(cat) ? cat : "",
        paymentTermsDays: Number.isFinite(terms) ? terms : undefined,
        tdsSection: /^19[0-9][A-Z]{0,2}$/i.test(String(row.tds_section || "").trim()) ? String(row.tds_section).trim().toUpperCase() : "",
        contactName: String(row.contact_name || "").trim(), email: String(row.email || "").trim(), phone: String(row.phone || "").trim(),
        address: row.address_line1 || row.city || row.pincode ? { line1: String(row.address_line1 || "").trim(), city: String(row.city || "").trim(), pin: /^\d{6}$/.test(String(row.pincode || "").trim()) ? String(row.pincode).trim() : undefined, stateCode: g.ok ? g.stateCode : undefined } : null,
        bank: /^\d{9,18}$/.test(acct) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) ? { accountNo: acct, ifsc } : null,
        aatoBand: ["<5cr", "5-10cr", ">=10cr"].includes(aato) ? aato : undefined,
        einvoiceApplicable: aato === ">=10cr" ? true : undefined,
        issues, source: source([line]),
      });
    }
    return records;
  }
  if (kind === "items") {
    for (const row of rows) {
      const line = row.__line;
      const issues = [];
      const code = String(row.code || "").trim().toUpperCase();
      if (!code) issues.push(issue(line, "code", "Item code is required"));
      if (!String(row.description || "").trim()) issues.push(issue(line, "description", "Description is required"));
      const h = checkHsn(row.hsn);
      if (!h.empty && !h.ok) issues.push(issue(line, "hsn", `HSN "${row.hsn}" must be 4–8 digits`));
      const r = normGstRate(row.gst_rate);
      if (r === undefined) issues.push(issue(line, "gst_rate", `GST rate "${row.gst_rate}" is not a GST slab`, "warning"));
      records.push({ kind: "item", ref: `row ${line}`, code: code.slice(0, 40), description: String(row.description || "").trim(), hsn: h.ok ? h.hsn : "", uom: normUom(row.uom), gstRate: r || "", issues, source: source([line]) });
    }
    return records;
  }

  // document kinds: group rows into documents
  const groups = new Map();
  for (const row of rows) {
    const key = (t.group || []).map((k) => normInvNo(row[k]) || String(row[k] || "").trim().toLowerCase()).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [, grp] of groups) {
    const head = grp[0];
    const line = head.__line;
    const issues = [];
    const lines = grp.map((r) => r.__line);
    const ref = lines.length > 1 ? `rows ${lines[0]}–${lines[lines.length - 1]}` : `row ${line}`;
    if (kind === "payments") {
      const amount = amountField(head, "amount", line, issues, { required: true, label: "Amount paid" });
      const date = dateField(head, "payment_date", line, issues, { required: true, label: "Payment date" });
      const supplier = supplierOf(head, line, issues);
      const rawMode = String(head.mode || "").trim().toUpperCase();
      const mode = rawMode ? MODES[rawMode] || "OTHER" : "OTHER";
      const utr = String(head.utr || "").toUpperCase().replace(/\s/g, "");
      if (utr && !/^[A-Z0-9]{6,35}$/.test(utr)) issues.push(issue(line, "utr", `UTR "${head.utr}" should be 6–35 letters/digits`, "warning"));
      const allocations = grp.filter((r) => String(r.invoice_number || "").trim()).map((r) => ({
        invoiceNumber: String(r.invoice_number).trim(),
        amount: amountField(r, "allocated_amount", r.__line, issues, { label: "Amount against this invoice" }) || (grp.length === 1 ? amount : null),
        fileLine: r.__line,
      }));
      const tds = amountField(head, "tds_amount", line, issues, { label: "TDS deducted" });
      records.push({
        kind: "document", ref, type: "PAYMENT_OUT", number: String(head.payment_ref || "").trim(), date, supplier, issues, source: source(lines),
        payment: { amount, mode, valueDate: date, utr: /^[A-Z0-9]{6,35}$/.test(utr) && mode !== "CHEQUE" ? utr : null, chequeNo: mode === "CHEQUE" ? utr : null, tdsAmount: tds && Number(tds) > 0 ? tds : null, tdsSection: String(head.tds_section || "").trim().toUpperCase() || null, allocations },
      });
      continue;
    }
    if (kind === "debit_credit_notes") {
      const type = NOTE_TYPES[String(head.note_type || "").trim().toLowerCase()];
      if (!type) issues.push(issue(line, "note_type", `Note type "${head.note_type || ""}" must be credit_note_in or debit_note_out`));
      const date = dateField(head, "note_date", line, issues, { required: true, label: "Note date" });
      const supplier = supplierOf(head, line, issues);
      const docLines = grp.map((r, i) => ({ ...lineOf(r, r.__line, issues, { requireQty: false }), lineNo: Number.parseInt(r.line_no, 10) || i + 1 })).filter((l) => l.description || l.taxableValue);
      const taxable = amountField(head, "taxable_value", line, issues, { label: "Taxable value" });
      const totals = {
        taxable: grp.length > 1 ? sumOf(grp.map((r) => parseAmount(r.taxable_value)?.value)) : taxable,
        cgst: amountField(head, "cgst", line, issues) || "0.00", sgst: amountField(head, "sgst", line, issues) || "0.00", igst: amountField(head, "igst", line, issues) || "0.00", cess: "0.00", roundOff: "0.00",
        grand: amountField(head, "note_total", line, issues, { required: true, label: "Note total" }),
      };
      records.push({ kind: "document", ref, type: type || "CREDIT_NOTE_IN", number: String(head.note_number || "").trim(), date, supplier, lines: docLines, totals, refs: { invoiceNumber: String(head.against_invoice_number || "").trim() }, narration: String(head.reason || "").trim(), issues, source: source(lines) });
      continue;
    }
    if (kind === "purchase_orders") {
      const date = dateField(head, "po_date", line, issues, { required: true, label: "PO date" });
      const supplier = supplierOf(head, line, issues);
      const docLines = grp.map((r, i) => ({ ...lineOf(r, r.__line, issues), lineNo: Number.parseInt(r.line_no, 10) || i + 1 }));
      for (const l of docLines) if (!l.rate) issues.push(issue(l.fileLine, "rate", "Rate is required on purchase order lines"));
      const terms = Number.parseInt(head.payment_terms_days, 10);
      records.push({ kind: "document", ref, type: "PO", number: String(head.po_number || "").trim(), date, supplier, lines: docLines, terms: Number.isFinite(terms) ? { creditDays: terms } : undefined, issues, source: source(lines) });
      continue;
    }
    if (kind === "grns") {
      const date = dateField(head, "grn_date", line, issues, { required: true, label: "GRN date" });
      const supplier = supplierOf(head, line, issues);
      const docLines = grp.map((r, i) => ({ ...lineOf(r, r.__line, issues, { qtyKey: "qty_received" }), lineNo: Number.parseInt(r.line_no, 10) || i + 1, poNumber: String(r.po_number || head.po_number || "").trim() }));
      records.push({ kind: "document", ref, type: "GRN", number: String(head.grn_number || "").trim(), date, supplier, lines: docLines, refs: { supplierInvoiceNumber: String(head.supplier_invoice_number || "").trim() }, issues, source: source(lines) });
      continue;
    }
    if (kind === "purchase_invoices") {
      const date = dateField(head, "invoice_date", line, issues, { required: true, label: "Invoice date" });
      const supplier = supplierOf(head, line, issues, { requireGstin: true });
      const docLines = grp.map((r, i) => ({ ...lineOf(r, r.__line, issues, { requireQty: false }), lineNo: Number.parseInt(r.line_no, 10) || i + 1, poNumber: String(r.po_number || head.po_number || "").trim(), grnNumber: String(r.grn_number || head.grn_number || "").trim() }))
        .filter((l) => l.description || l.qty || l.taxableValue);
      const lineTaxable = sumOf(docLines.map((l) => l.taxableValue || (l.qty && l.rate ? mul(l.qty, l.rate) : null)));
      const taxable = amountField(head, "invoice_taxable", line, issues) || (Number(lineTaxable) > 0 ? lineTaxable : null);
      const cgst = amountField(head, "cgst", line, issues) || "0.00";
      const sgst = amountField(head, "sgst", line, issues) || "0.00";
      const igst = amountField(head, "igst", line, issues) || "0.00";
      const cess = amountField(head, "cess", line, issues) || "0.00";
      const roundOff = head.round_off ? (parseAmount(head.round_off)?.sign < 0 ? `-${parseAmount(head.round_off).value}` : parseAmount(head.round_off)?.value || "0.00") : "0.00";
      const grand = amountField(head, "invoice_total", line, issues, { required: true, label: "Invoice total" });
      if (!taxable) issues.push(issue(line, "invoice_taxable", "Give line taxable values or the invoice taxable total"));
      if (taxable && grand) {
        const diff = Math.abs(Number(taxable) + Number(cgst) + Number(sgst) + Number(igst) + Number(cess) + Number(roundOff) - Number(grand));
        if (diff > 1) issues.push(issue(line, "invoice_total", `Totals don't add up: taxable ${taxable} + taxes = ${(Number(grand) - diff).toFixed(2)}, invoice total says ${grand}`, "warning"));
      }
      if (Number(cgst) !== Number(sgst)) issues.push(issue(line, "sgst", "CGST and SGST should be equal on an intra-state invoice", "warning"));
      if (Number(igst) > 0 && Number(cgst) > 0) issues.push(issue(line, "igst", "Invoice carries both IGST and CGST/SGST", "warning"));
      const ack = head.ack_date ? parseDate(head.ack_date) : null;
      records.push({
        kind: "document", ref, type: "INVOICE_IN", number: String(head.invoice_number || "").trim(), date, supplier, lines: docLines,
        totals: { taxable, cgst, sgst, igst, cess, roundOff, grand },
        gst: { ...(head.irn ? { irn: String(head.irn).trim() } : {}), ...(ack ? { ackDate: `${ack}T00:00:00+05:30` } : {}), ...(head.eway_bill_no ? { ewayBillNo: String(head.eway_bill_no).trim() } : {}) },
        terms: head.due_date && parseDate(head.due_date) ? { dueDate: parseDate(head.due_date) } : undefined,
        issues, source: source(lines),
      });
    }
  }
  return records;
};

const toP = (v) => BigInt(Math.round(Number(v || 0) * 100));
const fromP = (p) => `${p < 0n ? "-" : ""}${(p < 0n ? -p : p) / 100n}.${String((p < 0n ? -p : p) % 100n).padStart(2, "0")}`;
const sumOf = (values) => fromP(values.reduce((s, v) => s + (v ? toP(v) : 0n), 0n));
const mul = (qty, rate) => fromP(BigInt(Math.round(Number(qty) * Number(rate) * 100)));

/** Rows (string[][]) -> keyed objects for a template kind. */
export const keyedRows = (kind, rows) => {
  const headerIndex = findHeaderRow(kind, rows);
  const { map, missing, unknown } = mapHeaders(kind, rows[headerIndex] || []);
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => String(c).trim())) continue;
    // skip a copied example row ("e.g." or exactly the template example)
    const obj = {};
    for (const [idx, key] of Object.entries(map)) obj[key] = r[idx] ?? "";
    Object.defineProperty(obj, "__line", { value: i + 1, enumerable: false });
    out.push(obj);
  }
  return { rows: out, headerIndex, missing, unknown, mapping: Object.fromEntries(Object.entries(map).map(([i, k]) => [k, rows[headerIndex][i]])) };
};

export { parseBool };
