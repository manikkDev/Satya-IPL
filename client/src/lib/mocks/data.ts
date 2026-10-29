// Extended mock data for v2 screens (NEXT_PUBLIC_USE_MOCKS=1). Numbers for
// PO-1001 mirror the flagship regression fixture (docs/plan/01 §4).

import type { BusinessDocument, Case, Finding, Page } from "@/lib/api/types";
import { flagshipFindings, mockCase, mockSnapshot, mockSupplier } from "@/lib/mocks/flagship";

const INR = "INR";

export type OrderListRow = {
  id: string; number: string; supplier: string; entity: string;
  value: { amount: string; currency: string };
  deliveredPct: string; invoicedPct: string; paidPct: string;
  issueCount: number; status: string; date: string;
};

export const mockOrders: OrderListRow[] = [
  { id: "doc_po1001", number: "VPPL/PO/26-27/000123", supplier: "Mehta Engineering Works", entity: "VPPL", value: { amount: "118000.00", currency: INR }, deliveredPct: "60", invoicedPct: "60", paidPct: "43", issueCount: 2, status: "partially_fulfilled", date: "2026-10-05" },
  { id: "doc_po1002", number: "VPPL/PO/26-27/000124", supplier: "Kaveri Valves Pvt Ltd", entity: "VPPL", value: { amount: "31200.00", currency: INR }, deliveredPct: "100", invoicedPct: "100", paidPct: "0", issueCount: 0, status: "fulfilled", date: "2026-09-18" },
  { id: "doc_po1003", number: "VPPL/PO/26-27/000125", supplier: "Deccan Bearings & Tools", entity: "VPPL", value: { amount: "84900.00", currency: INR }, deliveredPct: "0", invoicedPct: "0", paidPct: "0", issueCount: 0, status: "pending_approval", date: "2026-10-27" },
  { id: "doc_po1004", number: "VPPL/PO/26-27/000126", supplier: "Sree Lakshmi Electricals", entity: "VPPL", value: { amount: "45200.00", currency: INR }, deliveredPct: "0", invoicedPct: "0", paidPct: "0", issueCount: 1, status: "issued", date: "2026-10-28" },
];

export type OrderDetail = {
  order: BusinessDocument;
  lifecycle: { lineNo: number; description: string; ordered: string; received: string; accepted: string; rejected: string; invoiced: string; paid: string; open: string }[];
  schedule: { batch: string; qty: string; dueDate: string; receivedQty: string; overdue: boolean }[];
  documents: { id: string; type: string; number: string; date: string; amount?: { amount: string; currency: string }; status: string; finding?: string }[];
  history: { revision: number; at: string; by: string; change: string }[];
  caseId: string;
};

