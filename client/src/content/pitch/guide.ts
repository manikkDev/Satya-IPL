// Content for /guide ("Bring your data: how a pilot works"). Based on the
// onboarding playbook in "Satya AP automation research" (Nov 2026) and its
// data-onboarding notes. Reference numbers point into references.ts. The
// report itself says no standard pilot duration or pass/fail threshold
// exists in the sources: the 8-week plan is a reasoned proposal.

export type PilotStep = {
  n: number;
  title: string;
  weeks: [number, number]; // inclusive start/end week for the timeline
  weekLabel: string;
  summary: string;
  activities: string[];
  output: string;
  refs: number[];
};

export const PILOT_STEPS: PilotStep[] = [
  {
    n: 0, title: "Contracts and data protection", weeks: [0, 0], weekLabel: "Week 0",
    summary: "Agree who is responsible for what before any data moves.",
    activities: [
      "NDA, then a data processing agreement (DPA) naming you as Data Fiduciary and Satya as Data Processor.",
      "DPA covers purpose limitation (reconciliation only), the sub-processor list (cloud, GST Suvidha Provider, OCR/LLM providers), hosting region, encryption, access logging, and deletion when the pilot ends.",
      "Using your data to improve shared models is opt-in only, as a separate clause.",
      "Security questionnaire; name a data owner and a finance champion on your side.",
    ],
    output: "Signed DPA and named owners",
    refs: [35, 36, 37],
  },
  {
    n: 1, title: "Data request", weeks: [0, 0], weekLabel: "Week 0",
    summary: "One checklist, sent on day one. Gaps are fine: we adapt the mode to what exists.",
    activities: [
      "12–24 months of POs, receipt notes, rejection notes, QC reports, purchase invoices, debit/credit notes and payments.",
      "Vendor master with GSTIN, PAN, bank details, Udyam number and payment terms.",
      "Bank statements for the same period, plus GSTR-2B for the same months (or consent through a GSP).",
      "100–200 “difficult” invoices: the ugly ones, not a curated sample.",
    ],
    output: "Data inventory with gaps flagged (for example, no QC records means 3-way rather than 4-way matching)",
    refs: [75],
  },
  {
    n: 2, title: "Connect", weeks: [1, 1], weekLabel: "Week 1",
    summary: "Read-only connection to your books, the GST portal and your bank exports.",
    activities: [
      "Tally: a small agent on your network reads Tally locally and pushes changes out over HTTPS, so port 9000 is never exposed to the internet. Or send exports.",
      "GSTR-2B/IMS through a GST Suvidha Provider with your OTP authorisation.",
      "Bank statements (MT940 or CSV) for one or two accounts; our QC Excel template if QC lives in spreadsheets.",
    ],
    output: "Masters synced; first voucher delta received",
    refs: [81, 82, 87],
  },
  {
    n: 3, title: "Mapping and clean-up", weeks: [1, 2], weekLabel: "Weeks 1–2",
    summary: "The vendor master is the highest-leverage clean-up. We do it with you and change nothing in Tally.",
    activities: [
      "Vendor de-duplication: GSTIN checksum, then PAN clusters (several GSTINs under one PAN are branches, not duplicates), then fuzzy names; every merge is confirmed by a person.",
      "Tally ledger names are kept as aliases and never renamed, because renames break write-back.",
      "Indian number and date formats, financial-year voucher numbering (FY + type + number), and units of measure (Nos/PCS, KG/MT).",
    ],
    output: "Vendor-master quality report",
    refs: [74, 84, 90],
  },
  {
    n: 4, title: "Historical replay (backtest)", weeks: [2, 3], weekLabel: "Weeks 2–3",
    summary: "Run 12–24 months of your history through Satya before anyone relies on it.",
    activities: [
      "Load masters, then vouchers in date order; decode every e-invoice QR.",
      "Replay through the rules and the global model.",
      "Use what actually happened (what was booked, paid, debited or IMS-rejected) as labels to measure precision and recall per exception type.",
    ],
    output: "Per-exception-type precision and recall, before any user sees output",
    refs: [92],
  },
  {
    n: 5, title: "Findings readout", weeks: [3, 3], weekLabel: "Week 3",
    summary: "A rupee-denominated readout of what the backtest found.",
    activities: [
      "Duplicates, over-billing against QC-accepted quantity, ITC at risk, MSME 43B(h) overdue on acceptance-date clocks, price and rate variances, bank-detail changes.",
      "Each finding links to the documents behind it, so your team can check it.",
    ],
    output: "Findings in ₹, with evidence",
    refs: [],
  },
  {
    n: 6, title: "Calibration for your data", weeks: [3, 4], weekLabel: "Weeks 3–4",
    summary: "Tune the confidence scores to your business so “95% sure” means 95% on your invoices.",
    activities: [
      "Fit a per-customer calibrator on the backtest labels; the shared model is not retrained on your data unless you opt in.",
      "Set three zones per exception type (auto, review, reject) from the cost of a wrong match against the cost of a review.",
    ],
    output: "Your own model card, v0",
    refs: [138, 141],
  },
  {
    n: 7, title: "Shadow mode", weeks: [4, 6], weekLabel: "Weeks 4–6",
    summary: "Satya runs on live documents while your team keeps deciding as today.",
    activities: [
      "Every day: the model predicts, people decide, and we log agreement and the errors it would have made.",
      "A random 2–5% of would-be auto-matches is checked by hand to measure real precision.",
      "Thresholds are recalibrated and a drift baseline is recorded.",
    ],
    output: "Measured agreement and would-have-been error rate",
    refs: [146],
  },
  {
    n: 8, title: "Controlled go-live", weeks: [6, 8], weekLabel: "Weeks 6–8",
    summary: "Switch on the auto zone for a slice: one entity or a set of vendors.",
    activities: [
      "A/B, or before-after against a seasonality-matched baseline.",
      "Success criteria were agreed in week 0, before anyone saw results.",
      "Every money decision still needs a person's approval.",
    ],
    output: "Decision memo with confidence intervals",
    refs: [],
  },
];

