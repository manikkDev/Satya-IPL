// Mock fixtures for NEXT_PUBLIC_USE_MOCKS=1 development (docs/plan/06 §8).
// Numbers mirror the flagship demo case PO-1001 (docs/plan/01 §4): they are
// regression fixtures, so they must stay exact — 100 ordered, 60 received,
// 60 accepted, INV-041 ₹70,800 likely-duplicate, T01 ₹30,000 + T02 ₹20,800
// settled, T03 ₹15,000 unclear (INV-041 / INV-042 / AP-992), supported
// outstanding ₹20,000, recorded AP ₹90,800.

import type { Finding, GraphPayload, Today, Case, Snapshot } from "@/lib/api/types";

const INR = "INR";

export const mockUser = {
  id: "usr_demo01",
  name: "Priya Nair",
  email: "priya@demo.satya.in",
  roles: ["ap_manager"],
};

export const mockEntities = [
  {
    id: "ent_vppl",
    code: "VPPL",
    legalName: "Vishwas Pumps Pvt Ltd",
    tradeName: "Vishwas Pumps",
    gstin: "27AAACV1234F1Z5",
    stateCode: "27",
  },
  {
    id: "ent_vdl",
    code: "VDL",
    legalName: "Vishwas Distributors LLP",
    tradeName: "Vishwas Distributors",
    gstin: "27AACFV9876G1Z2",
    stateCode: "27",
  },
];

export const mockSupplier = {
  id: "sup_mehta",
  legalName: "Mehta Engineering Works",
  tradeName: "Mehta Engg",
  gstin: "27AABCM5678K1Z1",
  udyam: { number: "UDYAM-MH-19-0012345", category: "small" as const },
};

const evidence = (id: string, documentId: string, documentType: string, field: string, quote: string) => ({
  id,
  documentId,
  documentType,
  field,
  locator: { kind: "pdf_text" as const, page: 1, quote },
  observedAt: "2026-10-20T09:00:00+05:30",
});

export const flagshipFindings: Finding[] = [
  {
    id: "fnd_dup041",
    code: "DUP_NEAR_INVOICE",
    title: "Invoice INV-041 may be recorded twice",
    severity: "high",
    certainty: "PROBABLE",
    exposure: { amount: "70800.00", currency: INR },
    documentIds: ["doc_inv041", "doc_inv041b"],
    evidence: [
      evidence("evd_1", "doc_inv041", "INVOICE_IN", "number", "INV-041"),
      evidence("evd_2", "doc_inv041b", "INVOICE_IN", "number", "INV/041"),
    ],
    explanation:
      "Two supplier invoices from Mehta Engineering Works carry the same invoice number with different formatting, for the same amount of ₹70,800. One of them is very likely a duplicate.",
    calculation: [
      { step: "Invoice INV-041 posted once", value: "₹70,800.00" },
      { step: "Second record INV/041 for the same supplier and amount", value: "₹70,800.00" },
    ],
    recommendedAction: "PLACE_ON_HOLD",
    actionScope: { holdAmount: { amount: "70800.00", currency: INR } },
    whatResolvesIt: "Supplier confirmation of the correct invoice, or your rejection of the second posting.",
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
    evidence: [evidence("evd_3", "doc_pay03", "PAYMENT_OUT", "amount", "15000")],
    explanation:
      "Transfer T03 of ₹15,000 has no usable invoice reference. It could fit three different records, and Satya will not guess which.",
    calculation: [],
    candidates: [
      { documentId: "doc_inv041", score: "0.41", why: "Supplier matches; amount could be a part payment of INV-041" },
      { documentId: "doc_inv042", score: "0.33", why: "Supplier matches; INV-042 is still unpaid" },
      { documentId: "doc_ap992", score: "0.26", why: "Advance request AP-992 is open for the same supplier" },
    ],
    recommendedAction: "REQUEST_CLARIFICATION",
    whatResolvesIt: "The supplier's remittance advice naming which invoice this transfer settles.",
    detector: "rule",
    detectorVersion: "recon-v2.0",
  },
  {
    id: "fnd_partial",
    code: "QTY_PARTIAL_DELIVERY",
    title: "40 of 100 pumps are still to arrive",
    severity: "info",
    certainty: "CONFIRMED",
    exposure: { amount: "0.00", currency: INR },
    documentIds: ["doc_po1001"],
    evidence: [evidence("evd_4", "doc_po1001", "PO", "lines[0].qty", "100")],
    explanation: "60 pumps arrived across two deliveries; the remaining 40 are due in the next batch per the delivery schedule.",
    calculation: [{ step: "Ordered 100 − received 60 = open 40" }],
    recommendedAction: "APPROVE",
    whatResolvesIt: "The final delivery, or a short-close if the supplier will not ship the rest.",
    detector: "rule",
    detectorVersion: "recon-v2.0",
    harmlessVariance: true,
  },
];

