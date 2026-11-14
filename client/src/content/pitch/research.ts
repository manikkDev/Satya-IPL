// Content for /research. Every figure comes from "Satya AP automation
// research" (Nov 2026) and carries the report's reference number (see
// references.ts). Where the report qualifies a number (vendor sample,
// illustrative, contested) the qualifier is carried here too.

export type Stat = {
  value: string;
  label: string;
  refs: number[];
  asOf: string;
  caveat?: string;
};

export const PROBLEM_STATS: Stat[] = [
  {
    value: "18.4%",
    label: "of invoices are exceptions that need a person to resolve them (global average).",
    refs: [2],
    asOf: "Ardent Partners, published Jan 2026",
    caveat: "A Medius-sponsored summary of Ardent's 2026 metrics reports 19.9%: exception rates are not falling.",
  },
  {
    value: "0.8–2%",
    label: "of disbursements are duplicate or erroneous payments (top vs bottom performers).",
    refs: [4],
    asOf: "APQC via CFO.com, 2020",
    caveat: "Much of this is later recovered, so it is money at risk, not a loss estimate.",
  },
  {
    value: "69.6%",
    label: "of 2,400+ Indian businesses named bills/AP processing as their main accounting pain, against 8.1% for GST reconciliation.",
    refs: [5],
    asOf: "AI Accountant demo data, Jan–Jul 2026",
    caveat: "A vendor's self-selected sample of software prospects, not a random survey.",
  },
  {
    value: "₹60–150",
    label: "estimated cost of one manually processed invoice in India, with about 4 minutes of entry and a 1–3% error rate.",
    refs: [6],
    asOf: "Tally Solutions estimate",
  },
  {
    value: "₹7.34 lakh crore",
    label: "of delayed receivables owed to Indian MSMEs (down from a ₹10.7 lakh crore peak in 2022).",
    refs: [8],
    asOf: "GAME–FISME–C2FO, March 2024 data",
  },
  {
    value: "₹55,244 crore",
    label: "claimed in 2,56,892 MSME Samadhaan delayed-payment applications; 58,148 disposed.",
    refs: [9],
    asOf: "PIB, June 2026",
  },
  {
    value: "₹58,772 crore",
    label: "of ITC fraud detected by CGST formations in FY 2024-25, across 15,283 cases.",
    refs: [39],
    asOf: "As cited in the research report",
  },
  {
    value: "₹1–5.5 crore",
    label: "lost per incident in reported Indian cases where an emailed “new bank account” request was paid without a call-back check.",
    refs: [41, 42, 43, 44, 45],
    asOf: "News reports, 2025–2026",
  },
];

export const GLOBAL_CONTEXT = {
  text:
    "The best independent benchmark puts the average cost per invoice at $9.84 and cycle time at 8.2 days. Only 57% of suppliers can send electronic invoices, and AP staff spend 21.9% of their time answering supplier queries. Best-in-class teams are 79% cheaper, 79% faster and have 47% fewer exceptions.",
  refs: [2],
  note:
    "India has no APQC-grade independent benchmark. Global figures probably understate the Indian cost per invoice because they leave out IMS actions, Rule 37 ageing, IRN checks and 194Q tracking. That is the report's inference; no study measures it.",
};

export type Persona = { role: string; who: string; pain: string[]; refs: number[] };

