// Extended mock data for v2 screens (NEXT_PUBLIC_USE_MOCKS=1). Identities,
// numbers and dates mirror the curated demo dataset (server/src/seed,
// docs/DEMO_DATASET.md) as seeded on 14 Nov 2026; PO-1001 mirrors the
// flagship regression fixture in ./flagship.ts.

import type { BusinessDocument, Case, Page } from "@/lib/api/types";
import { mockCase, mockSnapshot } from "@/lib/mocks/flagship";

const INR = "INR";
const money = (amount: string) => ({ amount, currency: INR });

export type OrderListRow = {
  id: string; number: string; supplier: string; entity: string;
  value: { amount: string; currency: string };
  deliveredPct: string; invoicedPct: string; paidPct: string;
  issueCount: number; status: string; date: string;
};

// value = PO grand total; invoiced/paid % are against that value.
export const mockOrders: OrderListRow[] = [
  // ₹70,800 billed / ₹1,18,000 = 60%; ₹50,800 paid / ₹1,18,000 = 43%
  { id: "doc_po1001", number: "SATYAD/PO/26-27/000029", supplier: "Meridian Pump Supply", entity: "SATYAD", value: money("118000.00"), deliveredPct: "60", invoicedPct: "60", paidPct: "43", issueCount: 3, status: "partially_fulfilled", date: "2026-10-05" },
  { id: "doc_po1002", number: "SATYAD/PO/26-27/000031", supplier: "Meridian Pump Supply", entity: "SATYAD", value: money("17700.00"), deliveredPct: "100", invoicedPct: "100", paidPct: "0", issueCount: 0, status: "fulfilled", date: "2026-10-07" },
  // billed at ₹44,200 vs PO ₹42,500 → ₹3,12,936 against ₹3,00,900 (shown capped at 100%)
  { id: "doc_cur_s14_po", number: "SATYAD/PO/26-27/000022", supplier: "Godavari Electric Motors Ltd", entity: "SATYAD", value: money("300900.00"), deliveredPct: "100", invoicedPct: "100", paidPct: "0", issueCount: 1, status: "fulfilled", date: "2026-08-31" },
  { id: "doc_cur_s34_po", number: "SATYAD/PO/26-27/000035", supplier: "Shakti Industrial Suppliers Pvt Ltd", entity: "SATYAD", value: money("141540.00"), deliveredPct: "0", invoicedPct: "0", paidPct: "0", issueCount: 0, status: "issued", date: "2026-11-10" },
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
    id: "doc_po1001", groupId: "grp_satya_demo", entityId: "ent_satyad",
    type: "PO", number: "SATYAD/PO/26-27/000029", externalRef: "PO-1001",
    date: "2026-10-05", fy: "2026-27", status: "partially_fulfilled", revision: 3,
    seller: { name: "Meridian Pump Supply", gstin: "27BXJPJ7316C1ZK", pan: "BXJPJ7316C", stateCode: "27", udyam: { number: "UDYAM-MH-18-0061204", category: "micro" } },
    buyer: { name: "Satya Equipment Distribution Pvt Ltd", gstin: "27AAKCS4821M1ZW", pan: "AAKCS4821M", stateCode: "27" },
    placeOfSupply: "27", currency: INR,
    lines: [
      { lineNo: 1, sku: "PMP-IMP-CP100", description: "CP-100 process pump impeller kit, SS316 (impeller, wear ring, key)", hsn: "84139190", uom: "SET", qty: "100", rate: "1000", taxableValue: "100000.00", gstRate: "18", cgst: "9000.00", sgst: "9000.00", igst: "0.00", lineTotal: "118000.00", scheduleDate: "2026-11-20" },
    ],
    totals: { taxable: "100000.00", cgst: "9000.00", sgst: "9000.00", igst: "0.00", cess: "0.00", roundOff: "0.00", grand: "118000.00" },
    terms: { paymentTerms: "45 days from acceptance (MSME — MSMED Act s.15 applies)", creditDays: 45, deliveryTerms: "FOR Chakan works, freight and transit insurance included", inspection: "Visual, dimensional and functional check at receipt; acceptance subject to QC", warranty: "12 months from commissioning or 18 months from supply, whichever is earlier" },
    source: { channel: "created_in_satya" },
    provenance: "CONSTRUCTED_DEMO",
    observedAt: "2026-10-05T10:15:00+05:30", createdAt: "2026-10-05T10:15:00+05:30", createdBy: "usr_sanjay", updatedAt: "2026-10-18T15:30:00+05:30",
  },
  lifecycle: [
    // paid in units: ₹50,800 ÷ ₹1,180 per kit incl. GST
    { lineNo: 1, description: "CP-100 process pump impeller kit, SS316", ordered: "100", received: "60", accepted: "60", rejected: "0", invoiced: "60", paid: "43.05", open: "40" },
  ],
  schedule: [
    { batch: "Lot 1", qty: "40", dueDate: "2026-10-14", receivedQty: "40", overdue: false },
    { batch: "Lot 2", qty: "20", dueDate: "2026-10-18", receivedQty: "20", overdue: false },
    { batch: "Lot 3 (balance)", qty: "40", dueDate: "2026-11-20", receivedQty: "0", overdue: false },
  ],
  documents: [
    { id: "doc_grn010", type: "GRN", number: "SATYAD/GRN/26-27/000027", date: "2026-10-14", status: "confirmed" },
    { id: "doc_grn011", type: "GRN", number: "SATYAD/GRN/26-27/000031", date: "2026-10-18", status: "confirmed" },
    { id: "doc_qc011", type: "QC", number: "SATYAD/QC/26-27/000026", date: "2026-10-19", status: "confirmed" },
    { id: "doc_inv041", type: "INVOICE_IN", number: "MPS/26-27/041", date: "2026-10-20", amount: money("70800.00"), status: "posted" },
    { id: "doc_pay01", type: "PAYMENT_OUT", number: "T01 · UTR HDFCN26298105214", date: "2026-10-25", amount: money("30000.00"), status: "posted" },
    { id: "doc_pay02", type: "PAYMENT_OUT", number: "T02 · UTR HDFCN26302359616", date: "2026-10-29", amount: money("20800.00"), status: "posted" },
    { id: "doc_inv041b", type: "INVOICE_IN", number: "MPS-26-27-041", date: "2026-10-20", amount: money("70800.00"), status: "posted", finding: "Possible second posting of MPS/26-27/041 (imported 31 Oct)" },
    { id: "doc_pay03", type: "PAYMENT_OUT", number: "T03 · UTR HDFCN26306733217", date: "2026-11-02", amount: money("15000.00"), status: "posted", finding: "No invoice reference — needs allocation" },
  ],
  history: [
    { revision: 3, at: "2026-10-18T15:30:00+05:30", by: "Sanjay Deshmukh", change: "Balance 40 kits rescheduled to 20 Nov at Meridian's request" },
    { revision: 2, at: "2026-10-05T10:15:00+05:30", by: "Priya Kulkarni", change: "Purchase order approved and issued" },
    { revision: 1, at: "2026-10-05T09:20:00+05:30", by: "Sanjay Deshmukh", change: "Submitted for approval" },
  ],
  caseId: "case_po1001",
};

