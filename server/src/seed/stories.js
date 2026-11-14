// The curated demo's purchase orders — one explainable situation each.
//
// Days are "days before the seed run date" (IST), so the dataset never
// drifts into the future. Every event lists its own day; build.js turns the
// lines into fully-computed documents and validate.js checks chronology.
//
// po.lines: [itemCode, qty, rate, scheduleDaysAfterPo]
// events:
//   GRN  { day, lines: {lineNo: qty}, challan?, remarks? }
//   QC   { day, lines: {lineNo: [inspected, accepted, rejectReason?]} }
//   RET  { day, lines: {lineNo: qty}, remarks? }
//   INV  { key, day, lines: {lineNo: qty}, rates?: {lineNo: rate}, number?,
//          channel?, noEway?, gstinTypo?, forceIgst? }
//   CN   { key, day, invoice, lines: {lineNo: qty}, number?, remarks? }
//   PAY  { key, day, mode, alloc: [[invoiceKey, "full"|"rest"|amount]] }
//   PAY  { key, day, mode, unreferenced: amount }        (no invoice named)
//
// expected: finding codes the engine SHOULD raise for the story once the
// pending engine/server fixes land (see docs/DEMO_DATASET.md). An empty list
// means the order reconciles clean.
//
// owner: the matching story from the owner's scripts/legacy/enrich-demo-orders.mjs
// (re-dated into FY 2026-27, identities and arithmetic corrected).