export const mockOrderDetail: OrderDetail = {
  order: {
    id: "doc_po1001", groupId: "grp_vishwas", entityId: "ent_vppl",
    type: "PO", number: "VPPL/PO/26-27/000123", externalRef: "PO-1001",
    date: "2026-10-05", fy: "2026-27", status: "partially_fulfilled", revision: 1,
    seller: { name: "Mehta Engineering Works", gstin: "27AABCM5678K1Z1", stateCode: "27", udyam: { number: "UDYAM-MH-19-0012345", category: "small" } },
    buyer: { name: "Vishwas Pumps Pvt Ltd", gstin: "27AAACV1234F1Z5", stateCode: "27" },
    placeOfSupply: "27", currency: INR,
    lines: [
      { lineNo: 1, description: "Centrifugal pump 1 kW, model CP-100", hsn: "8413", uom: "NOS", qty: "100", rate: "1000.00", taxableValue: "100000.00", gstRate: "18", cgst: "9000.00", sgst: "9000.00", lineTotal: "118000.00" },
    ],
    totals: { taxable: "100000.00", cgst: "9000.00", sgst: "9000.00", igst: "0.00", cess: "0.00", roundOff: "0.00", grand: "118000.00" },
    terms: { paymentTerms: "30% advance, 70% within 30 days of acceptance", creditDays: 30, advancePct: "30", deliveryTerms: "FOR destination", inspection: "On receipt", warranty: "12 months" },
    source: { channel: "created_in_satya" },
    provenance: "USER_PROVIDED",
    observedAt: "2026-10-05T10:00:00+05:30", createdAt: "2026-10-05T10:00:00+05:30", createdBy: "usr_sanjay", updatedAt: "2026-10-10T09:00:00+05:30",
  },
  lifecycle: [
    { lineNo: 1, description: "Centrifugal pump 1 kW, model CP-100", ordered: "100", received: "60", accepted: "60", rejected: "0", invoiced: "60", paid: "60", open: "40" },
  ],
  schedule: [
    { batch: "Batch 1", qty: "40", dueDate: "2026-10-14", receivedQty: "40", overdue: false },
    { batch: "Batch 2", qty: "20", dueDate: "2026-10-28", receivedQty: "20", overdue: false },
    { batch: "Batch 3", qty: "40", dueDate: "2026-11-20", receivedQty: "0", overdue: false },
  ],
  documents: [
    { id: "doc_grn010", type: "GRN", number: "GRN-010", date: "2026-10-14", status: "confirmed" },
    { id: "doc_inv041", type: "INVOICE_IN", number: "INV-041", date: "2026-10-16", amount: { amount: "70800.00", currency: INR }, status: "posted" },
    { id: "doc_pay01", type: "PAYMENT_OUT", number: "T01 · UTR N291…", date: "2026-10-18", amount: { amount: "30000.00", currency: INR }, status: "posted" },
    { id: "doc_pay02", type: "PAYMENT_OUT", number: "T02 · UTR N304…", date: "2026-10-21", amount: { amount: "20800.00", currency: INR }, status: "posted" },
    { id: "doc_inv041b", type: "INVOICE_IN", number: "INV/041", date: "2026-10-26", amount: { amount: "70800.00", currency: INR }, status: "posted", finding: "Possible duplicate of INV-041" },
    { id: "doc_pay03", type: "PAYMENT_OUT", number: "T03 · no reference", date: "2026-10-27", amount: { amount: "15000.00", currency: INR }, status: "posted", finding: "No invoice reference — needs allocation" },
    { id: "doc_grn011", type: "GRN", number: "GRN-011", date: "2026-10-28", status: "confirmed" },
    { id: "doc_qc011", type: "QC", number: "QC-011", date: "2026-10-28", status: "confirmed" },
  ],
  history: [
    { revision: 1, at: "2026-10-10T09:00:00+05:30", by: "Sanjay Kulkarni", change: "Batch 3 delivery date moved to 20 Nov at supplier's request" },
    { revision: 0, at: "2026-10-05T10:00:00+05:30", by: "Sanjay Kulkarni", change: "Purchase order created and issued" },
  ],
  caseId: "case_po1001",
};

export const mockInvestigations: Page<Case & { severity?: string; findingCount?: number; subject?: string }> = {
  items: [
    { ...mockCase, findingCount: 3, severity: "high", subject: "PO-1001" },
    {
      id: "case_sup_kaveri", groupId: "grp_vishwas", entityId: "ent_vppl", kind: "supplier_period" as const,
      subjectIds: ["sup_kaveri"], title: "Kaveri Valves Pvt Ltd · Oct 2026", status: "in_review" as const,
      revision: 1, findingCount: 1, severity: "medium", subject: "Supplier period",
    },
    {
      id: "case_pay_t03", groupId: "grp_vishwas", entityId: "ent_vppl", kind: "payment" as const,
      subjectIds: ["doc_pay03"], title: "Payment T03 · ₹15,000 unallocated", status: "open" as const,
      revision: 1, findingCount: 1, severity: "medium", subject: "T03",
    },
  ],
  nextCursor: null,
  total: 3,
};

export const mockCaseDetail = {
  case: mockCase,
  snapshot: mockSnapshot,
  documents: mockOrderDetail.documents,
  decisions: [
    { id: "dec_1", action: "PLACE_ON_HOLD", reason: "Waiting for supplier to confirm the second posting is a duplicate.", actor: "Priya Nair", role: "ap_manager", createdAt: "2026-10-28T12:10:00+05:30", scope: { amount: "70800.00", currency: INR } },
    { id: "dec_2", action: "REQUEST_CLARIFICATION", reason: "Asked supplier for remittance advice on T03.", actor: "Priya Nair", role: "ap_manager", createdAt: "2026-10-27T16:40:00+05:30" },
  ],
};

export type Draft = {
  id: string; filename: string; uploadedAt: string;
  status: "queued" | "parsing" | "extracting" | "needs_review" | "confirmed" | "failed";
  detectedType?: string; method?: string; issue?: string;
};