export const STEADY_STATE =
  "After week 8: daily per-customer updates (tolerances, aliases, units), drift alerts on match rate and new-vendor share, versioned models with one-click rollback, and an incident log.";

export type ChecklistItem = { item: string; detail: string; from: string; format: string; need: "Required" | "Helpful" };

export const DATA_CHECKLIST: ChecklistItem[] = [
  { item: "Entities and GSTINs", detail: "Every legal entity and GSTIN in scope; Tally company names", from: "Finance team", format: "List", need: "Required" },
  { item: "Accounting system and version", detail: "TallyPrime release, Zoho Books org, BUSY edition or ERP name", from: "IT / finance", format: "Note", need: "Required" },
  { item: "Vendor master", detail: "Name, GSTIN, PAN, bank account, Udyam number and category, payment terms, written-agreement flag", from: "Tally / Zoho / BUSY / ERP", format: "XML, JSON, XLSX or CSV", need: "Required" },
  { item: "Udyam list", detail: "Udyam numbers for MSME suppliers, with registration dates", from: "Vendor files / Udyam portal", format: "XLSX or CSV", need: "Required" },
  { item: "Item master and units", detail: "Items, HSN, units of measure and conversions", from: "Accounting system", format: "XML, XLSX or CSV", need: "Helpful" },
  { item: "Purchase orders", detail: "12–24 months, with lines, rates and amendments", from: "Accounting system", format: "Vouchers (XML/JSON) or XLSX", need: "Required" },
  { item: "Goods receipts", detail: "Receipt notes / GRNs for the same period", from: "Accounting system", format: "Vouchers or XLSX", need: "Required" },
  { item: "Rejection notes and QC reports", detail: "Accepted vs rejected quantity per receipt", from: "Stores / QMS / Excel", format: "XLSX (Satya template) or CSV", need: "Helpful" },
  { item: "Purchase invoices", detail: "Voucher plus the PDF or scan for each invoice", from: "Accounting system + email/shared drive", format: "Vouchers + PDF", need: "Required" },
  { item: "Debit and credit notes", detail: "Including rejection debit notes", from: "Accounting system", format: "Vouchers or XLSX", need: "Required" },
  { item: "Payments", detail: "Payment vouchers with bill-wise allocation and TDS", from: "Accounting system", format: "Vouchers or XLSX", need: "Required" },
  { item: "Bank statements", detail: "One or two accounts, same period", from: "Bank (CMS or net banking)", format: "MT940, CSV/XLSX, or PDF", need: "Required" },
  { item: "GSTR-2B", detail: "Same months as the vouchers, or OTP consent via a GSP", from: "GST portal / GSP", format: "JSON", need: "Required" },
  { item: "Approval matrix and tolerances", detail: "Who approves what; price/quantity tolerance policy", from: "Finance policy", format: "Document", need: "Helpful" },
  { item: "Difficult invoices", detail: "100–200 real examples that cause trouble today", from: "AP team", format: "PDF + note", need: "Required" },
  { item: "Named contacts", detail: "Data owner, finance champion, IT contact", from: "You", format: "List", need: "Required" },
];

