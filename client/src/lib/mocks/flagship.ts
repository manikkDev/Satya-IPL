// Mock fixtures for NEXT_PUBLIC_USE_MOCKS=1 development (docs/plan/06 §8).
// They mirror the curated demo dataset (server/src/seed, docs/DEMO_DATASET.md)
// as seeded on 14 Nov 2026 — same company, supplier, GSTINs and numbers.
// Flagship PO-1001 (SATYAD/PO/26-27/000029, Meridian Pump Supply) is a
// regression fixture, so its numbers must stay exact: 100 CP-100 impeller kits
// ordered @ ₹1,000 + 18% GST, 60 received and accepted, invoice MPS/26-27/041
// ₹70,800 posted twice (second posting re-keyed as MPS-26-27-041), T01
// ₹30,000 + T02 ₹20,800 settled, T03 ₹15,000 unallocated, receipt-supported
// outstanding ₹20,000, posting-based open balance ₹90,800.

import type { Finding, GraphPayload, Today, Case, Snapshot } from "@/lib/api/types";

const INR = "INR";

export const mockUser = {
  id: "usr_demo01",
  name: "Priya Kulkarni",
  email: "manager@satya.demo",
  roles: ["ap_manager"],
};

export const mockEntities = [
  {
    id: "ent_satyad",
    code: "SATYAD",
    legalName: "Satya Equipment Distribution Pvt Ltd",
    tradeName: "Satya Equipment Distribution",
    gstin: "27AAKCS4821M1ZW",
    stateCode: "27",
  },
];

export const mockSupplier = {
  id: "sup_cur_meridian",
  legalName: "Meridian Pump Supply",
  tradeName: "Meridian Pumps",
  gstin: "27BXJPJ7316C1ZK",
  udyam: { number: "UDYAM-MH-18-0061204", category: "micro" as const },
};

const evidence = (id: string, documentId: string, documentType: string, field: string, quote: string, observedAt = "2026-10-31T17:10:00+05:30") => ({
  id,
  documentId,
  documentType,
  field,
  locator: { kind: "pdf_text" as const, page: 1, quote },
  observedAt,
});

export const flagshipFindings: Finding[] = [
  {
    id: "fnd_dup041",
    code: "DUPLICATE_INVOICE_SUSPECT",
    title: "Invoice MPS/26-27/041 may be recorded twice",
    severity: "high",
    certainty: "PROBABLE",
    exposure: { amount: "70800.00", currency: INR },
    documentIds: ["doc_inv041", "doc_inv041b"],
    evidence: [
      evidence("evd_1", "doc_inv041", "INVOICE_IN", "number", "MPS/26-27/041", "2026-10-20T17:10:00+05:30"),
      evidence("evd_2", "doc_inv041b", "INVOICE_IN", "number", "MPS-26-27-041"),
    ],
    explanation:
      "Two postings from Meridian Pump Supply carry the same invoice (MPS/26-27/041, re-keyed as MPS-26-27-041) dated 20 Oct for the same ₹70,800. Together they bill 120 kits against 60 received — one of them is very likely a duplicate.",
    calculation: [
      { step: "MPS/26-27/041 posted on 20 Oct", value: "₹70,800.00" },
      { step: "MPS-26-27-041 posted on 31 Oct — same supplier, date and amount", value: "₹70,800.00" },
      { step: "Billed 120 kits vs 60 received", formula: "120 − 60 = 60 kits over-billed" },
    ],
    recommendedAction: "PLACE_ON_HOLD",
    actionScope: { holdAmount: { amount: "70800.00", currency: INR } },
    whatResolvesIt: "Meridian's confirmation that MPS-26-27-041 is the same invoice, or your rejection of the second posting.",
    detector: "hybrid",
    detectorVersion: "recon-v2.0",
  },
  {
    id: "fnd_t03",
    code: "PAY_UNALLOCATED",
    title: "Payment T03 of ₹15,000 does not name its invoice",
    severity: "medium",
    certainty: "AMBIGUOUS",
    exposure: { amount: "15000.00", currency: INR },
    documentIds: ["doc_pay03"],
    evidence: [evidence("evd_3", "doc_pay03", "PAYMENT_OUT", "amount", "15000", "2026-11-02T11:05:00+05:30")],
    explanation:
      "NEFT transfer T03 of ₹15,000 to Meridian Pump Supply (UTR HDFCN26306733217) carries no invoice reference. It could be a part payment of either open Meridian invoice, and Satya will not guess which.",
    calculation: [],
    candidates: [
      { documentId: "doc_inv041", score: "0.55", why: "MPS/26-27/041 still has ₹20,000 open — T03 fits as a part payment" },
      { documentId: "doc_inv042", score: "0.45", why: "MPS/26-27/042 (₹17,700, PO-1002) is unpaid — T03 fits as a part payment" },
    ],
    recommendedAction: "REQUEST_CLARIFICATION",
    whatResolvesIt: "Meridian's remittance advice naming which invoice this transfer settles.",
    detector: "rule",
    detectorVersion: "recon-v2.0",
  },
  {
    id: "fnd_partial",
    code: "DELIVERY_SHORTFALL",
    title: "40 of 100 impeller kits are still to arrive",
    severity: "info",
    certainty: "CONFIRMED",
    exposure: { amount: "0.00", currency: INR },
    documentIds: ["doc_po1001"],
    evidence: [evidence("evd_4", "doc_po1001", "PO", "lines[0].qty", "100", "2026-10-05T10:15:00+05:30")],
    explanation: "60 kits arrived in two lots (40 on 14 Oct, 20 on 18 Oct); the remaining 40 are scheduled for 20 Nov.",
    calculation: [{ step: "Ordered 100 − received 60 = open 40" }],
    recommendedAction: "APPROVE",
    whatResolvesIt: "The final lot, or a short-close if Meridian will not ship the rest.",
    detector: "rule",
    detectorVersion: "recon-v2.0",
    harmlessVariance: true,
  },
];

