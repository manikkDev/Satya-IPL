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

export type Action = "APPROVE" | "REQUEST_CLARIFICATION" | "ESCALATE" | "PLACE_ON_HOLD" | "REVIEW" | "REJECT";

export const ACTION_LABEL: Record<Action, string> = {
  APPROVE: "Approve",
  REQUEST_CLARIFICATION: "Ask for clarification",
  ESCALATE: "Escalate",
  PLACE_ON_HOLD: "Put on hold",
  REVIEW: "Send for review",
  REJECT: "Reject",
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
  ITC: { label: "GST credit (ITC)", tip: "GST you paid on purchases that you can offset against GST you owe." },
  GSTIN: { label: "GSTIN", tip: "Your 15-character GST registration number. The first two digits are your state code." },
  RULE37: { label: "180-day rule (Rule 37)", tip: "Supplier bills unpaid after 180 days force you to reverse the GST credit, with interest." },
  S43BH: { label: "Section 43B(h)", tip: "Late payments to micro and small suppliers can't be deducted from income tax that year." },
  THREE_WAY: { label: "3-way match", tip: "Checking the order, the goods received and the invoice agree before paying." },
  EINVOICE: { label: "e-invoice", tip: "An invoice registered on the government portal, which gives it an IRN and QR code." },
  UDYAM: { label: "Udyam registration", tip: "Government MSME registration that tells you if a supplier is micro, small or medium." },
  DEBIT_NOTE: { label: "Debit note", tip: "A document reducing what you owe a supplier, e.g. for short or rejected goods." },
  CREDIT_NOTE: { label: "Credit note", tip: "The supplier's document reducing a bill they sent you." },
  RECONCILE: { label: "Check (reconcile)", tip: "Satya lines up the order, receipts, invoices and payments to find what doesn't agree." },
};

/** Workspace roles, in plain words. */
export const ROLE_LABEL: Record<string, { label: string; hint: string }> = {
  group_admin: { label: "Admin", hint: "Full access, manages companies, people and settings." },
  entity_admin: { label: "Company admin", hint: "Manages one company's settings and people." },
  ap_manager: { label: "AP manager", hint: "Approves orders, decides on issues and releases payments." },
  ap_clerk: { label: "AP clerk", hint: "Uploads invoices and imports data." },
  buyer: { label: "Buyer", hint: "Raises purchase orders and uploads documents." },
  stores: { label: "Stores", hint: "Records goods received." },
  quality: { label: "Quality", hint: "Records quality-check results." },
  treasury: { label: "Treasury", hint: "Checks and approves payment releases." },
  auditor: { label: "Auditor", hint: "Read-only access to records and the decision history." },
  requester: { label: "Requester", hint: "Raises purchase requests only." },
  platform_admin: { label: "Platform admin", hint: "Satya staff access." },
};

export const roleLabel = (role: string) => ROLE_LABEL[role]?.label ?? role.replaceAll("_", " ");

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