export type HowTo = { system: string; steps: string[]; note?: string; refs: number[] };

export const HOW_TOS: HowTo[] = [
  {
    system: "TallyPrime",
    steps: [
      "Preferred: we install a small read-only agent on a machine on your network. It reads Tally through Tally's built-in HTTP server (F1 Help → Settings → Advanced Configuration; default port 9000) and pushes changes out over HTTPS. The port stays closed to the internet.",
      "Native JSON exchange is available from TallyPrime 7.0; older releases use XML. A company must be loaded in Tally for requests to work.",
      "Without the agent: open the report you need (masters, or the Day Book for a period) and use Export to save XML or Excel.",
    ],
    note: "We never rename or delete Tally ledgers.",
    refs: [81, 82, 83, 84],
  },
  {
    system: "Zoho Books",
    steps: [
      "Connect through Zoho's OAuth on the India data centre with read-only scopes per module (purchase orders, bills, vendor payments and so on).",
      "Syncs are throttled to stay within Zoho's API limits (commonly cited as about 100 requests a minute per organisation).",
      "Alternative: export each module's list as CSV or XLSX.",
    ],
    refs: [85],
  },
  {
    system: "BUSY",
    steps: [
      "Use BUSY's Data Export/Import to export masters and transactions as XML, or reports to Excel.",
      "There is no scheduled automatic export and no public API, so this is a periodic upload.",
      "Export is not available in BUSY Basic.",
    ],
    refs: [86],
  },
  {
    system: "Other ERPs (SAP B1/S4 and others)",
    steps: [
      "We agree a CSV/XLSX layout for each document type during week 0.",
      "Standard ERP export paths were not covered by our research, so we confirm them with your IT team.",
    ],
    refs: [],
  },
  {
    system: "Bank statements",
    steps: [
      "Best: MT940 from your bank's cash-management channel. Several Indian banks offer it on current accounts with CMS or corporate banking.",
      "Otherwise: CSV or XLSX from net banking for the same period. PDF works as a last resort.",
      "Account Aggregator is not an option for an unregulated software vendor: data users must be regulated by RBI, SEBI, IRDAI or PFRDA.",
    ],
    note: "Narration formats differ by bank; we map them during set-up.",
    refs: [88, 38],
  },
  {
    system: "GSTR-2B and IMS",
    steps: [
      "Preferred: authorise a GST Suvidha Provider (GSP) partner with the OTP sent to your registered mobile. GSTR-2B is then pulled monthly and IMS records daily.",
      "Manual: download the GSTR-2B JSON for each month from the GST portal's returns dashboard.",
      "Quarterly (QRMP) filers get GSTR-2B only at quarter-end.",
    ],
    refs: [87],
  },
  {
    system: "Udyam (MSME status)",
    steps: [
      "Send us the Udyam numbers you hold for suppliers.",
      "There is no official public API. Status is verified on the Udyam portal or through a third-party PAN-to-Udyam check.",
      "The registration date matters: 43B(h) applies from it, not retrospectively.",
    ],
    refs: [89, 20],
  },
  {
    system: "QC records",
    steps: [
      "QC usually lives in Excel or a quality system, not in Tally.",
      "We provide an Excel template: receipt number, line, accepted quantity, rejected quantity, inspection date, rejection note.",
    ],
    refs: [],
  },
];

export const PILOT_KPIS: { kpi: string; definition: string; benchmark: string; refs: number[] }[] = [
  { kpi: "Auto-match share at agreed precision", definition: "% of lines auto-matched while sampled precision stays ≥ the agreed target", benchmark: "Agreed in week 0", refs: [] },
  { kpi: "Touchless rate (strict)", definition: "% of invoices with zero human touch at any stage, split PO / non-PO", benchmark: "Best-in-class process 1.8× peers' straight-through volume", refs: [2] },
  { kpi: "Exception rate by reason", definition: "Quantity, price, rate/HSN, missing GRN, QC rejection, duplicate, missing from 2B, bank change", benchmark: "18.4% average", refs: [2] },
  { kpi: "Reviewer minutes per invoice", definition: "Your loaded cost and time, measured before and during the pilot", benchmark: "₹60–150 per manual invoice", refs: [6] },
  { kpi: "₹ of exceptions found", definition: "Duplicates, over-billing vs QC-accepted quantity, ITC at risk", benchmark: "0.8–2% of disbursements duplicate or erroneous", refs: [4] },
  { kpi: "GSTR-2B reconciliation time", definition: "Hours per month to reconcile purchases with 2B/IMS", benchmark: "Your baseline", refs: [] },
  { kpi: "MSME 45-day visibility", definition: "Share of MSE invoices with a known acceptance-date clock; interest exposure avoided", benchmark: "Statutory", refs: [14] },
  { kpi: "Bank-change payments held and verified", definition: "Count and ₹ of first payments to changed accounts", benchmark: "Reported fraud losses of ₹1–5.5 crore per incident", refs: [41, 42] },
];