export const mockDrafts: Draft[] = [
  { id: "drf_001", filename: "INV-041-mehta.pdf", uploadedAt: "2026-10-26T17:40:00+05:30", status: "needs_review", detectedType: "INVOICE_IN", method: "text_layer" },
  { id: "drf_002", filename: "einvoice-042.json", uploadedAt: "2026-10-26T18:02:00+05:30", status: "confirmed", detectedType: "INVOICE_IN", method: "einvoice_qr" },
  { id: "drf_003", filename: "delivery-challan-07.jpg", uploadedAt: "2026-10-28T09:15:00+05:30", status: "needs_review", detectedType: "DELIVERY_CHALLAN", method: "vision_llm" },
  { id: "drf_004", filename: "hdfc-statement-oct.csv", uploadedAt: "2026-10-27T11:00:00+05:30", status: "confirmed", detectedType: "BANK_LINE", method: "csv" },
  { id: "drf_005", filename: "invoice-scan-blur.pdf", uploadedAt: "2026-10-28T14:22:00+05:30", status: "failed", issue: "Could not read the document — photo is too blurry. Try a sharper scan." },
];

export type DraftDetail = {
  draft: Draft;
  fields: { group: string; items: { name: string; label: string; value: string; confidence: "high" | "check" | "low"; source: string; quote?: string }[] }[];
  lines: { lineNo: number; description: string; qty: string; rate: string; amount: string }[];
  issues: { severity: string; message: string }[];
  suggestions: { supplier?: string; po?: string };
};

export const mockDraftDetail: DraftDetail = {
  draft: mockDrafts[0],
  fields: [
    {
      group: "Parties",
      items: [
        { name: "seller.name", label: "Supplier", value: "Mehta Engineering Works", confidence: "high", source: "Read by AI — quote found", quote: "M/s Mehta Engineering Works, Pune" },
        { name: "seller.gstin", label: "Supplier GSTIN", value: "27AABCM5678K1Z1", confidence: "high", source: "Read by AI — quote found", quote: "GSTIN: 27AABCM5678K1Z1" },
        { name: "buyer.gstin", label: "Billed to (GSTIN)", value: "27AAACV1234F1Z5", confidence: "check", source: "Read by AI — please check", quote: "Bill To: Vishwas Pumps Pvt Ltd" },
      ],
    },
    {
      group: "Document",
      items: [
        { name: "number", label: "Invoice number", value: "INV/041", confidence: "high", source: "Read by AI — quote found", quote: "Invoice No: INV/041" },
        { name: "date", label: "Invoice date", value: "2026-10-26", confidence: "high", source: "Read by AI — quote found", quote: "Date: 26-10-2026" },
      ],
    },
    {
      group: "Totals",
      items: [
        { name: "totals.grand", label: "Grand total", value: "70800.00", confidence: "high", source: "Read by AI — quote found", quote: "Total: ₹70,800.00" },
        { name: "totals.igst", label: "IGST", value: "10800.00", confidence: "check", source: "Read by AI — please check" },
      ],
    },
  ],
  lines: [
    { lineNo: 1, description: "Centrifugal pump 1 kW CP-100", qty: "60", rate: "1000.00", amount: "60000.00" },
  ],
  issues: [
    { severity: "medium", message: "Same invoice number as INV-041 already in your records — possible duplicate." },
    { severity: "low", message: "IGST charged but both parties are in Maharashtra (CGST+SGST expected)." },
  ],
  suggestions: { supplier: "Mehta Engineering Works", po: "PO-1001" },
};

export const mockPayments: Page<{
  id: string; utr?: string; date: string; supplier: string;
  amount: { amount: string; currency: string }; status: string; linkedTo?: string;
}> = {
  items: [
    { id: "doc_pay01", utr: "N29120261018", date: "2026-10-18", supplier: "Mehta Engineering Works", amount: { amount: "30000.00", currency: INR }, status: "linked", linkedTo: "INV-041" },
    { id: "doc_pay02", utr: "N30420261021", date: "2026-10-21", supplier: "Mehta Engineering Works", amount: { amount: "20800.00", currency: INR }, status: "linked", linkedTo: "INV-041" },
    { id: "doc_pay03", date: "2026-10-27", supplier: "Mehta Engineering Works", amount: { amount: "15000.00", currency: INR }, status: "unclear" },
    { id: "doc_pay04", utr: "N31820261029", date: "2026-10-29", supplier: "Kaveri Valves Pvt Ltd", amount: { amount: "13200.00", currency: INR }, status: "not_linked" },
  ],
  nextCursor: null, total: 4,
};