export const mockToday: Today = {
  moneyAtRisk: { amount: "85800.00", currency: INR },
  supportedOutstanding: { amount: "20000.00", currency: INR },
  itcAtRisk: { amount: "10800.00", currency: INR },
  paymentsDueWeek: { amount: "68676.00", currency: INR },
  holds: { count: 1, amount: { amount: "70800.00", currency: INR } },
  approvalsWaiting: 0,
  deadlines: [
    {
      kind: "MSME_45",
      documentId: "doc_cur_s23_i1",
      supplier: "Deccan Valve Industries",
      dueDate: "2026-11-18",
      daysLeft: 4,
      amount: { amount: "68676.00", currency: INR },
    },
    {
      kind: "PO_DELIVERY",
      documentId: "doc_po1001",
      supplier: "Meridian Pump Supply",
      dueDate: "2026-11-20",
      daysLeft: 6,
      amount: { amount: "47200.00", currency: INR },
    },
    {
      kind: "MSME_45",
      documentId: "doc_inv042",
      supplier: "Meridian Pump Supply",
      dueDate: "2026-12-07",
      daysLeft: 23,
      amount: { amount: "17700.00", currency: INR },
    },
  ],
  topFindings: flagshipFindings,
  attention: [
    {
      id: "att_hold",
      text: "MPS-26-27-041 (₹70,800) looks like a second posting of MPS/26-27/041 — keep it on hold until Meridian confirms.",
      actionLabel: "Put on hold",
      href: "/app/investigations/case_po1001",
    },
    {
      id: "att_t03",
      text: "Payment T03 of ₹15,000 to Meridian has no invoice reference — ask for a remittance advice.",
      actionLabel: "See candidates",
      href: "/app/investigations/case_po1001",
    },
    {
      id: "att_msme",
      text: "DVI/26-27/0134 to Deccan Valve Industries (small enterprise, 30-day terms) falls due in 4 days.",
      actionLabel: "Review payment",
      href: "/app/compliance",
    },
  ],
  activity: [
    { id: "act_1", text: "Bank import added transfer T03 (₹15,000) to Meridian Pump Supply", at: "2026-11-02T11:05:00+05:30" },
    { id: "act_2", text: "Second posting of MPS/26-27/041 imported from the AP export as MPS-26-27-041", at: "2026-10-31T17:10:00+05:30" },
    { id: "act_3", text: "Transfer T02 of ₹20,800 settled against MPS/26-27/041", at: "2026-10-29T11:05:00+05:30" },
    { id: "act_4", text: "QC accepted all 60 impeller kits on PO-1001", at: "2026-10-19T12:00:00+05:30" },
  ],
};

export const mockCase: Case = {
  id: "case_po1001",
  groupId: "grp_satya_demo",
  entityId: "ent_satyad",
  kind: "po",
  subjectIds: ["doc_po1001", "doc_pay03"],
  title: "PO SATYAD/PO/26-27/000029 — Meridian Pump Supply (PO-1001)",
  status: "open",
  latestSnapshotId: "snp_flagship",
  revision: 3,
};