export const FAQS: { q: string; a: string[] }[] = [
  {
    q: "Is our data secure?",
    a: [
      "Each customer is a separate tenant: queries are scoped to your group and entities, and people see only what their role allows.",
      "Every decision is written to an append-only, hash-chained audit trail, so tampering shows.",
      "Satya reads your books. It does not post to Tally or move money. Any write-back would be a separate, explicit step you switch on.",
      "Formal certifications (SOC 2, ISO 27001) are planned, not held. See Trust & security for exactly what exists today.",
    ],
  },
  {
    q: "Where will our data live?",
    a: [
      "The public demo uses only fictional data. Its backend is currently deployed in a Singapore cloud region.",
      "For a pilot, the DPA names the hosting region and every sub-processor. India-region storage is what we propose and what most buyers expect. Payment-data localisation rules apply to payment-system operators, not generally to AP software.",
    ],
  },
  {
    q: "Who at Satya can see it?",
    a: [
      "Only the named people working on your pilot, under the DPA. The DPA commits to access logging, with logs kept at least 180 days as the CERT-In Directions require.",
      "CERT-In requires cyber incidents to be reported within 6 hours. Our proposed DPA term is to tell you within 24 hours, so you can meet your own DPDP obligations (a detailed report to the Data Protection Board within 72 hours).",
    ],
  },
  {
    q: "Will you train your models on our data?",
    a: [
      "Not by default. Your data calibrates your own thresholds and lightweight per-customer settings only.",
      "Contributing de-identified features to the shared model is a separate opt-in clause in the DPA.",
    ],
  },
  {
    q: "How does the model adapt to our business?",
    a: [
      "A shared global model gives a starting point. Your backtest then fits a per-customer calibrator, so a stated confidence matches what actually happens on your invoices.",
      "Corrections your team makes in the review queue become labels. Vendor aliases, tolerances and units update daily.",
      "If match rates or score distributions drift, an alert fires and we recalibrate. Every model version is logged and can be rolled back.",
    ],
  },
  {
    q: "What happens when the model isn't sure?",
    a: [
      "It says so. Each suggestion falls into one of three zones: auto, review or reject. Anything uncertain goes to a person with the evidence and the reason.",
      "Payment allocations abstain when two answers are close, instead of picking one.",
      "No money decision is ever made by the model alone.",
    ],
  },
  {
    q: "We don't record QC in our system. Can we still run a pilot?",
    a: ["Yes. Satya runs a 3-way match (PO, receipt, invoice) and adds QC as a fourth leg when the template or a QMS export is available."],
  },
  {
    q: "What do you need from our IT team?",
    a: ["A Windows machine on the Tally network for the agent (or someone to run exports), OTP authorisation for the GSP, and a bank export. Nothing inbound is opened on your network."],
  },
  {
    q: "What happens to our data when the pilot ends?",
    a: ["It is returned or deleted on the date set in the DPA, and we confirm the deletion in writing."],
  },
];

/* ---------------- downloadable checklist ---------------- */

const csvCell = (s: string) => `"${s.replaceAll('"', '""')}"`;

export function checklistCsv(): string {
  const rows = [["Item", "What exactly", "Where it comes from", "Format", "Required?", "Done"], ...DATA_CHECKLIST.map((c) => [c.item, c.detail, c.from, c.format, c.need, ""])];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function checklistMarkdown(): string {
  const lines = [
    "# Satya pilot: data request checklist",
    "",
    "Period: the last 12–24 months, same period for every item. Gaps are fine; tell us what's missing.",
    "",
    "| Done | Item | What exactly | Where it comes from | Format | Required? |",
    "|---|---|---|---|---|---|",
    ...DATA_CHECKLIST.map((c) => `| [ ] | ${c.item} | ${c.detail} | ${c.from} | ${c.format} | ${c.need} |`),
    "",
    "Before any data is shared: NDA and DPA signed (Satya as Data Processor), data owner and finance champion named.",
    "",
  ];
  return lines.join("\n");
}