export const mockPaymentWorkbench = {
  payment: { id: "doc_pay03", date: "2026-10-27", supplier: "Mehta Engineering Works", amount: { amount: "15000.00", currency: INR }, mode: "NEFT", bankAccountMasked: "••4821" },
  solutions: [
    { id: "sol_a", label: "Solution A", certainty: "POSSIBLE" as const, allocations: [{ document: "INV-041", amount: { amount: "15000.00", currency: INR } }], why: "Part payment of INV-041 — supplier matches" },
    { id: "sol_b", label: "Solution B", certainty: "POSSIBLE" as const, allocations: [{ document: "INV-042", amount: { amount: "10000.00", currency: INR } }, { document: "AP-992", amount: { amount: "5000.00", currency: INR } }], why: "INV-042 + advance request AP-992 — exact sum" },
  ],
};

export const mockSuppliers: Page<{
  id: string; name: string; gstin: string; msme?: string;
  openValue: { amount: string; currency: string }; overdue?: { amount: string; currency: string }; issueCount: number;
}> = {
  items: [
    { id: "sup_mehta", name: "Mehta Engineering Works", gstin: "27AABCM5678K1Z1", msme: "small", openValue: { amount: "38000.00", currency: INR }, overdue: { amount: "18000.00", currency: INR }, issueCount: 3 },
    { id: "sup_kaveri", name: "Kaveri Valves Pvt Ltd", gstin: "29AAKCK4412P1Z8", msme: "micro", openValue: { amount: "31200.00", currency: INR }, issueCount: 1 },
    { id: "sup_deccan", name: "Deccan Bearings & Tools", gstin: "27AAFCD2210R1Z3", openValue: { amount: "84900.00", currency: INR }, issueCount: 0 },
  ],
  nextCursor: null, total: 3,
};

export const mockCompliance = {
  msme: [
    { documentId: "doc_inv042", supplier: "Mehta Engineering Works", category: "small", invoice: "INV-042", amount: { amount: "18000.00", currency: INR }, dueDate: "2026-11-03", daysLeft: 5, note: "Pay or resolve the dispute before day 45 — interest runs at 3× the RBI rate." },
    { documentId: "doc_inv033", supplier: "Kaveri Valves Pvt Ltd", category: "micro", invoice: "INV-033", amount: { amount: "31200.00", currency: INR }, dueDate: "2026-11-25", daysLeft: 27, note: "Within the 45-day window." },
  ],
  gstr2b: {
    period: "2026-10",
    matched: 14,
    missingIn2B: [{ invoice: "INV-041", supplier: "Mehta Engineering Works", amount: { amount: "70800.00", currency: INR }, tax: { amount: "10800.00", currency: INR } }],
    missingInBooks: [] as { invoice: string; supplier: string; amount: { amount: string; currency: string } }[],
    mismatched: [] as { invoice: string; supplier: string; issue: string }[],
    itcAtRisk: { amount: "10800.00", currency: INR },
  },
};

export const mockCopilotAnswer = {
  answerType: "balance",
  certainty: "CONFIRMED" as const,
  content:
    "On PO-1001, **₹20,000.00** is backed by delivered and accepted goods and still unpaid.\n\nHere is how that adds up: the order is for 100 pumps, 60 arrived and all 60 passed quality check. Invoice INV-041 billed ₹70,800 for those 60 pumps. Two transfers — T01 of ₹30,000 and T02 of ₹20,800 — are confirmed against it, leaving ₹20,000 supported by evidence.\n\nTwo things need your decision: the second posting of INV-041 (another ₹70,800) looks like a duplicate, and transfer T03 of ₹15,000 does not name an invoice. What your books show as payable is ₹90,800.00 until those are resolved.",
  citations: [
    { n: 1, evidenceId: "evd_1", label: "INV-041 · grand total", documentId: "doc_inv041", href: "/app/documents/doc_inv041" },
    { n: 2, evidenceId: "evd_5", label: "T01 · bank reference", documentId: "doc_pay01", href: "/app/documents/doc_pay01" },
    { n: 3, evidenceId: "evd_6", label: "GRN-011 · accepted qty", documentId: "doc_grn011", href: "/app/documents/doc_grn011" },
  ],
  facts: { supported: "20000.00", recorded: "90800.00", disputed: "70800.00", currency: INR },
  cards: [
    { label: "What you really owe", value: "₹20,000.00", detail: "Delivered, accepted, still unpaid" },
    { label: "Amount under question", value: "₹85,800.00", detail: "Likely duplicate + unclear payment" },
    { label: "What your books show", value: "₹90,800.00", detail: "Recorded as payable" },
  ],
  suggestedFollowUps: ["Why is INV-041 flagged as a duplicate?", "What would settle the T03 payment?", "Draft a message to the supplier asking about T03"],
};