export const flagshipGraph: GraphPayload = {
  nodes: [
    { id: "n_sup", type: "SUPPLIER", label: "Meridian Pump Supply", stage: "party", subtitle: "Micro enterprise · Kolhapur · GSTIN 27BXJPJ…1ZK" },
    { id: "n_ent", type: "ENTITY", label: "Satya Equipment Distribution Pvt Ltd", stage: "party", subtitle: "GSTIN 27AAKCS…1ZW" },
    { id: "n_po", type: "PO", label: "SATYAD/PO/26-27/000029", stage: "order", qty: "100", date: "2026-10-05", status: "partially_fulfilled", documentId: "doc_po1001" },
    { id: "n_grn1", type: "GRN", label: "SATYAD/GRN/26-27/000027", stage: "receipt", qty: "40", date: "2026-10-14", documentId: "doc_grn010" },
    { id: "n_grn2", type: "GRN", label: "SATYAD/GRN/26-27/000031", stage: "receipt", qty: "20", date: "2026-10-18", documentId: "doc_grn011" },
    { id: "n_qc", type: "QC", label: "SATYAD/QC/26-27/000026", stage: "inspection", qty: "60", date: "2026-10-19", documentId: "doc_qc011" },
    { id: "n_inv41", type: "INVOICE_IN", label: "MPS/26-27/041", stage: "invoice", amount: { amount: "70800.00", currency: INR }, date: "2026-10-20", documentId: "doc_inv041", severity: "high" },
    { id: "n_inv41b", type: "INVOICE_IN", label: "MPS-26-27-041", stage: "invoice", amount: { amount: "70800.00", currency: INR }, date: "2026-10-20", documentId: "doc_inv041b", severity: "high" },
    { id: "n_t01", type: "PAYMENT_OUT", label: "T01", stage: "payment", amount: { amount: "30000.00", currency: INR }, date: "2026-10-25", documentId: "doc_pay01" },
    { id: "n_t02", type: "PAYMENT_OUT", label: "T02", stage: "payment", amount: { amount: "20800.00", currency: INR }, date: "2026-10-29", documentId: "doc_pay02" },
    { id: "n_t03", type: "PAYMENT_OUT", label: "T03", stage: "payment", amount: { amount: "15000.00", currency: INR }, date: "2026-11-02", documentId: "doc_pay03", severity: "medium" },
    { id: "n_f1", type: "FINDING", label: "Possible duplicate", stage: "finding", severity: "high", documentId: "fnd_dup041" },
    { id: "n_f2", type: "FINDING", label: "Unclear payment", stage: "finding", severity: "medium", documentId: "fnd_t03" },
  ],
  edges: [
    { id: "e1", source: "n_sup", target: "n_po", kind: "FULFILS", certainty: "CONFIRMED", label: "Supplier on order", explanation: "Supplier named on PO-1001.", evidenceIds: ["evd_4"] },
    { id: "e2", source: "n_po", target: "n_grn1", kind: "RECEIVES", certainty: "CONFIRMED", amount: { amount: "47200.00", currency: INR }, qty: "40", label: "40 kits received", explanation: "GRN 000027 references PO-1001 line 1.", evidenceIds: ["evd_4"] },
    { id: "e3", source: "n_po", target: "n_grn2", kind: "RECEIVES", certainty: "CONFIRMED", amount: { amount: "23600.00", currency: INR }, qty: "20", label: "20 kits received", explanation: "GRN 000031 references PO-1001 line 1.", evidenceIds: ["evd_4"] },
    { id: "e4", source: "n_grn1", target: "n_qc", kind: "INSPECTS", certainty: "CONFIRMED", qty: "40", label: "40 accepted", explanation: "All 40 kits from lot 1 accepted at inspection.", evidenceIds: [] },
    { id: "e5", source: "n_grn2", target: "n_qc", kind: "INSPECTS", certainty: "CONFIRMED", qty: "20", label: "20 accepted", explanation: "All 20 kits from lot 2 accepted at inspection.", evidenceIds: [] },
    { id: "e6", source: "n_po", target: "n_inv41", kind: "BILLS", certainty: "CONFIRMED", amount: { amount: "70800.00", currency: INR }, label: "Billed ₹70,800", explanation: "MPS/26-27/041 references PO-1001: 60 kits × ₹1,000 + 18% GST.", evidenceIds: ["evd_1"] },
    { id: "e7", source: "n_inv41", target: "n_inv41b", kind: "DUPLICATE_OF", certainty: "PROBABLE", amount: { amount: "70800.00", currency: INR }, label: "Likely the same invoice", explanation: "Same supplier, invoice date and amount; number re-keyed with different separators.", evidenceIds: ["evd_1", "evd_2"] },
    { id: "e8", source: "n_inv41", target: "n_t01", kind: "SETTLES", certainty: "CONFIRMED", amount: { amount: "30000.00", currency: INR }, label: "₹30,000 via T01", explanation: "NEFT HDFCN26298105214 quotes MPS/26-27/041.", evidenceIds: [] },
    { id: "e9", source: "n_inv41", target: "n_t02", kind: "SETTLES", certainty: "CONFIRMED", amount: { amount: "20800.00", currency: INR }, label: "₹20,800 via T02", explanation: "NEFT HDFCN26302359616 quotes MPS/26-27/041.", evidenceIds: [] },
    { id: "e10", source: "n_inv41", target: "n_t03", kind: "SETTLES", certainty: "AMBIGUOUS", amount: { amount: "15000.00", currency: INR }, label: "Possibly ₹15,000", explanation: "T03 has no invoice reference; one of two candidates.", evidenceIds: ["evd_3"] },
    { id: "e11", source: "n_f1", target: "n_inv41b", kind: "DUPLICATE_OF", certainty: "PROBABLE", label: "Flagged", explanation: "Duplicate invoice finding.", evidenceIds: ["evd_2"] },
    { id: "e12", source: "n_f2", target: "n_t03", kind: "SETTLES", certainty: "AMBIGUOUS", label: "Flagged", explanation: "Unallocated payment finding.", evidenceIds: ["evd_3"] },
  ],
  timeline: [
    { at: "2026-10-05", nodeIds: ["n_sup", "n_ent", "n_po"], edgeIds: ["e1"] },
    { at: "2026-10-14", nodeIds: ["n_grn1"], edgeIds: ["e2"] },
    { at: "2026-10-18", nodeIds: ["n_grn2"], edgeIds: ["e3"] },
    { at: "2026-10-19", nodeIds: ["n_qc"], edgeIds: ["e4", "e5"] },
    { at: "2026-10-20", nodeIds: ["n_inv41"], edgeIds: ["e6"] },
    { at: "2026-10-25", nodeIds: ["n_t01"], edgeIds: ["e8"] },
    { at: "2026-10-29", nodeIds: ["n_t02"], edgeIds: ["e9"] },
    { at: "2026-10-31", nodeIds: ["n_inv41b", "n_f1"], edgeIds: ["e7", "e11"] },
    { at: "2026-11-02", nodeIds: ["n_t03", "n_f2"], edgeIds: ["e10", "e12"] },
  ],
  source: "snapshot",
};