export const PERSONAS: Persona[] = [
  {
    role: "AP clerk",
    who: "Keys bills, chases GRNs, answers supplier calls.",
    pain: [
      "Roughly one invoice in five needs manual investigation: quantity short, price differs, GRN missing, QC rejected part of the lot.",
      "A bill re-sent over WhatsApp as “12” instead of “INV/24-25/0012” slips past exact-key duplicate checks.",
      "About a fifth of the working week goes on supplier queries.",
    ],
    refs: [2, 53],
  },
  {
    role: "Finance manager",
    who: "Owns month-end close, GST returns and the payment run.",
    pain: [
      "Has to accept, reject or leave pending every supplier record in IMS before GSTR-3B. Doing nothing means deemed acceptance.",
      "Rule 37: an invoice unpaid for 180 days forces ITC reversal with interest.",
      "Since GST 2.0 (22 Sep 2025), the PO rate, invoice rate and GRN date can disagree on the same line.",
    ],
    refs: [25, 22, 29],
  },
  {
    role: "CFO",
    who: "Answers to the board, the auditor and the tax officer.",
    pain: [
      "Under s.43B(h), a deduction for dues to micro and small suppliers is deferred if they are paid late. That changes taxable profit for the year.",
      "Automation is a stated priority, yet Grant Thornton Bharat finds it has “yet to deliver the promised outcomes”.",
      "Fake-supplier ITC can be denied after the money has already gone out.",
    ],
    refs: [17, 13, 39],
  },
  {
    role: "MSME supplier",
    who: "A micro or small firm that delivered and is waiting to be paid.",
    pain: [
      "Is legally owed payment within 45 days of acceptance, with compound interest at 3× the RBI bank rate if paid late.",
      "In practice often waits much longer: delayed receivables to MSMEs ran to lakhs of crores.",
      "Samadhaan claims take time: under a quarter of applications had been disposed by June 2026.",
    ],
    refs: [14, 8, 9],
  },
];

export type Clock = {
  name: string;
  short: string;
  plain: string;
  rule: string;
  satyaNeeds: string;
  refs: number[];
  caveat?: string;
};

export const CLOCKS: Clock[] = [
  {
    name: "MSMED Act s.15–16",
    short: "45 days to pay micro and small suppliers",
    plain:
      "Pay within the agreed term, never more than 45 days from the day you accepted the goods (15 days if there is no written agreement). Pay late and you owe compound interest with monthly rests at three times the RBI bank rate.",
    rule: "About 16.5% a year at a 5.50% bank rate. Verify the current RBI bank rate before relying on it.",
    satyaNeeds: "Supplier's Udyam category as on the invoice date, the GRN/QC acceptance date, whether a written agreement exists, and payment dates.",
    refs: [14, 15, 16],
    caveat: "The clock runs from acceptance (or deemed acceptance), not from the bill date. Tally's MSME report uses bill date + credit days.",
  },
  {
    name: "Income-tax s.43B(h)",
    short: "Late payment to MSEs defers your tax deduction",
    plain:
      "If you pay a micro or small (not medium) enterprise after the s.15 limit, you cannot deduct that expense until the year you actually pay. It first applied to amounts outstanding on 31 March 2024.",
    rule: "Timing effect on taxable profit; applies prospectively from the supplier's Udyam registration date.",
    satyaNeeds: "Everything above, plus year-end outstanding by supplier and the Udyam registration date.",
    refs: [17, 18, 19, 20],
  },
  {
    name: "GST Rule 37",
    short: "180 days to pay or reverse ITC",
    plain:
      "If you have not paid a supplier within 180 days of the invoice date, you must reverse the input tax credit with interest. You can re-claim it once you pay.",
    rule: "Partial and retention payments count, so each payment must be allocated to the right invoices.",
    satyaNeeds: "Invoice date, partial and retention payments, and the allocation of every payment to invoices.",
    refs: [21, 22],
  },
  {
    name: "Invoice Management System (IMS)",
    short: "Accept, reject or park every supplier record",
    plain:
      "Since October 2024, each supplier invoice on the GST portal must be accepted, rejected or kept pending. Do nothing and it is treated as accepted. Since October 2025, credit notes can stay pending for one tax period only.",
    rule: "To decide properly you need to know whether the goods arrived, passed QC and were priced as per the PO, before the monthly deadline.",
    satyaNeeds: "A 3-way match (PO, receipt/QC, invoice) completed before the return deadline.",
    refs: [25, 26],
  },
  {
    name: "E-invoice reporting window",
    short: "30 days to report an e-invoice (₹10 crore+ AATO)",
    plain:
      "E-invoicing applies above ₹5 crore turnover. Since 1 April 2025, suppliers with ₹10 crore+ AATO cannot report an e-invoice to the IRP more than 30 days after issue.",
    rule: "An invoice that was never registered may never reach your GSTR-2B, so the IRN is worth checking when the bill arrives.",
    satyaNeeds: "The IRN and signed QR on each B2B invoice, checked at receipt.",
    refs: [27, 28],
  },
  {
    name: "Income-tax s.194Q",
    short: "Buyer deducts 0.1% TDS on large purchases",
    plain:
      "Buyers with turnover above ₹10 crore deduct 0.1% TDS on purchases above ₹50 lakh a year from one seller. With TCS under 206C(1H) removed from 1 April 2025, the buyer alone carries this.",
    rule: "Payments come out slightly short of the invoice, so matching must expect a TDS-shaped difference.",
    satyaNeeds: "Running purchase value per seller per year, and TDS as an explicit part of payment allocation.",
    refs: [31],
  },
];