export const STORIES = [
  // ───────────────────────────── owner's 11 stories ─────────────────────────────
  {
    id: "S01", owner: "000001", supplier: "shakti", kind: "clean",
    title: "Clean 3-way match — two pump sizes received, inspected, billed and paid in full",
    po: { day: 205, lines: [["PMP-CF-5HP", "10", "21400", 12], ["PMP-CF-3HP", "6", "16850", 12]] },
    events: [
      { type: "GRN", day: 193, lines: { 1: "10", 2: "6" }, remarks: "Received at gate 2 against challan; all quantities OK" },
      { type: "QC", day: 192, lines: { 1: ["10", "10"], 2: ["6", "6"] } },
      { type: "INV", key: "i1", day: 191, lines: { 1: "10", 2: "6" } },
      { type: "PAY", key: "p1", day: 160, mode: "RTGS", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S02", owner: "000002", supplier: "kaveri", kind: "partial_delivery",
    title: "Partial delivery — 12 of 20 and 6 of 10 submersibles received and billed; balance lot pending",
    po: { day: 70, lines: [["PMP-SUB-3HP", "20", "24800", 20], ["PMP-SUB-5HP", "10", "33600", 20]] },
    events: [
      { type: "GRN", day: 58, lines: { 1: "12", 2: "6" }, remarks: "First lot — supplier confirms balance 8 + 4 on next truck" },
      { type: "QC", day: 57, lines: { 1: ["12", "12"], 2: ["6", "6"] } },
      { type: "INV", key: "i1", day: 56, lines: { 1: "12", 2: "6" } },
      { type: "PAY", key: "p1", day: 27, mode: "RTGS", alloc: [["i1", "full"]] },
    ],
    expected: ["DELIVERY_SHORTFALL"], poStatus: "partially_fulfilled", caseStatus: "open",
  },
  {
    id: "S03", owner: "000003", supplier: "rathod", kind: "duplicate_invoice",
    title: "Duplicate invoice — REW/26-27/0201 arrived by email and again via the supplier portal",
    po: { day: 100, lines: [["VLV-SLU-100", "8", "9400", 10]] },
    events: [
      { type: "GRN", day: 90, lines: { 1: "8" }, remarks: "All 8 valves received with hydro-test certificates" },
      { type: "QC", day: 89, lines: { 1: ["8", "8"] } },
      { type: "INV", key: "i1", day: 88, lines: { 1: "8" }, number: "REW/26-27/0201", channel: "upload_pdf" },
      { type: "INV", key: "i2", day: 81, lines: { 1: "8" }, number: "REW/26-27/0201", channel: "api", duplicateOf: "i1", sameDateAs: "i1" },
      { type: "PAY", key: "p1", day: 60, mode: "NEFT", alloc: [["i1", "full"]] },
    ],
    expected: ["DUPLICATE_INVOICE_SUSPECT", "DUP_EXACT_INVOICE", "INVOICE_QTY_EXCEEDS_RECEIVED", "QTY_INVOICED_EXCEEDS_ACCEPTED"],
    poStatus: "fulfilled", caseStatus: "in_review",
    notes: "Original was paid; the portal copy is the same obligation and must be rejected, not paid.",
  },
  {
    id: "S04", owner: "000004", supplier: "deccan", kind: "over_billed",
    title: "Over-billed — invoice for 10 NRVs, only 8 received (2 damaged, sent back on the same challan); undisputed 8 paid",
    po: { day: 95, lines: [["VLV-NRV-80", "10", "5600", 8]] },
    events: [
      { type: "GRN", day: 85, lines: { 1: "8" }, remarks: "8 of 10 accepted at gate — 2 cracked bodies refused and returned with the truck" },
      { type: "QC", day: 84, lines: { 1: ["8", "8"] } },
      { type: "INV", key: "i1", day: 84, lines: { 1: "10" } },
      { type: "PAY", key: "p1", day: 60, mode: "NEFT", alloc: [["i1", "52864.00"]] },
    ],
    expected: ["INVOICE_QTY_EXCEEDS_RECEIVED", "QTY_INVOICED_EXCEEDS_ACCEPTED", "DELIVERY_SHORTFALL"],
    poStatus: "partially_fulfilled", caseStatus: "on_hold",
    msmeOverdueAllowed: true,
    notes: "₹13,216.00 (2 × ₹5,600 + 18% GST) held pending Deccan's credit note.",
  },
  {
    id: "S05", owner: "000005", supplier: "maratha", kind: "qc_rejection_pending",
    title: "QC rejection — 4 of 50 bearings failed the run test and went back; replacements awaited, not yet invoiced",
    po: { day: 40, lines: [["BRG-6310ZZ", "50", "1180", 8], ["HSG-SN511", "12", "2350", 8]] },
    events: [
      { type: "GRN", day: 30, lines: { 1: "50", 2: "12" } },
      { type: "QC", day: 29, lines: { 1: ["50", "46", "Noise above limit on sample run test"], 2: ["12", "12"] } },
      { type: "RET", day: 27, lines: { 1: "4" }, remarks: "4 bearings returned for replacement under the supplier's warranty" },
    ],
    expected: ["DELIVERY_SHORTFALL", "DOC_MISSING_INVOICE"],
    poStatus: "partially_fulfilled", caseStatus: "open",
  },
  {
    id: "S06", owner: "000006", supplier: "shakti", kind: "invoice_without_receipt",
    title: "Invoice without receipt — 15 pumps billed, nothing has reached any gate",
    po: { day: 22, lines: [["PMP-MB-2HP", "15", "9850", 10]] },
    events: [
      { type: "INV", key: "i1", day: 14, lines: { 1: "15" }, channel: "api" },
    ],
    allowInvoiceBeforeReceipt: true,
    expected: ["RECEIPT_EVIDENCE_MISSING", "INVOICE_QTY_EXCEEDS_RECEIVED", "DELIVERY_SHORTFALL"],
    poStatus: "issued", caseStatus: "in_review",
  },
  {
    id: "S07", owner: "000007", supplier: "kaveri", kind: "unreferenced_payment",
    title: "Paid in full, plus a ₹12,000 bank debit to Kaveri with no invoice reference",
    po: { day: 120, lines: [["MTR-FLP-7.5", "4", "38500", 10]] },
    events: [
      { type: "GRN", day: 110, lines: { 1: "4" } },
      { type: "QC", day: 109, lines: { 1: ["4", "4"] } },
      { type: "INV", key: "i1", day: 108, lines: { 1: "4" } },
      { type: "PAY", key: "p1", day: 85, mode: "NEFT", alloc: [["i1", "full"]] },
      { type: "PAY", key: "p2", day: 80, mode: "NEFT", unreferenced: "12000.00" },
    ],
    expected: ["PAY_UNALLOCATED"], poStatus: "fulfilled", caseStatus: "in_review",
    notes: "Owner's original used ₹15,000; changed to ₹12,000 so it is not confused with the flagship's ₹15,000 T03.",
  },
  {
    id: "S08", owner: "000008", supplier: "rathod", kind: "delivery_slipped",
    title: "Delivery slipped — first batch was due 25 days ago, nothing received (LD clause applies)",
    po: {
      day: 45, lines: [["GSK-SPW-100", "60", "640", 20], ["ELB-BW-100", "30", "1150", 20]],
      freeText: ["Liquidated damages @ 0.5% of order value per week of delay, capped at 5%"],
    },
    events: [],
    expected: ["DELIVERY_SHORTFALL"], poStatus: "acknowledged", caseStatus: "open",
  },
  {
    id: "S09", owner: "000009", supplier: "deccan", kind: "short_close",
    title: "Short-closed — scope cut, closed at 16 of 25 butterfly valves with supplier consent; 16 billed and paid",
    po: { day: 130, lines: [["VLV-BFV-150", "25", "7400", 10]] },
    events: [
      { type: "GRN", day: 118, lines: { 1: "16" } },
      { type: "QC", day: 117, lines: { 1: ["16", "16"] } },
      { type: "INV", key: "i1", day: 116, lines: { 1: "16" } },
      { type: "SHORT_CLOSE", day: 100, lines: { 1: "16" }, reason: "Project scope reduced — closed at 16 delivered units with Deccan's written consent (originally 25)" },
      { type: "PAY", key: "p1", day: 92, mode: "NEFT", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "short_closed", caseStatus: "resolved",
  },
  {
    id: "S10", owner: "000010", supplier: "maratha", kind: "clean",
    title: "Clean multi-line — pulleys, bushes and housings received, billed and paid",
    po: { day: 180, lines: [["PUL-2G-200", "24", "1150", 8], ["BSH-TL-2517", "24", "310", 8], ["HSG-SN511", "8", "2350", 8]] },
    events: [
      { type: "GRN", day: 170, lines: { 1: "24", 2: "24", 3: "8" } },
      { type: "QC", day: 169, lines: { 1: ["24", "24"], 2: ["24", "24"], 3: ["8", "8"] } },
      { type: "INV", key: "i1", day: 168, lines: { 1: "24", 2: "24", 3: "8" } },
      { type: "PAY", key: "p1", day: 145, mode: "NEFT", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S11", owner: "000011", supplier: "shakti", kind: "first_lot",
    title: "First lot only — 3 of 10 pumps in, balance 7 in transit, not yet invoiced",
    po: { day: 12, lines: [["PMP-CF-5HP", "10", "21400", 14]] },
    events: [
      { type: "GRN", day: 4, lines: { 1: "3" }, remarks: "First lot of 3 — balance 7 in transit per supplier's LR" },
    ],
    expected: ["DELIVERY_SHORTFALL", "DOC_MISSING_INVOICE"],
    poStatus: "partially_fulfilled", caseStatus: "open",
  },

  // ───────────────────────────── flagship (README) ─────────────────────────────
  {
    id: "S12", supplier: "meridian", kind: "flagship", externalRef: "PO-1001",
    title: "Flagship PO-1001 — 60 of 100 received, ₹70,800 invoice posted twice, ₹30,000 + ₹20,800 settled, ₹15,000 unallocated",
    po: { day: 40, lines: [["PMP-IMP-CP100", "100", "1000", 46]] },
    events: [
      { type: "GRN", key: "gA", day: 31, lines: { 1: "40" }, remarks: "Lot 1 — 40 kits" },
      { type: "GRN", key: "gB", day: 27, lines: { 1: "20" }, remarks: "Lot 2 — 20 kits; balance 40 outstanding" },
      { type: "QC", day: 26, lines: { 1: ["60", "60"] }, grnSplit: { gA: "40", gB: "20" } },
      { type: "INV", key: "i1", day: 25, lines: { 1: "60" }, number: "MPS/26-27/041", channel: "upload_pdf" },
      { type: "PAY", key: "t01", day: 20, mode: "NEFT", alloc: [["i1", "30000.00"]], label: "T01" },
      { type: "PAY", key: "t02", day: 16, mode: "NEFT", alloc: [["i1", "20800.00"]], label: "T02" },
      { type: "INV", key: "i2", day: 14, lines: { 1: "60" }, number: "MPS-26-27-041", channel: "csv", duplicateOf: "i1", sameDateAs: "i1" },
      { type: "PAY", key: "t03", day: 12, mode: "NEFT", unreferenced: "15000.00", label: "T03" },
    ],
    expected: ["INVOICE_QTY_EXCEEDS_RECEIVED", "QTY_INVOICED_EXCEEDS_ACCEPTED", "DELIVERY_SHORTFALL", "PAY_SPLIT", "PAY_UNALLOCATED"],
    poStatus: "partially_fulfilled", caseStatus: "open", priority: "high",
    notes: "Recorded AP ₹1,41,600 (two postings) − settled ₹50,800 = ₹90,800 posting-based open; receipt-supported outstanding ₹20,000; T03 ₹15,000 never deducted twice. The second posting re-keys the number (MPS-26-27-041) so the exact-duplicate rule does not fire — the over-billing rule surfaces it.",
  },
  {
    id: "S13", supplier: "meridian", kind: "clean_unpaid", externalRef: "PO-1002",
    title: "PO-1002 — 15 kits received and billed (MPS/26-27/042 ₹17,700), not yet due; a candidate for T03",
    po: { day: 38, lines: [["PMP-IMP-CP100", "15", "1000", 10]] },
    events: [
      { type: "GRN", day: 26, lines: { 1: "15" } },
      { type: "QC", day: 25, lines: { 1: ["15", "15"] } },
      { type: "INV", key: "i1", day: 22, lines: { 1: "15" }, number: "MPS/26-27/042" },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "open",
  },

  // ───────────────────────────── other discrepancy stories ─────────────────────────────
  {
    id: "S14", supplier: "godavari", kind: "price_variance",
    title: "Price variance — motors billed at ₹44,200 against PO rate ₹42,500 (+4%, above the 2% tolerance)",
    po: { day: 75, lines: [["MTR-IE3-15KW", "6", "42500", 10]] },
    events: [
      { type: "GRN", day: 64, lines: { 1: "6" } },
      { type: "QC", day: 63, lines: { 1: ["6", "6"] } },
      { type: "INV", key: "i1", day: 62, lines: { 1: "6" }, rates: { 1: "44200" } },
    ],
    expected: ["PRICE_VARIANCE"], poStatus: "fulfilled", caseStatus: "in_review",
  },
  {
    id: "S15", supplier: "godavari", kind: "split_payment",
    title: "Split payment — one ₹4.63 lakh invoice settled by two RTGS transfers",
    po: { day: 160, lines: [["MTR-IE3-30KW", "5", "78500", 10]] },
    events: [
      { type: "GRN", day: 148, lines: { 1: "5" } },
      { type: "QC", day: 147, lines: { 1: ["5", "5"] } },
      { type: "INV", key: "i1", day: 146, lines: { 1: "5" } },
      { type: "PAY", key: "p1", day: 100, mode: "RTGS", alloc: [["i1", "250000.00"]] },
      { type: "PAY", key: "p2", day: 88, mode: "RTGS", alloc: [["i1", "rest"]] },
    ],
    expected: ["PAY_SPLIT"], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S16", supplier: "aravali", kind: "partial_billed_full",
    title: "Partial delivery billed in full — 4 of 6 VFD panels received, invoice for 6; 4 paid",
    po: { day: 60, lines: [["PNL-VFD-15", "6", "68000", 12]] },
    events: [
      { type: "GRN", day: 47, lines: { 1: "4" } },
      { type: "QC", day: 46, lines: { 1: ["4", "4"] } },
      { type: "INV", key: "i1", day: 43, lines: { 1: "6" } },
      { type: "PAY", key: "p1", day: 20, mode: "RTGS", alloc: [["i1", "320960.00"]] },
    ],
    expected: ["INVOICE_QTY_EXCEEDS_RECEIVED", "QTY_INVOICED_EXCEEDS_ACCEPTED", "DELIVERY_SHORTFALL"],
    poStatus: "partially_fulfilled", caseStatus: "in_review",
  },
  {
    id: "S17", supplier: "saurashtra", kind: "qc_rejection_credit_note",
    title: "QC rejection with credit note — 12 flanges rejected and returned; supplier credit note received but not applied",
    po: { day: 88, lines: [["FLG-SO-100", "120", "610", 10], ["ELB-BW-100", "80", "365", 10]] },
    events: [
      { type: "GRN", day: 76, lines: { 1: "120", 2: "80" } },
      { type: "QC", day: 75, lines: { 1: ["120", "108", "Porosity on raised face"], 2: ["80", "80"] } },
      { type: "INV", key: "i1", day: 74, lines: { 1: "120", 2: "80" } },
      { type: "RET", day: 72, lines: { 1: "12" }, remarks: "12 flanges returned against QC rejection" },
      { type: "CN", key: "c1", day: 66, invoice: "i1", lines: { 1: "12" } },
      { type: "PAY", key: "p1", day: 50, mode: "NEFT", alloc: [["i1", "netOfCredit"]] },
    ],
    expected: ["INVOICE_QTY_EXCEEDS_RECEIVED", "QTY_INVOICED_EXCEEDS_ACCEPTED", "DELIVERY_SHORTFALL", "DOC_CREDIT_NOTE_PENDING"],
    poStatus: "partially_fulfilled", caseStatus: "in_review",
    notes: "AP paid net of the credit note but never recorded the credit note against the invoice — apply it to close the invoice.",
  },
  {
    id: "S18", supplier: "indrayani", kind: "gstin_typo",
    title: "GSTIN mismatch — invoice prints the supplier GSTIN with two digits transposed (fails checksum)",
    po: { day: 35, lines: [["BLT-M16-60", "400", "42", 7], ["ANC-M20-300", "120", "185", 7]] },
    events: [
      { type: "GRN", day: 30, lines: { 1: "400", 2: "120" } },
      { type: "INV", key: "i1", day: 29, lines: { 1: "400", 2: "120" }, gstinTypo: true },
    ],
    expected: ["TAX_GSTIN_INVALID"], poStatus: "fulfilled", caseStatus: "in_review",
    notes: "ITC cannot be claimed on a GSTIN that fails validation — hold until Indrayani reissues the invoice.",
  },
  {
    id: "S19", supplier: "shakti", kind: "tax_type_error",
    title: "Tax-type error — IGST charged on an intra-state (Pune → Chakan) supply",
    po: { day: 55, lines: [["SEAL-MS-32", "40", "2450", 8]] },
    events: [
      { type: "GRN", day: 46, lines: { 1: "40" } },
      { type: "QC", day: 45, lines: { 1: ["40", "40"] } },
      { type: "INV", key: "i1", day: 44, lines: { 1: "40" }, forceIgst: true },
    ],
    expected: ["TAX_TYPE_MISMATCH"], poStatus: "fulfilled", caseStatus: "in_review",
    notes: "IGST paid in error is not creditable against CGST/SGST — ask Shakti for a corrected invoice.",
  },
  {
    id: "S20", supplier: "kongu", kind: "eway_missing",
    title: "E-way bill missing — ₹2.68 lakh inter-state consignment, no e-way bill number on the invoice",
    po: { day: 110, lines: [["PMP-SUB-5HP", "8", "31900", 12]] },
    events: [
      { type: "GRN", day: 96, lines: { 1: "8" } },
      { type: "QC", day: 95, lines: { 1: ["8", "8"] } },
      { type: "INV", key: "i1", day: 94, lines: { 1: "8" }, noEway: true },
      { type: "PAY", key: "p1", day: 60, mode: "RTGS", alloc: [["i1", "full"]] },
    ],
    expected: ["TAX_EWAYBILL_MISSING"], poStatus: "fulfilled", caseStatus: "open",
  },
  {
    id: "S21", supplier: "rathod", kind: "msme_overdue",
    title: "MSME overdue — micro supplier's invoice unpaid 63 days (45-day limit passed)",
    po: { day: 85, lines: [["GSK-SPW-100", "50", "640", 10], ["VLV-BALL-50", "10", "4850", 10]] },
    events: [
      { type: "GRN", day: 70, lines: { 1: "50", 2: "10" } },
      { type: "QC", day: 69, lines: { 1: ["50", "50"], 2: ["10", "10"] } },
      { type: "INV", key: "i1", day: 63, lines: { 1: "50", 2: "10" } },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "open", msmeOverdueAllowed: true,
    notes: "Engine-clean, but the MSME 45-day watch shows it overdue — interest at 3× bank rate is running.",
  },
  {
    id: "S22", supplier: "indrayani", kind: "msme_overdue",
    title: "MSME overdue — micro supplier on 30-day terms, invoice unpaid 58 days",
    po: { day: 70, lines: [["ANC-M20-300", "200", "185", 7]] },
    events: [
      { type: "GRN", day: 62, lines: { 1: "200" } },
      { type: "INV", key: "i1", day: 58, lines: { 1: "200" } },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "open", msmeOverdueAllowed: true,
  },
  {
    id: "S23", supplier: "deccan", kind: "msme_due_soon",
    title: "MSME due soon — small supplier on 30-day terms, invoice due in 4 days",
    po: { day: 40, lines: [["VLV-BALL-50", "12", "4850", 8]] },
    events: [
      { type: "GRN", day: 30, lines: { 1: "12" } },
      { type: "QC", day: 29, lines: { 1: ["12", "12"] } },
      { type: "INV", key: "i1", day: 26, lines: { 1: "12" } },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "open",
  },

  // ───────────────────────────── clean baseline ─────────────────────────────
  {
    id: "S24", supplier: "kongu", kind: "clean",
    title: "Clean inter-state — 15 submersibles from Coimbatore, IGST 5%, paid by RTGS",
    po: { day: 200, lines: [["PMP-SUB-3HP", "15", "23900", 12]] },
    events: [
      { type: "GRN", day: 186, lines: { 1: "15" } },
      { type: "QC", day: 185, lines: { 1: ["15", "15"] } },
      { type: "INV", key: "i1", day: 184, lines: { 1: "15" } },
      { type: "PAY", key: "p1", day: 150, mode: "RTGS", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S25", supplier: "saurashtra", kind: "clean",
    title: "Clean inter-state — flanges and elbows from Rajkot, IGST 18%",
    po: { day: 175, lines: [["FLG-SO-100", "200", "595", 12], ["ELB-BW-100", "150", "360", 12]] },
    events: [
      { type: "GRN", day: 160, lines: { 1: "200", 2: "150" } },
      { type: "QC", day: 159, lines: { 1: ["200", "200"], 2: ["150", "150"] } },
      { type: "INV", key: "i1", day: 158, lines: { 1: "200", 2: "150" } },
      { type: "PAY", key: "p1", day: 120, mode: "NEFT", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S26", supplier: "aravali", kind: "clean",
    title: "Clean inter-state — 20 DOL starter panels from Faridabad",
    po: { day: 190, lines: [["PNL-DOL-3P", "20", "14600", 12]] },
    events: [
      { type: "GRN", day: 176, lines: { 1: "20" } },
      { type: "QC", day: 175, lines: { 1: ["20", "20"] } },
      { type: "INV", key: "i1", day: 174, lines: { 1: "20" } },
      { type: "PAY", key: "p1", day: 140, mode: "RTGS", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S27", supplier: "indrayani", kind: "clean",
    title: "Clean local purchase — fasteners from Chakan, paid by cheque",
    po: { day: 140, lines: [["BLT-M16-60", "600", "41", 5]] },
    events: [
      { type: "GRN", day: 134, lines: { 1: "600" } },
      { type: "INV", key: "i1", day: 133, lines: { 1: "600" } },
      { type: "PAY", key: "p1", day: 110, mode: "CHEQUE", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S28", supplier: "godavari", kind: "clean",
    title: "Clean — 4 IE3 motors from a large (non-MSME) supplier on 60-day terms",
    po: { day: 215, lines: [["MTR-IE3-15KW", "4", "41800", 12]] },
    events: [
      { type: "GRN", day: 200, lines: { 1: "4" } },
      { type: "QC", day: 199, lines: { 1: ["4", "4"] } },
      { type: "INV", key: "i1", day: 198, lines: { 1: "4" } },
      { type: "PAY", key: "p1", day: 150, mode: "NEFT", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S29", supplier: "kaveri", kind: "clean",
    title: "Clean inter-state — 6 flameproof motors from Bengaluru",
    po: { day: 165, lines: [["MTR-FLP-7.5", "6", "38500", 12]] },
    events: [
      { type: "GRN", day: 150, lines: { 1: "6" } },
      { type: "QC", day: 149, lines: { 1: ["6", "6"] } },
      { type: "INV", key: "i1", day: 148, lines: { 1: "6" } },
      { type: "PAY", key: "p1", day: 125, mode: "RTGS", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S30", supplier: "deccan", kind: "clean",
    title: "Clean multi-line — sluice and non-return valves from Satara",
    po: { day: 125, lines: [["VLV-SLU-100", "12", "6450", 10], ["VLV-NRV-80", "10", "5600", 10]] },
    events: [
      { type: "GRN", day: 112, lines: { 1: "12", 2: "10" } },
      { type: "QC", day: 111, lines: { 1: ["12", "12"], 2: ["10", "10"] } },
      { type: "INV", key: "i1", day: 110, lines: { 1: "12", 2: "10" } },
      { type: "PAY", key: "p1", day: 88, mode: "NEFT", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S31", supplier: "meridian", kind: "clean", externalRef: "PO-0987",
    title: "Clean — earlier Meridian order (PO-0987) for mechanical seals, paid in 34 days",
    po: { day: 150, lines: [["SEAL-MS-32", "30", "2380", 8]] },
    events: [
      { type: "GRN", day: 141, lines: { 1: "30" } },
      { type: "QC", day: 140, lines: { 1: ["30", "30"] } },
      { type: "INV", key: "i1", day: 139, lines: { 1: "30" }, number: "MPS/26-27/019" },
      { type: "PAY", key: "p1", day: 105, mode: "NEFT", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S32", supplier: "maratha", kind: "clean",
    title: "Clean — spherical roller bearings, paid by IMPS",
    po: { day: 100, lines: [["BRG-22216", "16", "6950", 8]] },
    events: [
      { type: "GRN", day: 91, lines: { 1: "16" } },
      { type: "QC", day: 90, lines: { 1: ["16", "16"] } },
      { type: "INV", key: "i1", day: 89, lines: { 1: "16" } },
      { type: "PAY", key: "p1", day: 66, mode: "IMPS", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S33", supplier: "kaveri", kind: "clean",
    title: "Clean inter-state — 12 large submersibles from Bengaluru",
    po: { day: 210, lines: [["PMP-SUB-5HP", "12", "33600", 12]] },
    events: [
      { type: "GRN", day: 197, lines: { 1: "12" } },
      { type: "QC", day: 196, lines: { 1: ["12", "12"] } },
      { type: "INV", key: "i1", day: 195, lines: { 1: "12" } },
      { type: "PAY", key: "p1", day: 170, mode: "RTGS", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
  {
    id: "S34", supplier: "shakti", kind: "just_issued",
    title: "Just issued — PO sent 4 days ago, delivery due in 10 days",
    po: { day: 4, lines: [["PMP-CF-3HP", "8", "16850", 14]] },
    events: [],
    expected: [], poStatus: "issued", caseStatus: "open",
    notes: "Nothing is late yet; an engine that ignores the schedule date will still call it a shortfall.",
  },
  {
    id: "S35", supplier: "indrayani", kind: "small_imps",
    title: "Clean small order — foundation bolts, paid by IMPS same week",
    po: { day: 118, lines: [["ANC-M20-300", "40", "185", 5]] },
    events: [
      { type: "GRN", day: 113, lines: { 1: "40" } },
      { type: "INV", key: "i1", day: 113, lines: { 1: "40" } },
      { type: "PAY", key: "p1", day: 108, mode: "IMPS", alloc: [["i1", "full"]] },
    ],
    expected: [], poStatus: "fulfilled", caseStatus: "resolved",
  },
];