export const mockInvestigations: Page<Case & { severity?: string; findingCount?: number; subject?: string }> = {
  items: [
    { ...mockCase, findingCount: 3, severity: "high", subject: "PO-1001" },
    {
      id: "case_cur_s14", groupId: "grp_satya_demo", entityId: "ent_satyad", kind: "po" as const,
      subjectIds: ["doc_cur_s14_po"], title: "PO SATYAD/PO/26-27/000022 — Godavari Electric Motors Ltd", status: "in_review" as const,
      revision: 1, findingCount: 1, severity: "high", subject: "Price variance",
    },
    {
      id: "case_cur_s04", groupId: "grp_satya_demo", entityId: "ent_satyad", kind: "po" as const,
      subjectIds: ["doc_cur_s04_po"], title: "PO SATYAD/PO/26-27/000019 — Deccan Valve Industries", status: "on_hold" as const,
      revision: 1, findingCount: 3, severity: "high", subject: "Over-billed",
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
    { id: "dec_2", action: "REQUEST_CLARIFICATION", reason: "Asked Meridian for the remittance advice on T03 (₹15,000).", actor: "Priya Kulkarni", role: "ap_manager", createdAt: "2026-11-03T16:40:00+05:30" },
    { id: "dec_1", action: "PLACE_ON_HOLD", reason: "MPS-26-27-041 matches MPS/26-27/041 on supplier, date and amount — holding until Meridian confirms it is the same invoice.", actor: "Priya Kulkarni", role: "ap_manager", createdAt: "2026-11-01T12:10:00+05:30", scope: { amount: "70800.00", currency: INR } },
  ],
};

export type Draft = {
  id: string; filename: string; uploadedAt: string;
  status: "queued" | "parsing" | "extracting" | "needs_review" | "confirmed" | "failed";
  detectedType?: string; method?: string; issue?: string;
  fileId?: string; confirmedDocumentId?: string;
};

export const mockDrafts: Draft[] = [
  { id: "drf_001", filename: "ap-export-oct-MPS-26-27-041.pdf", uploadedAt: "2026-10-31T17:05:00+05:30", status: "needs_review", detectedType: "INVOICE_IN", method: "text_layer" },
  { id: "drf_002", filename: "einvoice-GEM-26-27-04131.json", uploadedAt: "2026-09-13T18:02:00+05:30", status: "confirmed", detectedType: "INVOICE_IN", method: "einvoice_qr" },
  { id: "drf_003", filename: "delivery-challan-shakti.jpg", uploadedAt: "2026-11-10T09:15:00+05:30", status: "needs_review", detectedType: "DELIVERY_CHALLAN", method: "vision_llm" },
  { id: "drf_004", filename: "hdfc-statement-oct-2026.csv", uploadedAt: "2026-11-02T11:00:00+05:30", status: "confirmed", detectedType: "BANK_LINE", method: "csv" },
  { id: "drf_005", filename: "invoice-scan-blur.pdf", uploadedAt: "2026-11-12T14:22:00+05:30", status: "failed", issue: "Could not read the document — photo is too blurry. Try a sharper scan." },
];

export type DraftDetail = {
  draft: Draft;
  fields: { group: string; items: { name: string; label: string; value: string; confidence: "high" | "check" | "low"; source: string; quote?: string }[] }[];
  lines: { lineNo: number; description: string; qty: string; rate: string; amount: string }[];
  issues: { severity: string; message: string; code?: string }[];
  suggestions: { supplier?: string; po?: string };
};

export const mockDraftDetail: DraftDetail = {
  draft: mockDrafts[0],
  fields: [
    {
      group: "Parties",
      items: [
        { name: "seller.name", label: "Supplier", value: "Meridian Pump Supply", confidence: "high", source: "Read by AI — quote found", quote: "Meridian Pump Supply, Shivaji Udyamnagar, Kolhapur" },
        { name: "seller.gstin", label: "Supplier GSTIN", value: "27BXJPJ7316C1ZK", confidence: "high", source: "Read by AI — quote found", quote: "GSTIN: 27BXJPJ7316C1ZK" },
        { name: "buyer.gstin", label: "Billed to (GSTIN)", value: "27AAKCS4821M1ZW", confidence: "check", source: "Read by AI — please check", quote: "Bill To: Satya Equipment Distribution Pvt Ltd" },
      ],
    },
    {
      group: "Document",
      items: [
        { name: "number", label: "Invoice number", value: "MPS-26-27-041", confidence: "high", source: "Read by AI — quote found", quote: "Invoice No: MPS-26-27-041" },
        { name: "date", label: "Invoice date", value: "2026-10-20", confidence: "high", source: "Read by AI — quote found", quote: "Date: 20-10-2026" },
      ],
    },
    {
      group: "Totals",
      items: [
        { name: "totals.grand", label: "Grand total", value: "70800.00", confidence: "high", source: "Read by AI — quote found", quote: "Total: ₹70,800.00" },
        { name: "totals.cgst", label: "CGST 9%", value: "5400.00", confidence: "check", source: "Read by AI — please check" },
        { name: "totals.sgst", label: "SGST 9%", value: "5400.00", confidence: "check", source: "Read by AI — please check" },
      ],
    },
  ],
  lines: [
    { lineNo: 1, description: "CP-100 process pump impeller kit, SS316", qty: "60", rate: "1000.00", amount: "60000.00" },
  ],
  issues: [
    { severity: "warning", code: "DUPLICATE_NUMBER", message: "Same supplier, date and ₹70,800 as MPS/26-27/041 already in your records — the number differs only in separators. Possible duplicate." },
  ],
  suggestions: { supplier: "Meridian Pump Supply", po: "PO-1001" },
};

export const mockPayments: Page<{
  id: string; utr?: string; date: string; supplier: string;
  amount: { amount: string; currency: string }; status: string; linkedTo?: string;
}> = {
  items: [
    { id: "doc_pay03", utr: "HDFCN26306733217", date: "2026-11-02", supplier: "Meridian Pump Supply", amount: money("15000.00"), status: "unclear" },
    { id: "doc_pay02", utr: "HDFCN26302359616", date: "2026-10-29", supplier: "Meridian Pump Supply", amount: money("20800.00"), status: "linked", linkedTo: "MPS/26-27/041" },
    { id: "doc_pay01", utr: "HDFCN26298105214", date: "2026-10-25", supplier: "Meridian Pump Supply", amount: money("30000.00"), status: "linked", linkedTo: "MPS/26-27/041" },
    { id: "doc_cur_s07_p2", utr: "HDFCN26238034497", date: "2026-08-26", supplier: "Kaveri Pumps & Motors Ltd", amount: money("12000.00"), status: "not_linked" },
  ],
  nextCursor: null, total: 4,
};

export const mockPaymentWorkbench = {
  payment: { id: "doc_pay03", date: "2026-11-02", supplier: "Meridian Pump Supply", amount: money("15000.00"), mode: "NEFT", bankAccountMasked: "****1952" },
  solutions: [
    { id: "sol_a", label: "Solution A", certainty: "POSSIBLE" as const, allocations: [{ document: "MPS/26-27/041", amount: money("15000.00") }], why: "Part payment of MPS/26-27/041 — ₹20,000 still open on it" },
    { id: "sol_b", label: "Solution B", certainty: "POSSIBLE" as const, allocations: [{ document: "MPS/26-27/042", amount: money("15000.00") }], why: "Part payment of MPS/26-27/042 (PO-1002) — ₹17,700 open, nothing paid yet" },
  ],
};

export type MockSupplier = {
  id: string; name: string; legalName?: string; tradeNames?: string[]; gstin: string;
  msme?: string; msmeFlag?: boolean;
  pan?: string; udyam?: { number: string; category: string; verifiedAt?: string };
  paymentTermsDays?: number;
  gstins?: { gstin: string; stateCode?: string; status?: string }[];
  bankAccounts?: { id?: string; masked?: string; accountMasked?: string; ifsc?: string; holderName?: string; status?: string }[];
  contacts?: { name?: string; email?: string; phone?: string }[];
  addresses?: { label?: string; line1?: string; city?: string; stateCode?: string; pin?: string }[];
  tags?: string[];
  openValue: { amount: string; currency: string }; overdue?: { amount: string; currency: string }; issueCount: number;
};

export const mockSuppliers: Page<MockSupplier> = {
  items: [
    {
      // open = ₹20,000 (041 balance) + ₹70,800 (second posting) + ₹17,700 (042)
      id: "sup_cur_meridian", name: "Meridian Pump Supply", legalName: "Meridian Pump Supply",
      tradeNames: ["Meridian Pumps"], gstin: "27BXJPJ7316C1ZK",
      pan: "BXJPJ7316C", msme: "micro", msmeFlag: true,
      udyam: { number: "UDYAM-MH-18-0061204", category: "micro", verifiedAt: "2026-03-18" },
      paymentTermsDays: 45,
      gstins: [{ gstin: "27BXJPJ7316C1ZK", stateCode: "27", status: "active" }],
      bankAccounts: [
        { id: "acc_cur_meridian", masked: "****1952", accountMasked: "****1952", ifsc: "BARB0KOLHAP", holderName: "Meridian Pump Supply", status: "active" },
      ],
      contacts: [{ name: "Rajesh Joshi (proprietor)", email: "meridianpumps@mail.example", phone: "+91 98221 70345" }],
      addresses: [{ label: "Registered office & works", line1: "Shop 14, Shivaji Udyamnagar", city: "Kolhapur", stateCode: "27", pin: "416008" }],
      tags: ["msme-micro", "intra-state"],
      openValue: money("108500.00"), overdue: money("0.00"), issueCount: 3,
    },
    {
      id: "sup_cur_kaveri", name: "Kaveri Pumps & Motors Ltd", legalName: "Kaveri Pumps & Motors Ltd",
      gstin: "29AACCK4412P1Z7",
      pan: "AACCK4412P", msme: "medium", msmeFlag: true,
      udyam: { number: "UDYAM-KR-03-0009821", category: "medium", verifiedAt: "2026-03-18" },
      paymentTermsDays: 30,
      gstins: [{ gstin: "29AACCK4412P1Z7", stateCode: "29", status: "active" }],
      bankAccounts: [
        { id: "acc_cur_kaveri", masked: "****4416", accountMasked: "****4416", ifsc: "CNRB0000437", holderName: "Kaveri Pumps & Motors Ltd", status: "active" },
      ],
      contacts: [{ name: "Ramesh Gowda", email: "receivables@kaveripumps.example", phone: "+91 98450 22816" }],
      addresses: [{ label: "Registered office & works", line1: "No. 44, 3rd Phase, Peenya Industrial Area", city: "Bengaluru", stateCode: "29", pin: "560058" }],
      tags: ["msme-medium", "inter-state"],
      openValue: money("0.00"), issueCount: 1,
    },
    {
      // open = ₹13,216 held on DVI/26-27/0105 + ₹68,676 on DVI/26-27/0134
      id: "sup_cur_deccan", name: "Deccan Valve Industries", legalName: "Deccan Valve Industries",
      gstin: "27AAKFD3320R1Z3",
      pan: "AAKFD3320R", msme: "small", msmeFlag: true,
      udyam: { number: "UDYAM-MH-31-0044559", category: "small", verifiedAt: "2026-03-18" },
      paymentTermsDays: 30,
      gstins: [{ gstin: "27AAKFD3320R1Z3", stateCode: "27", status: "active" }],
      bankAccounts: [
        { id: "acc_cur_deccan", masked: "****5903", accountMasked: "****5903", ifsc: "MAHB0000781", holderName: "Deccan Valve Industries", status: "active" },
      ],
      contacts: [{ name: "Sachin Jadhav", email: "sales@deccanvalves.example", phone: "+91 94220 15873" }],
      addresses: [{ label: "Registered office & works", line1: "Gat No. 611, Additional MIDC", city: "Satara", stateCode: "27", pin: "415004" }],
      tags: ["msme-small", "intra-state"],
      openValue: money("81892.00"), overdue: money("13216.00"), issueCount: 3,
    },
  ],
  nextCursor: null, total: 3,
};

type Rule37MockRow = {
  documentId: string; invoice: string; date: string; supplier: string; supplierEmail: string | null;
  daysWaiting: number; daysToBreach: number; state: "breached" | "approaching" | "reversed";
  itc: { amount: string; currency: string }; paidSoFar: { amount: string; currency: string }; outstanding: { amount: string; currency: string };
  interestEstimate: { amount: string; currency: string } | null; reversedAt: string | null; reversedBy: string | null; reversalNote: string | null;
};
type TdsRecordedMockRow = { documentId: string; section: string; amount: { amount: string; currency: string }; rate: string; date: string; paymentId: string; note: string | null };
type EinvoiceCheckMockRow = { documentId: string; invoice: string; date: string; supplier: string; supplierEmail: string | null; amount: { amount: string; currency: string }; irn: string | null; ewb: string | null; reason: string };

export const mockCompliance = {
  msme: {
    items: [
      { documentId: "doc_cur_s21_i1", invoice: "REW/26-27/0216", date: "2026-09-12", supplier: "Rathod Engineering Works Pvt Ltd", supplierId: "sup_cur_rathod", category: "micro", supplierEmail: "kiran@rathodengg.example", amount: money("94990.00"), paidSoFar: money("0.00"), outstanding: money("94990.00"), amountRecorded: true, agreedDays: 45, dueDate: "2026-10-27", daysLeft: -18, status: "overdue", note: "Overdue by 18 days — compound interest at 3× the RBI rate is already running" },
      { documentId: "doc_cur_s23_i1", invoice: "DVI/26-27/0134", date: "2026-10-19", supplier: "Deccan Valve Industries", supplierId: "sup_cur_deccan", category: "small", supplierEmail: "sales@deccanvalves.example", amount: money("68676.00"), paidSoFar: money("0.00"), outstanding: money("68676.00"), amountRecorded: true, agreedDays: 30, dueDate: "2026-11-18", daysLeft: 4, status: "due_soon", note: "Pay within 30 days of acceptance (30-day terms agreed)" },
      { documentId: "doc_inv042", invoice: "MPS/26-27/042", date: "2026-10-23", supplier: "Meridian Pump Supply", supplierId: "sup_cur_meridian", category: "micro", supplierEmail: "meridianpumps@mail.example", amount: money("17700.00"), paidSoFar: money("0.00"), outstanding: money("17700.00"), amountRecorded: true, agreedDays: 45, dueDate: "2026-12-07", daysLeft: 23, status: "upcoming", note: "Pay within 45 days of acceptance (45-day terms agreed)" },
    ],
    summary: { open: 3, overdue: 1, dueThisWeek: 1, outstanding: money("181366.00"), overdueAmount: money("94990.00") },
    note: "Paid in full or allocated payments are excluded. The deadline counts from the invoice date; acceptance dates from delivery records can move it.",
  },
  gstr2b: {
    estimated: false,
    period: "2026-10",
    periods: ["2026-10"],
    matched: 14,
    // the re-keyed second posting was never reported by Meridian — so it is absent from 2B
    missingIn2B: [{ documentId: "doc_inv041b", invoice: "MPS-26-27-041", date: "2026-10-20", supplier: "Meridian Pump Supply", supplierEmail: "meridianpumps@mail.example", amount: money("70800.00"), tax: money("10800.00"), period: null }],
    missingInBooks: [] as { documentId: string; invoice: string; supplier: string; amount: { amount: string; currency: string } }[],
    mismatched: [] as { documentId: string; invoice: string; supplier: string; reportedValue: { amount: string; currency: string }; difference: { amount: string; currency: string } }[],
    itcAtRisk: money("10800.00"),
    note: "Matched on supplier GSTIN + invoice number from your imported GSTR-2B.",
  },
  rule37: {
    // FY 2026-27 is 7 months old and nothing is unpaid past 150 days.
    items: [] as Rule37MockRow[],
    summary: { breached: 0, approaching: 0, reversed: 0, itcAtRisk: money("0.00"), interestAccruing: money("0.00") },
    note: "Rule 37: ITC claimed on an invoice unpaid after 180 days is added back to your output tax with 18% interest.",
  },
  tds: {
    items: [
      { documentId: "doc_pay03", payment: "doc_pay03", date: "2026-11-02", utr: "HDFCN26306733217", supplier: "Meridian Pump Supply", amount: money("15000.00"), status: "check", fyPaidToSupplier: money("150052.00"), note: "Goods purchase — 194Q applies only once purchases from one supplier exceed ₹50 lakh in the year (₹1,50,052 paid to Meridian so far). Confirm and mark not applicable." },
      { documentId: "doc_cur_s07_p2", payment: "doc_cur_s07_p2", date: "2026-08-26", utr: "HDFCN26238034497", supplier: "Kaveri Pumps & Motors Ltd", amount: money("12000.00"), status: "waived", note: "Marked N/A — goods purchase below the 194Q threshold" },
    ],
    recorded: [] as TdsRecordedMockRow[],
    summary: { paymentsScanned: 27, needsDecision: 1, recorded: 0, waived: 1, tdsDeducted: money("0.00") },
    note: "Satya flags payments that commonly need a TDS check (194C works, 194J professional, 194Q goods over ₹50L/year per supplier).",
  },
  eway: {
    einvoice: { withIrn: 16, waived: 0, pct: 48.5, checks: [] as EinvoiceCheckMockRow[] },
    eway: { withEwb: 27, waived: 0, goodsInvoices: 33, checks: [{ documentId: "doc_cur_s20_i1", invoice: "KPS2627-0290", date: "2026-08-12", supplier: "Kongu Pumps & Spares Pvt Ltd", supplierEmail: "billing@kongupumps.example", amount: money("267960.00"), irn: "00762f374063de34cb68fea3ddde365138f714c5ad84f6f0f844f48971886b6d", ewb: null, reason: "Goods over ₹50,000 need an e-way bill for the movement — confirm the supplier or transporter generated one." }] },
    note: "IRN/e-way details recorded here are supplier-supplied values — Satya does not verify them against the GST portal.",
  },
  lut: {
    entities: [{ entityId: "ent_satyad", code: "SATYAD", legalName: "Satya Equipment Distribution Pvt Ltd", status: "active", currentArn: "AD270326041178K", validTo: "2027-03-31", luts: [{ arn: "AD270326041178K", fy: "2026-27", validFrom: "2026-04-01", validTo: "2027-03-31", daysLeft: 137, status: "active" }] }],
    exportInvoices: [] as { documentId: string; invoice: string; buyer: string; amount: { amount: string; currency: string }; covered: boolean }[],
    summary: { entities: 1, covered: 1, uncoveredExports: 0 },
    note: "A LUT is filed per entity per financial year (GST RFD-11). Export/SEZ supplies without IGST are only valid while a LUT covers the invoice date.",
  },
};

export const mockCopilotAnswer = {
  answerType: "balance",
  certainty: "CONFIRMED" as const,
  content:
    "On PO-1001, **₹20,000.00** is backed by received and accepted goods and still unpaid.\n\nHere is how that adds up: the order is for 100 CP-100 impeller kits at ₹1,000 + 18% GST. 60 arrived in two lots and all 60 passed inspection. Invoice MPS/26-27/041 billed ₹70,800 for those 60 kits. Two transfers — T01 of ₹30,000 and T02 of ₹20,800 — are confirmed against it, leaving ₹20,000 supported by evidence.\n\nTwo things need your decision: MPS-26-27-041 (another ₹70,800) looks like a second posting of the same invoice, and transfer T03 of ₹15,000 does not name an invoice. What your books show as payable is ₹90,800.00 until those are resolved.",
  citations: [
    { n: 1, evidenceId: "evd_1", label: "MPS/26-27/041 · grand total", documentId: "doc_inv041", href: "/app/documents/doc_inv041" },
    { n: 2, evidenceId: "evd_5", label: "T01 · bank reference", documentId: "doc_pay01", href: "/app/documents/doc_pay01" },
    { n: 3, evidenceId: "evd_6", label: "QC 000026 · accepted qty", documentId: "doc_qc011", href: "/app/documents/doc_qc011" },
  ],
  facts: { supported: "20000.00", recorded: "90800.00", disputed: "70800.00", currency: INR },
  cards: [
    { label: "What you really owe", value: "₹20,000.00", detail: "Received, accepted, still unpaid" },
    { label: "Amount under question", value: "₹85,800.00", detail: "Likely second posting + unclear payment" },
    { label: "What your books show", value: "₹90,800.00", detail: "Recorded as payable" },
  ],
  suggestedFollowUps: ["Why is MPS-26-27-041 flagged as a duplicate?", "What would settle the T03 payment?", "Draft a message to Meridian asking about T03"],
};