export type Competitor = { player: string; does: string; notFound: string; refs: number[] };

export const COMPETITORS: Competitor[] = [
  {
    player: "Global AP suites (Ramp, Coupa, Tipalti, Basware)",
    does: "Per-task “agents” with a human approving: line coding, fraud signals (Ramp cites 60+), PO matching with tolerances, payment batching.",
    notFound: "In the public material we reviewed, none mentioned GSTR-2B/IMS, IRN, TDS, 43B(h) or Tally support. Explanations are discrepancy labels, not linked evidence chains.",
    refs: [46, 47, 49, 50],
  },
  {
    player: "TallyPrime",
    does: "Bank reconciliation with intelligent matching; GSTR-2A/2B; MSME tagging and 43B(h) bill lists (from 4.1).",
    notFound: "MSME due date is bill date + credit days, not acceptance date. We found no QC-aware matching.",
    refs: [56, 57],
  },
  {
    player: "Zoho Books + BillPay",
    does: "3-way match in a paid add-on.",
    notFound: "Flag-only: bills that fail the match can still go to payment with a warning.",
    refs: [58],
  },
  {
    player: "Clear, Masters India, IRIS, Taxilla",
    does: "Purchase register vs GSTR-2B vs IMS reconciliation (Clear calls this “3-way”).",
    notFound: "A tax match. No goods-receipt or QC data in the documentation reviewed.",
    refs: [59, 60],
  },
  {
    player: "RazorpayX Source to Pay",
    does: "PO, system GRN, 2/3-way match, TDS, 2A/2B access, payouts, two-way Tally sync.",
    notFound: "No mention of QC, partial-delivery logic, duplicate detection, MSME clocks, or AI beyond OCR. Tied to its payout rail.",
    refs: [61, 62],
  },
  {
    player: "Cygnet.One AP Intelligence (Aug 2026)",
    does: "Agents for vendor/bank verification, duplicates, IRN, 2A/2B, TDS, 3-way match, co-pilot.",
    notFound: "SAP-first enterprise focus. Tally, MSME and pricing not mentioned.",
    refs: [63],
  },
  {
    player: "Suvit / AI Accountant",
    does: "Tally data entry, bank and GST reconciliation for CAs at about ₹9–12k a year.",
    notFound: "Bookkeeping automation rather than purchase-to-pay matching.",
    refs: [64],
  },
];

export const CAPABILITIES = [
  "Cumulative line-level matching: PO → GRN → QC-accepted quantity → invoice → debit note → payment",
  "MSME clocks driven by acceptance events, not bill dates",
  "Fuzzy duplicate detection across channels (email, WhatsApp, scan)",
  "Evidence-linked explanations with calibrated confidence and an explicit “I don't know”",
  "Tally-first deployment at Indian SME prices",
];

export type Gap = { gap: string; contribution: string; anchors: number[] };

export const RESEARCH_GAPS: Gap[] = [
  { gap: "No public, labelled AP reconciliation benchmark (invoice ↔ PO ↔ GRN ↔ payment ↔ bank).", contribution: "A de-identified Indian P2P benchmark with a datasheet, released with design-partner consent.", anchors: [128, 120] },
  { gap: "No GSTIN/PAN-aware or Indic-transliteration-aware supplier entity-resolution study.", contribution: "PAN-keyed blocking, IndicXlit name canonicalisation and Splink EM, evaluated on real vendor masters.", anchors: [116, 108] },
  { gap: "No conformal prediction or conformal risk control applied to entity matching or reconciliation.", contribution: "Auto-match sets with a stated false-match bound, by segment, plus a check that the bound holds.", anchors: [145] },
  { gap: "No measurement of the synthetic-to-real gap for reconciliation models.", contribution: "Satya's synthetic-trained model against real-calibrated models on pilot data, a natural experiment.", anchors: [1] },
  { gap: "No QC-aware (“4-way”) matching formalisation; no acceptance-date inference.", contribution: "Cumulative PO → GRN → QC → invoice matching with rejection debit notes; inferred deemed-acceptance dates for MSMED.", anchors: [14] },
  { gap: "No peer-reviewed remittance-to-invoice allocation with tolerances (TDS, charges) and ambiguity abstention.", contribution: "Score-then-solve allocation with top-K abstention and TDS as an explicit constraint.", anchors: [120] },
  { gap: "No Indian GST invoice or Indic-script extraction benchmark; no field-confidence study using statutory validators.", contribution: "Labels anchored on the signed e-invoice QR, extending Jin et al. with GST validators.", anchors: [136, 130] },
  { gap: "No hallucination or citation-validity study of AP copilots; no public Indian GST QA golden set.", contribution: "A golden set scored on numeric exact match, citation validity, refusal correctness and injection resistance.", anchors: [166, 167] },
];

