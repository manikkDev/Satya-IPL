// v2 contract types (docs/plan/02 §3, §5, §7). Money/quantity/percent are
// decimal strings everywhere; the client formats but never computes them.

import type { Certainty, Action } from "@/content/copy/vocabulary";
export type { Certainty, Action };

export type Money = { amount: string; currency: string };

export type DocType =
  | "PR" | "RFQ" | "QUOTATION"
  | "PI_IN" | "PI_OUT"
  | "PO" | "PO_AMENDMENT" | "PO_ACK" | "RELEASE_ORDER"
  | "INVOICE_IN" | "INVOICE_OUT"
  | "CREDIT_NOTE_IN" | "DEBIT_NOTE_OUT" | "CREDIT_NOTE_OUT" | "DEBIT_NOTE_IN"
  | "DELIVERY_CHALLAN" | "EWAY_BILL" | "LR"
  | "GRN" | "QC" | "RETURN"
  | "PAYMENT_OUT" | "PAYMENT_IN" | "ADVANCE_OUT" | "REMITTANCE_ADVICE"
  | "TDS_ENTRY" | "GSTR2B_ENTRY" | "IMS_ACTION" | "BANK_LINE" | "SUPPLIER_STATEMENT_LINE";

export type Address = {
  line1: string; line2?: string; city: string; stateCode: string; pincode: string; country: "IN" | string;
};

export type Party = {
  name: string; gstin?: string; pan?: string; stateCode?: string; address?: Address;
  udyam?: { number: string; category: "micro" | "small" | "medium" };
  supplierId?: string;
};

export type DocLine = {
  lineNo: number; itemId?: string; sku?: string; description: string; specs?: Record<string, string>;
  hsn?: string; uom: string; qty: string; rate?: string; discountPct?: string;
  taxableValue?: string; gstRate?: string; cgst?: string; sgst?: string; igst?: string; cess?: string; lineTotal?: string;
  scheduleDate?: string;
  refs?: { poId?: string; poLineNo?: number; grnId?: string; grnLineNo?: number; invoiceId?: string; invoiceLineNo?: number };
  acceptedQty?: string; rejectedQty?: string; rejectReason?: string;
  batch?: string;
};

export type DocStatus =
  | "draft" | "pending_approval" | "approved" | "issued" | "acknowledged"
  | "partially_fulfilled" | "fulfilled" | "short_closed" | "cancelled"
  | "posted" | "reversed" | "confirmed" | "rejected";

export type BusinessDocument = {
  id: string; groupId: string; entityId: string; type: DocType;
  number: string; externalRef?: string; date: string; fy: string;
  status: DocStatus; revision: number; supersedes?: string;
  seller: Party; buyer: Party; shipTo?: Address; placeOfSupply?: string;
  currency: string; fx?: { rate: string; source: string; date: string };
  lines: DocLine[];
  charges?: { kind: "freight" | "packing" | "insurance" | "other"; description: string; amount: string; hsnOrSac?: string; gstRate?: string }[];
  totals?: { taxable: string; cgst: string; sgst: string; igst: string; cess: string; roundOff: string; grand: string };
  payment?: {
    utr?: string; mode?: "NEFT" | "RTGS" | "IMPS" | "UPI" | "CHEQUE" | "OTHER"; amount: string; valueDate?: string;
    bankAccountMasked?: string;
    allocations?: { documentId: string; amount: string; basis: "reference" | "reviewer" | "remittance" }[];
    tdsAmount?: string; reversalOf?: string;
  };
  gst?: {
    irn?: string; ackNo?: string; ackDate?: string;
    signedQr?: { verified: boolean; keyId?: string; fields?: Record<string, string> };
    ewayBillNo?: string; reverseCharge?: boolean;
    lut?: { arn: string; fy: string };
    supplyType?: "B2B" | "EXPWP" | "EXPWOP" | "SEZWP" | "SEZWOP";
  };
  terms?: {
    paymentTerms?: string; creditDays?: number; advancePct?: string; deliveryTerms?: string;
    inspection?: string; warranty?: string; penalty?: string; validityDays?: number; freeText?: string[];
  };
  source: {
    channel: "created_in_satya" | "upload_pdf" | "upload_image" | "csv" | "excel" | "json" | "einvoice_json" | "bank_csv" | "gstr2b_json" | "api";
    fileId?: string; extractionDraftId?: string; sourceSystem?: string;
  };
  provenance: "USER_PROVIDED" | "SYSTEM_GENERATED" | "EXTRACTED_REVIEWED" | "CONSTRUCTED_DEMO";
  observedAt: string; createdAt: string; createdBy: string; updatedAt: string;
};