export const mockToday: Today = {
  moneyAtRisk: { amount: "85800.00", currency: INR },
  supportedOutstanding: { amount: "20000.00", currency: INR },
  itcAtRisk: { amount: "12744.00", currency: INR },
  paymentsDueWeek: { amount: "45800.00", currency: INR },
  holds: { count: 1, amount: { amount: "70800.00", currency: INR } },
  approvalsWaiting: 2,
  deadlines: [
    {
      kind: "MSME_45",
      documentId: "doc_inv042",
      supplier: "Mehta Engineering Works",
      dueDate: "2026-11-03",
      daysLeft: 5,
      amount: { amount: "18000.00", currency: INR },
    },
    {
      kind: "PO_DELIVERY",
      documentId: "doc_po1001",
      supplier: "Mehta Engineering Works",
      dueDate: "2026-11-20",
      daysLeft: 22,
      amount: { amount: "47200.00", currency: INR },
    },
    {
      kind: "EINVOICE_30",
      documentId: "doc_inv041",
      supplier: "Mehta Engineering Works",
      dueDate: "2026-11-09",
      daysLeft: 11,
      amount: { amount: "70800.00", currency: INR },
    },
    {
      kind: "RULE_37_180",
      documentId: "doc_inv033",
      supplier: "Kaveri Valves Pvt Ltd",
      dueDate: "2027-01-15",
      daysLeft: 78,
      amount: { amount: "31200.00", currency: INR },
    },
  ],
  topFindings: flagshipFindings,
  attention: [
    {
      id: "att_hold",
      text: "INV-041 (₹70,800) looks like a duplicate — put it on hold until the supplier confirms.",
      actionLabel: "Put on hold",
      href: "/app/investigations/case_po1001",
    },
    {
      id: "att_t03",
      text: "Payment T03 of ₹15,000 has no invoice reference — ask the supplier for a remittance advice.",
      actionLabel: "See candidates",
      href: "/app/investigations/case_po1001",
    },
    {
      id: "att_msme",
      text: "INV-042 to Mehta Engineering (small enterprise) breaches the 45-day rule in 5 days.",
      actionLabel: "Review payment",
      href: "/app/compliance",
    },
    {
      id: "att_approve",
      text: "2 purchase orders are waiting for approval per your delegation rules.",
      actionLabel: "Review approvals",
      href: "/app/orders?status=pending_approval",
    },
  ],
  activity: [
    { id: "act_1", text: "Goods receipt GRN-011 recorded — 20 pumps accepted", at: "2026-10-28T15:30:00+05:30" },
    { id: "act_2", text: "Bank import added transfer T03 (₹15,000)", at: "2026-10-27T11:10:00+05:30" },
    { id: "act_3", text: "Second posting of invoice INV-041 imported", at: "2026-10-26T17:45:00+05:30" },
    { id: "act_4", text: "PO-1001 acknowledged by Mehta Engineering Works", at: "2026-10-24T10:05:00+05:30" },
  ],
};

