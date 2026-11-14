// Shared words for the Documents pages.

export const DOC_TYPE_LABEL: Record<string, string> = {
  INVOICE_IN: "Purchase invoice",
  INVOICE_OUT: "Sales invoice",
  PO: "Purchase order",
  PO_AMENDMENT: "Order amendment",
  PI_IN: "Proforma invoice",
  PI_OUT: "Proforma invoice",
  GRN: "Goods receipt",
  DELIVERY_CHALLAN: "Delivery challan",
  QC: "Quality check",
  PAYMENT_OUT: "Payment",
  PAYMENT_IN: "Receipt",
  ADVANCE_OUT: "Advance payment",
  BANK_LINE: "Bank statement line",
  CREDIT_NOTE_IN: "Credit note",
  CREDIT_NOTE_OUT: "Credit note (issued)",
  DEBIT_NOTE_IN: "Debit note",
  DEBIT_NOTE_OUT: "Debit note (issued)",
  EWAY_BILL: "E-way bill",
  LR: "Lorry receipt",
  TDS_ENTRY: "TDS entry",
  GSTR2B_ENTRY: "GSTR-2B entry",
};

export const docTypeLabel = (type?: string | null): string =>
  type ? DOC_TYPE_LABEL[type] ?? type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Document";

export const MAX_UPLOAD_MB = 10;
export const ACCEPT_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".csv", ".xlsx", ".json"];

export const formatBytes = (bytes?: number): string =>
  bytes === undefined ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