export type Method = { problem: string; method: string; why: string; refs: number[] };

export const METHODS: Method[] = [
  { problem: "Is this invoice line the same thing as that PO line?", method: "Exact identifiers and arithmetic first; then a gradient-boosted pairwise scorer with a logistic challenger.", why: "Deep matchers add little on clean structured data. Classic record linkage already has a “possible link” band for human review.", refs: [105, 111, 106] },
  { problem: "Which suppliers are the same legal entity?", method: "GSTIN checksum, with PAN as a cross-state entity key; unsupervised Fellegi–Sunter/Splink scoring for a new customer without labels.", why: "Several GSTINs under one PAN are branches, not duplicates. EM-estimated parameters need no labels.", refs: [91, 108, 107] },
  { problem: "Which invoices does this payment settle?", method: "Score, then solve: Hungarian assignment for 1:1, exact subset-sum in integer paise for 1:N, abstain when two answers are close.", why: "Reconciliation as a subset-sum matching problem has a formal treatment and benchmark.", refs: [120, 122, 121] },
  { problem: "How sure is the model?", method: "Calibrated probabilities (Platt or isotonic), a cost-derived threshold, and three zones: auto, review, reject.", why: "Boosted trees are mis-calibrated by default. With calibrated p, the optimal threshold follows from the cost matrix.", refs: [138, 141, 142] },
  { problem: "Can we bound the error of what is auto-accepted?", method: "Conformal risk control on the auto zone, by segment.", why: "Gives finite-sample guarantees, but only when calibration and live data are exchangeable. A synthetic calibration guarantees nothing on your invoices.", refs: [145, 144] },
  { problem: "Reading the invoice", method: "Decode the IRP-signed e-invoice QR first; use ML extraction only for what is left, checked against GST arithmetic and GSTIN validators.", why: "Benchmarks flatter models on unseen templates. Business-rule validation lifts confidence AUROC to 0.90–0.99.", refs: [92, 131, 136] },
  { problem: "Anything unusual?", method: "Process-conformance checks and Isolation Forest scores feed a ranked review queue, never an auto-block.", why: "Deep anomaly detectors reached only F1 ≈ 33% and 17% on real journal entries, and real P2P is only 74–92% conformant.", refs: [123, 124, 129] },
  { problem: "Answering questions about the books", method: "The copilot computes in tools, cites rows and refuses when the data isn't there; documents are treated as untrusted input.", why: "Retrieval alone failed on 81% of FinanceBench questions. Indirect prompt injection is real; architecture is the defence.", refs: [161, 166, 169, 170] },
  { problem: "Why did it decide that?", method: "Per-decision reasons and counterfactual hints (“would match if the payment were ₹1,180 higher, likely TDS”).", why: "Exact attributions exist for tree models, and reviewers act faster on explained decisions.", refs: [152, 153, 79] },
];

export const HONESTY_NOTES = [
  "Our matching models have so far been trained and tested only on synthetic and public-derived data. We do not yet have a real-customer accuracy figure, and we will not quote one until a pilot produces it.",
  "When the internal audit was done, a simple logistic baseline tied our gradient-boosted model on synthetic data. The features and the data, not the learner, set the ceiling. That is why pilots and calibration on real data come first.",
  "A headline like “precision 1.0 at 34% coverage” on synthetic data is an upper bound, not a claim. The live model page shows each number with its data source, sample size and interval.",
];