export const mockCase: Case = {
  id: "case_po1001",
  groupId: "grp_vishwas",
  entityId: "ent_vppl",
  kind: "po",
  subjectIds: ["doc_po1001"],
  title: "PO-1001 · Mehta Engineering Works",
  status: "open",
  latestSnapshotId: "snp_flagship",
  revision: 3,
};

export const flagshipGraph: GraphPayload = {
  nodes: [
    { id: "n_sup", type: "SUPPLIER", label: "Mehta Engineering Works", stage: "party", subtitle: "Small enterprise · Udyam verified" },
    { id: "n_ent", type: "ENTITY", label: "Vishwas Pumps Pvt Ltd", stage: "party", subtitle: "GSTIN 27AAACV…1Z5" },
    { id: "n_po", type: "PO", label: "PO-1001", stage: "order", qty: "100", date: "2026-10-05", status: "partially_fulfilled", documentId: "doc_po1001" },
    { id: "n_grn1", type: "GRN", label: "GRN-010", stage: "receipt", qty: "40", date: "2026-10-14", documentId: "doc_grn010" },
    { id: "n_grn2", type: "GRN", label: "GRN-011", stage: "receipt", qty: "20", date: "2026-10-28", documentId: "doc_grn011" },
    { id: "n_qc", type: "QC", label: "QC-011", stage: "inspection", qty: "60", date: "2026-10-28", documentId: "doc_qc011" },
    { id: "n_inv41", type: "INVOICE_IN", label: "INV-041", stage: "invoice", amount: { amount: "70800.00", currency: INR }, date: "2026-10-16", documentId: "doc_inv041", severity: "high" },
    { id: "n_inv41b", type: "INVOICE_IN", label: "INV/041", stage: "invoice", amount: { amount: "70800.00", currency: INR }, date: "2026-10-26", documentId: "doc_inv041b", severity: "high" },
    { id: "n_t01", type: "PAYMENT_OUT", label: "T01", stage: "payment", amount: { amount: "30000.00", currency: INR }, date: "2026-10-18", documentId: "doc_pay01" },
    { id: "n_t02", type: "PAYMENT_OUT", label: "T02", stage: "payment", amount: { amount: "20800.00", currency: INR }, date: "2026-10-21", documentId: "doc_pay02" },
    { id: "n_t03", type: "PAYMENT_OUT", label: "T03", stage: "payment", amount: { amount: "15000.00", currency: INR }, date: "2026-10-27", documentId: "doc_pay03", severity: "medium" },
    { id: "n_f1", type: "FINDING", label: "Possible duplicate", stage: "finding", severity: "high", documentId: "fnd_dup041" },
    { id: "n_f2", type: "FINDING", label: "Unclear payment", stage: "finding", severity: "medium", documentId: "fnd_t03" },
  ],
  edges: [
    { id: "e1", source: "n_sup", target: "n_po", kind: "FULFILS", certainty: "CONFIRMED", label: "Supplier on order", explanation: "Supplier named on PO-1001.", evidenceIds: ["evd_4"] },
    { id: "e2", source: "n_po", target: "n_grn1", kind: "RECEIVES", certainty: "CONFIRMED", amount: { amount: "47200.00", currency: INR }, qty: "40", label: "40 pumps received", explanation: "GRN-010 references PO-1001 line 1.", evidenceIds: ["evd_4"] },
    { id: "e3", source: "n_po", target: "n_grn2", kind: "RECEIVES", certainty: "CONFIRMED", qty: "20", label: "20 pumps received", explanation: "GRN-011 references PO-1001 line 1.", evidenceIds: ["evd_4"] },
    { id: "e4", source: "n_grn1", target: "n_qc", kind: "INSPECTS", certainty: "CONFIRMED", qty: "40", label: "40 accepted", explanation: "All 40 units accepted at inspection.", evidenceIds: [] },
    { id: "e5", source: "n_grn2", target: "n_qc", kind: "INSPECTS", certainty: "CONFIRMED", qty: "20", label: "20 accepted", explanation: "All 20 units accepted at inspection.", evidenceIds: [] },
    { id: "e6", source: "n_po", target: "n_inv41", kind: "BILLS", certainty: "CONFIRMED", amount: { amount: "70800.00", currency: INR }, label: "Billed ₹70,800", explanation: "INV-041 references PO-1001.", evidenceIds: ["evd_1"] },
    { id: "e7", source: "n_inv41", target: "n_inv41b", kind: "DUPLICATE_OF", certainty: "PROBABLE", amount: { amount: "70800.00", currency: INR }, label: "Likely the same invoice", explanation: "Same supplier, same amount, same invoice number with different formatting.", evidenceIds: ["evd_1", "evd_2"] },
    { id: "e8", source: "n_inv41", target: "n_t01", kind: "SETTLES", certainty: "CONFIRMED", amount: { amount: "30000.00", currency: INR }, label: "₹30,000 via T01", explanation: "Bank reference quotes INV-041.", evidenceIds: [] },
    { id: "e9", source: "n_inv41", target: "n_t02", kind: "SETTLES", certainty: "CONFIRMED", amount: { amount: "20800.00", currency: INR }, label: "₹20,800 via T02", explanation: "Bank reference quotes INV-041.", evidenceIds: [] },
    { id: "e10", source: "n_inv41", target: "n_t03", kind: "SETTLES", certainty: "AMBIGUOUS", amount: { amount: "15000.00", currency: INR }, label: "Possibly ₹15,000", explanation: "T03 has no invoice reference; one of three candidates.", evidenceIds: ["evd_3"] },
    { id: "e11", source: "n_f1", target: "n_inv41b", kind: "DUPLICATE_OF", certainty: "PROBABLE", label: "Flagged", explanation: "Duplicate invoice finding.", evidenceIds: ["evd_2"] },
    { id: "e12", source: "n_f2", target: "n_t03", kind: "SETTLES", certainty: "AMBIGUOUS", label: "Flagged", explanation: "Unallocated payment finding.", evidenceIds: ["evd_3"] },
  ],
  timeline: [
    { at: "2026-10-05", nodeIds: ["n_sup", "n_ent", "n_po"], edgeIds: ["e1"] },
    { at: "2026-10-14", nodeIds: ["n_grn1"], edgeIds: ["e2", "e4"] },
    { at: "2026-10-16", nodeIds: ["n_inv41"], edgeIds: ["e6"] },
    { at: "2026-10-18", nodeIds: ["n_t01"], edgeIds: ["e8"] },
    { at: "2026-10-21", nodeIds: ["n_t02"], edgeIds: ["e9"] },
    { at: "2026-10-26", nodeIds: ["n_inv41b", "n_f1"], edgeIds: ["e7", "e11"] },
    { at: "2026-10-27", nodeIds: ["n_t03", "n_f2"], edgeIds: ["e10", "e12"] },
    { at: "2026-10-28", nodeIds: ["n_grn2", "n_qc"], edgeIds: ["e3", "e5"] },
  ],
  source: "snapshot",
};

export const mockSnapshot: Snapshot = {
  id: "snp_flagship",
  caseId: "case_po1001",
  knowledgeTime: "2026-10-29T09:00:00+05:30",
  engineVersion: "recon-v2.0",
  modelVersion: "mock",
  ledger: {},
  lines: [
    { lineNo: 1, ordered: "100", received: "60", accepted: "60", rejected: "0", invoiced: "60", paid: "60", open: "40" },
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
      "Put ₹70,800 on hold — likely duplicate of INV-041.",
      "Approve ₹20,000 backed by deliveries.",
      "₹15,000 payment unclear — ask supplier for remittance advice.",
    ],
  },
  graph: flagshipGraph,
  balances: {
    supported: { amount: "20000.00", currency: INR },
    recorded: { amount: "90800.00", currency: INR },
    disputed: { amount: "70800.00", currency: INR },
  },
  createdAt: "2026-10-29T09:00:00+05:30",
};