export type Evidence = {
  id: string; documentId: string; documentType: string; field: string; value?: string;
  locator: {
    kind: "pdf_text" | "pdf_region" | "csv_cell" | "json_path" | "qr_field" | "manual";
    page?: number; row?: number; column?: string; path?: string; quote?: string;
  };
  fileId?: string; observedAt: string;
};

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Finding = {
  id: string; code: string; title: string; severity: Severity; certainty: Certainty;
  exposure?: { min: Money; max: Money } | Money;
  documentIds: string[]; evidence: Evidence[]; explanation: string;
  calculation: { step: string; formula?: string; value?: string; evidenceIds?: string[] }[];
  candidates?: { documentId: string; score?: string; why: string }[];
  recommendedAction: Action;
  actionScope?: { holdAmount?: Money; approveAmount?: Money };
  whatResolvesIt: string; detector: "rule" | "ml" | "hybrid"; detectorVersion: string;
  harmlessVariance?: boolean;
};

export type Recommendation = {
  action: Action;
  scope?: { holdAmount?: Money; approveAmount?: Money };
  reasons: string[];
};

export type GraphNode = {
  id: string; type: DocType | "SUPPLIER" | "ENTITY" | "ITEM" | "FINDING";
  label: string; subtitle?: string;
  stage: "order" | "dispatch" | "receipt" | "inspection" | "invoice" | "payment" | "tax" | "party" | "finding";
  amount?: Money; qty?: string; date?: string; status?: string; severity?: string; documentId?: string;
};

export type GraphEdge = {
  id: string; source: string; target: string; kind: string; certainty: Certainty;
  amount?: Money; qty?: string; label: string; explanation: string; evidenceIds: string[];
};

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timeline: { at: string; nodeIds: string[]; edgeIds: string[] }[];
  source: "neo4j" | "snapshot";
};

export type LineLifecycle = {
  lineNo: number; ordered: string; received: string; accepted: string;
  rejected: string; invoiced: string; paid: string; open: string;
};

export type Deadline = {
  kind: "MSME_45" | "RULE_37_180" | "EINVOICE_30" | "PO_DELIVERY";
  documentId: string; supplier: string; dueDate: string; daysLeft: number; amount: Money;
};

export type Today = {
  moneyAtRisk: Money;
  holds: { count: number; amount: Money };
  approvalsWaiting: number;
  deadlines: Deadline[];
  itcAtRisk: Money;
  topFindings: Finding[];
  /** client-composed convenience fields the dashboard may also return */
  supportedOutstanding?: Money;
  paymentsDueWeek?: Money;
  attention?: { id: string; text: string; actionLabel: string; href: string }[];
  activity?: { id: string; text: string; at: string }[];
};

export type Case = {
  id: string; groupId: string; entityId: string;
  kind: "po" | "supplier_period" | "payment" | "custom";
  subjectIds: string[]; title: string;
  status: "open" | "in_review" | "resolved" | "escalated" | "on_hold";
  latestSnapshotId?: string; revision: number; assignee?: string; priority?: string;
};

export type Snapshot = {
  id: string; caseId: string; knowledgeTime: string;
  engineVersion: string; modelVersion: string;
  ledger: Record<string, string | Money>;
  lines: LineLifecycle[];
  findings: Finding[]; links: unknown[]; ambiguities: unknown[];
  recommendation: Recommendation;
  graph: GraphPayload;
  balances?: { supported: Money; recorded: Money; disputed: Money };
  createdAt: string;
};

export type Page<T> = { items: T[]; nextCursor: string | null; total?: number };

export type ApiErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId?: string };
};
