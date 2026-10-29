// Vocabulary map (docs/plan/06 §2.2). UI labels must come from here so every
// screen speaks the same plain language. Tooltips stay under ~20 words.

export const BALANCE_TERMS = {
  evidenceSupportedPayable: {
    label: "What you really owe",
    tip: "Delivered and accepted goods at the agreed price, minus payments, advances and credit notes.",
  },
  recordedPayable: {
    label: "What your books show",
    tip: "The unpaid amount in your accounting entries, including any duplicates.",
  },
  disputedExposure: {
    label: "Amount under question",
    tip: "Money tied to possible duplicates, over-billing or unlinked payments.",
  },
  itcAtRisk: {
    label: "GST credit at risk",
    tip: "Input tax credit you may lose or have to reverse if not fixed.",
  },
} as const;

export type BalanceTerm = keyof typeof BALANCE_TERMS;

export type Certainty =
  | "CONFIRMED"
  | "PROBABLE"
  | "POSSIBLE"
  | "AMBIGUOUS"
  | "INSUFFICIENT_EVIDENCE";

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  CONFIRMED: "Confirmed",
  PROBABLE: "Likely",
  POSSIBLE: "Possible",
  AMBIGUOUS: "Unclear — needs your decision",
  INSUFFICIENT_EVIDENCE: "Missing information",
};

export type Action = "APPROVE" | "REQUEST_CLARIFICATION" | "ESCALATE" | "PLACE_ON_HOLD";

export const ACTION_LABEL: Record<Action, string> = {
  APPROVE: "Approve",
  REQUEST_CLARIFICATION: "Ask for clarification",
  ESCALATE: "Escalate",
  PLACE_ON_HOLD: "Put on hold",
};

/** Plain words + official term. First use on a page renders a <Term> tooltip. */
export const TERM_TIPS: Record<string, { label: string; tip: string }> = {
  GRN: { label: "Goods received (GRN)", tip: "Your stores team's record of what physically arrived." },
  QC: { label: "Quality check", tip: "Accepted vs rejected quantity after inspection." },
  PI: { label: "Proforma invoice (PI)", tip: "Supplier's advance bill/quote — not a tax invoice." },
  IRN: { label: "e-invoice number (IRN)", tip: "Unique number given when the invoice is registered on the GST system." },
  UTR: { label: "Bank reference (UTR)", tip: "Unique transfer number from your bank for NEFT/RTGS/IMPS." },
  GSTR2B: { label: "GST purchase statement (GSTR-2B)", tip: "Monthly statement of supplier invoices on the GST portal." },
  IMS: { label: "Invoice inbox (IMS)", tip: "Where you accept or reject supplier invoices before they reach GSTR-2B." },
  HSN: { label: "HSN code", tip: "Standard goods classification that decides the GST rate." },
  MSME: { label: "MSME", tip: "Micro, small or medium enterprise — payment within 45 days is a legal duty." },
  LUT: { label: "Letter of Undertaking (LUT)", tip: "Lets you export without charging IGST, filed per financial year." },
  TDS: { label: "TDS", tip: "Tax deducted at source — a small share of the payment sent to the tax department." },
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  approved: "Approved",
  issued: "Issued",
  acknowledged: "Acknowledged",
  partially_fulfilled: "Partly delivered",
  fulfilled: "Fully delivered",
  short_closed: "Short-closed",
  cancelled: "Cancelled",
  posted: "Posted",
  reversed: "Reversed",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

/** "Finding" → "Issue", "Case" → "Order check", "Snapshot" → "Saved check". */
export const NOUN = {
  finding: "Issue",
  case: "Order check",
  investigation: "Investigation",
  snapshot: "Saved check",
} as const;
