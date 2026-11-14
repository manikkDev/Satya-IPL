// Plain-English copy for the reconciliation engine's finding codes. The
// engine's own message stays as the specific detail line; this adds a short
// headline and what would actually settle the issue — so the page never
// shows a raw code or "see the source document".

import { formatDate, formatMoney } from "@/lib/format";

export type FindingCopy = {
  /** Short headline, sentence case. */
  label: string;
  /** What would settle it — one concrete next step. */
  settle: string;
};

export const FINDING_COPY: Record<string, FindingCopy> = {
  INVOICE_QTY_EXCEEDS_RECEIVED: {
    label: "Billed for more than was delivered",
    settle: "Ask the supplier for a credit note for the undelivered units — or record the missing goods receipt if they did arrive.",
  },
  QTY_INVOICED_EXCEEDS_ACCEPTED: {
    label: "Billed for goods that failed quality check",
    settle: "Raise a debit note for the rejected units, or record a revised quality-check result.",
  },
  DUPLICATE_INVOICE_SUSPECT: {
    label: "Possible duplicate invoice",
    settle: "Confirm with the supplier whether this is one bill or a revised one, then cancel the extra copy.",
  },
  DUP_EXACT_INVOICE: {
    label: "Same invoice recorded twice",
    settle: "Cancel the duplicate entry so the bill is not paid twice.",
  },
  DELIVERY_SHORTFALL: {
    label: "Delivery is short",
    settle: "Chase the remaining quantity, or short-close the order line if it is no longer needed.",
  },
  MSME_43BH_DEADLINE: {
    label: "MSME payment deadline passed",
    settle: "Pay the supplier (interest is due by law) or record why the bill is disputed.",
  },
  DOC_MISSING_INVOICE: {
    label: "Delivered, not billed yet",
    settle: "Nothing to pay yet — expect the supplier’s invoice and follow up if it is late.",
  },
  RECEIPT_EVIDENCE_MISSING: {
    label: "Billed with no goods-received record",
    settle: "Record the goods receipt, or hold the invoice until stores confirm the delivery.",
  },
  PAY_UNALLOCATED: {
    label: "Payment not linked to an invoice",
    settle: "Get the remittance details from the supplier, then allocate the payment in Payments.",
  },
  PAY_SPLIT: {
    label: "Invoice paid in instalments",
    settle: "Usually fine — confirm the payments add up to the invoice.",
  },
  PRICE_VARIANCE: {
    label: "Price differs from the order",
    settle: "Ask for a credit note for the difference, or approve the new rate in writing.",
  },
  DOC_CREDIT_NOTE_PENDING: {
    label: "Credit note not applied",
    settle: "Apply the credit note against an open invoice before the next payment.",
  },
  TAX_GSTIN_INVALID: {
    label: "Supplier GSTIN looks invalid",
    settle: "Ask for a corrected invoice with a valid GSTIN — GST credit can’t be claimed until then.",
  },
  TAX_TYPE_MISMATCH: {
    label: "Wrong type of GST charged",
    settle: "Ask for a revised invoice with the correct GST split (CGST + SGST for a same-state supply).",
  },
  TAX_EWAYBILL_MISSING: {
    label: "e-way bill number missing",
    settle: "Ask the supplier for the e-way bill number — it is required for goods over ₹50,000.",
  },
};

/** Fallback headline for codes without copy: "PAY_UNALLOCATED" → "Pay unallocated". */
export const codeWords = (code?: string | null) =>
  code ? code.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Issue";

export const findingLabel = (code?: string | null, fallback?: string) =>
  (code && FINDING_COPY[code]?.label) || fallback || codeWords(code);

export const findingSettle = (code?: string | null, fallback?: string) =>
  (code && FINDING_COPY[code]?.settle) || (fallback && !/^see the source/i.test(fallback) ? fallback : "") ||
  "Open the linked documents and correct whichever one is wrong.";

/** Tidy an engine sentence for reading: "44 day(s)" → "44 days",
 *  "₹88736.00" → "₹88,736.00", "2026-10-01" → "1 Oct 2026". */
export function tidyText(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/\b(\d+) day\(s\)/g, (_m, n) => `${n} day${n === "1" ? "" : "s"}`)
    .replace(/\b(\d+) unit\(s\)/g, (_m, n) => `${n} unit${n === "1" ? "" : "s"}`)
    .replace(/₹\s?(\d+(?:\.\d+)?)(?![\d,])/g, (_m, n) => formatMoney(n))
    .replace(/₹₹/g, "₹")
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_m, d) => formatDate(d))
    .replace(/\bMSMED s\.15\b/g, "MSME Act")
    .replace(/\bs\.43B\(h\)/g, "Section 43B(h)");
}

/** Recommendation action → the sentence a manager reads first. */
export const RECOMMENDATION_HEADLINE: Record<string, string> = {
  APPROVE: "Everything checks out — this can be approved",
  REVIEW: "Needs your review before anything is paid",
  PLACE_ON_HOLD: "Hold payment until the issues are settled",
  REQUEST_CLARIFICATION: "Ask the supplier to clarify before paying",
  ESCALATE: "Escalate — this needs a senior decision",
  REJECT: "Reject the bill",
};

/** Past-tense decision words for the history list. */
export const DECISION_DONE: Record<string, string> = {
  APPROVE: "Approved",
  REVIEW: "Sent for review",
  PLACE_ON_HOLD: "Put on hold",
  REQUEST_CLARIFICATION: "Asked for clarification",
  ESCALATE: "Escalated",
  REJECT: "Rejected",
};

export const decisionDone = (action?: string | null) =>
  (action && DECISION_DONE[action]) || codeWords(action ?? "Decided");

/** Decision verbs (buttons). REVIEW is not in the shared ACTION_LABEL map. */
export const DECISION_VERB: Record<string, string> = {
  APPROVE: "Approve",
  REVIEW: "Send for review",
  PLACE_ON_HOLD: "Put on hold",
  REQUEST_CLARIFICATION: "Ask supplier to clarify",
  ESCALATE: "Escalate",
  REJECT: "Reject",
};

/** What happens after each decision — said once, accurately. */
export const DECISION_AFTER: Record<string, string> = {
  APPROVE: "The decision and your reason are saved to this check’s history and Satya re-checks the order. Approving does not move money — pay from Payments.",
  REVIEW: "The decision is saved to the history and Satya re-checks the order. Assign an owner or set a reminder under Follow-up.",
  PLACE_ON_HOLD: "The decision is saved to the history and Satya re-checks the order. Keep the bill out of your next payment run until the issues are settled.",
  REQUEST_CLARIFICATION: "The decision is saved to the history. Next, send the supplier a message from Follow-up — Satya tracks the reply and reminds you.",
  ESCALATE: "The decision is saved to the history and Satya re-checks the order. Assign the senior owner under Follow-up.",
  REJECT: "The decision is saved to the history and Satya re-checks the order.",
};