export const mockSnapshot: Snapshot = {
  id: "snp_flagship",
  caseId: "case_po1001",
  knowledgeTime: "2026-11-14T09:00:00+05:30",
  engineVersion: "recon-v2.0",
  modelVersion: "mock",
  ledger: {},
  lines: [
    // paid is expressed in units: ₹50,800 settled ÷ ₹1,180 per kit incl. GST = 43.05
    { lineNo: 1, ordered: "100", received: "60", accepted: "60", rejected: "0", invoiced: "60", paid: "43.05", open: "40" },
  ],
  findings: flagshipFindings,
  links: [],
  ambiguities: [],
  recommendation: {
    action: "PLACE_ON_HOLD",
    scope: {
      holdAmount: { amount: "70800.00", currency: INR },
      approveAmount: { amount: "20000.00", currency: INR },
    },
    reasons: [
      "Hold ₹70,800 — MPS-26-27-041 is likely a second posting of MPS/26-27/041.",
      "Approve ₹20,000 — the unpaid balance of MPS/26-27/041, backed by 60 received kits.",
      "₹15,000 T03 is unallocated — ask Meridian for a remittance advice before deducting it.",
    ],
  },
  graph: flagshipGraph,
  balances: {
    supported: { amount: "20000.00", currency: INR },
    recorded: { amount: "90800.00", currency: INR },
    disputed: { amount: "70800.00", currency: INR },
  },
  createdAt: "2026-11-14T09:00:00+05:30",
};
