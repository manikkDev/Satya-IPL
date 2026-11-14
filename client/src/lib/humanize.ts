// Plain-language helpers shared by every page (docs/design/UI_SPEC.md §1.6):
// plural-safe counts ("1 day", "3 days"), finding codes → one plain sentence,
// relative due text, and a sanitizer that cleans engine messages before they
// reach a person ("₹₹", "day(s)", raw decimals, ISO dates, internal doc_* ids).
// Pure functions, no React — safe in tests (node --test) and on the server.

import { formatMoney, formatDate } from "./format.ts";

/* ---------------- counts & days ---------------- */

/** "1 bill", "3 bills", "1 entry"/"2 entries" (pass the plural when irregular). */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const n = Math.abs(Math.trunc(count));
  return `${count < 0 ? "-" : ""}${n.toLocaleString("en-IN")} ${n === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

/** Plural-safe day count: dayText(1) → "1 day", dayText(-3) → "3 days". */
export function dayText(days: number): string {
  return plural(Math.abs(Math.trunc(days)), "day");
}

/** Relative wording for a deadline, from whole days left (negative = past).
 *  -3 → "3 days overdue", 0 → "due today", 1 → "due tomorrow", 5 → "due in 5 days". */
export function relativeDue(daysLeft: number): string {
  if (daysLeft < 0) return `${dayText(daysLeft)} overdue`;
  if (daysLeft === 0) return "due today";
  if (daysLeft === 1) return "due tomorrow";
  return `due in ${dayText(daysLeft)}`;
}

/** Visual urgency for a deadline: overdue → critical, ≤ 7 days → warn. */
export function dueTone(daysLeft: number | null | undefined): "critical" | "warn" | "neutral" {
  if (daysLeft === null || daysLeft === undefined) return "neutral";
  if (daysLeft < 0) return "critical";
  if (daysLeft <= 7) return "warn";
  return "neutral";
}

/** Short relative time for activity feeds: "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", else a date. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const minutes = Math.round((now.getTime() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

/* ---------------- finding codes ---------------- */

export type FindingPlain = {
  /** Short noun phrase for chips and lists: "Possible duplicate bill". */
  title: string;
  /** One plain sentence a non-accountant understands. */
  sentence: string;
};

/** Every engine finding code Satya raises, in plain words. Unknown codes fall
 *  back to their family (DUP*, TAX_*, PAY_*, QTY_*, SCREEN_* …) via findingPlain(). */
export const FINDING_PLAIN: Record<string, FindingPlain> = {
  // duplicates
  DUP_EXACT_INVOICE: { title: "Duplicate bill", sentence: "The same bill was recorded twice with identical totals — pay it only once." },
  DUP_NEAR_INVOICE: { title: "Possible duplicate bill", sentence: "Two bills from this supplier look almost the same — check it isn’t billed twice." },
  DUPLICATE_INVOICE_SUSPECT: { title: "Possible duplicate bill", sentence: "This bill number appears more than once — confirm whether it is one bill or a revised one." },
  DUPLICATE_NUMBER: { title: "Repeated bill number", sentence: "The supplier used this bill number before — confirm it is a new bill." },
  DUP_CROSS_ENTITY: { title: "Billed to two companies", sentence: "The same bill was recorded in two of your companies — only one should pay it." },
  DUP_PAYMENT: { title: "Possible double payment", sentence: "Two payments look the same — check the supplier wasn’t paid twice." },
  DUP_REPEATED_OBSERVATION: { title: "Same document uploaded twice", sentence: "This document was uploaded more than once — the copies were merged." },
  DUP_ADVANCE_NOT_ADJUSTED: { title: "Advance not adjusted", sentence: "An advance paid to this supplier hasn’t been set off against their bills yet." },
  // quantity & delivery
  INVOICE_QTY_EXCEEDS_RECEIVED: { title: "Billed for more than received", sentence: "The supplier billed for more units than your stores recorded as received." },
  QTY_INVOICED_EXCEEDS_ACCEPTED: { title: "Billed for more than accepted", sentence: "The supplier billed for more units than passed your quality check." },
  QTY_OVER_DELIVERY: { title: "More delivered than ordered", sentence: "More units arrived than the order asked for." },
  QTY_CHALLAN_VS_GRN: { title: "Delivery note and receipt differ", sentence: "The supplier’s delivery note and your goods receipt show different quantities." },
  QTY_UOM_UNKNOWN_CONVERSION: { title: "Units don’t match", sentence: "The bill and the order use different units, so quantities can’t be compared yet." },
  DELIVERY_SHORTFALL: { title: "Short delivery", sentence: "Fewer units have arrived than were ordered." },
  RECEIPT_EVIDENCE_MISSING: { title: "Billed without a receipt", sentence: "There is a bill but no record that the goods arrived." },
  BILLED_ABOVE_ACCEPTED: { title: "Billed above accepted value", sentence: "The bill is higher than the value of goods you accepted." },
  BILLED_ABOVE_RECEIVED: { title: "Billed above received value", sentence: "The bill is higher than the value of goods you received." },
  // price
  PRICE_VARIANCE: { title: "Price differs from the order", sentence: "The rate on the bill is different from the rate agreed on the order." },
  PRICE_UNAUTHORISED_CHARGES: { title: "Extra charges on the bill", sentence: "The bill adds charges (freight, packing…) the order didn’t allow." },
  // documents
  DOC_MISSING_INVOICE: { title: "Goods received, no bill yet", sentence: "Goods arrived but the supplier’s bill hasn’t been recorded." },
  DOC_CREDIT_NOTE_PENDING: { title: "Credit note pending", sentence: "A credit note is expected from the supplier but hasn’t arrived." },
  INVOICE_NO_PO_LINK: { title: "Bill without an order", sentence: "This bill isn’t linked to any purchase order." },
  INVOICE_NUMBER_FORMAT: { title: "Unusual bill number", sentence: "The bill number doesn’t follow GST numbering rules." },
  CURRENCY_CONFLICT: { title: "Currency mismatch", sentence: "The order and the bill are in different currencies." },
  PAYMENT_REFERENCE_CONFLICT: { title: "Conflicting bank reference", sentence: "Two payments carry the same bank reference (UTR)." },
  PAYMENT_SOURCE_CONFLICT: { title: "Payment records disagree", sentence: "The bank statement and your books show this payment differently." },
  // payments
  PAY_UNALLOCATED: { title: "Payment not matched to a bill", sentence: "Money left your bank but isn’t linked to any bill yet." },
  PAY_SPLIT: { title: "Bill paid in parts", sentence: "This bill was settled by more than one payment." },
  PAY_COMBINED: { title: "One payment for several bills", sentence: "A single payment covers several bills." },
  PAY_OVERPAYMENT: { title: "Paid more than the bill", sentence: "More was paid than the bill amount." },
  PAY_BEFORE_RECEIPT: { title: "Paid before delivery", sentence: "The supplier was paid before the goods were received." },
  PAY_BANK_ACCOUNT_CHANGED: { title: "Paid to a changed bank account", sentence: "The payment went to a bank account that changed recently — confirm it with the supplier by phone." },
  // tax & GST
  TAX_GSTIN_INVALID: { title: "Supplier GSTIN looks wrong", sentence: "The supplier’s GST number fails validation, so the GST credit may not be allowed." },
  GSTIN_INVALID: { title: "GSTIN looks wrong", sentence: "This GST number fails validation." },
  GSTIN_STATE_MISMATCH: { title: "GSTIN state mismatch", sentence: "The GST number’s state code doesn’t match the address." },
  TAX_TYPE_MISMATCH: { title: "Wrong type of GST", sentence: "The bill charges IGST where CGST + SGST applies (or the other way round)." },
  TAX_SUPPLY_TYPE_MISMATCH: { title: "Wrong type of GST", sentence: "The kind of GST charged doesn’t match where the goods were supplied." },
  TAX_ARITHMETIC: { title: "Tax doesn’t add up", sentence: "The GST on the bill doesn’t match the rate × the value." },
  TAX_ROUNDING_UNEXPLAINED: { title: "Unexplained rounding", sentence: "The bill total differs from the line totals by more than rounding." },
  TAX_RATE_MISMATCH: { title: "GST rate differs", sentence: "The GST rate on the bill differs from the usual rate for this item." },
  TAX_CGST_SGST_UNEQUAL: { title: "CGST and SGST differ", sentence: "CGST and SGST should be equal, but they aren’t on this bill." },
  TAX_ZERO_SUSPECT: { title: "No GST charged", sentence: "This bill charges no GST where GST is usually due." },
  TAX_QR_MISMATCH: { title: "QR code doesn’t match", sentence: "The e-invoice QR code doesn’t match the bill details." },
  TAX_EWAYBILL_MISSING: { title: "E-way bill missing", sentence: "Goods worth over ₹50,000 moved without a recorded e-way bill." },
  TAX_EINVOICE_MISSING: { title: "e-invoice number missing", sentence: "This supplier must issue e-invoices, but the bill has no IRN — the GST credit is at risk." },
  TAX_EINVOICE_LATE: { title: "e-invoice registered late", sentence: "The bill was registered on the e-invoice portal after the allowed window." },
  TAX_NOT_IN_GSTR2B: { title: "Not in GSTR-2B", sentence: "The supplier hasn’t reported this bill in their GST return, so you can’t claim the credit yet." },
  TAX_GSTR2B_MISMATCH: { title: "GSTR-2B amount differs", sentence: "The amount the supplier reported to GST differs from the bill." },
  TAX_IMS_REJECTED: { title: "Rejected in the invoice inbox", sentence: "This bill was rejected in the GST invoice inbox (IMS)." },
  TAX_IMS_REJECTED_BUT_PAID: { title: "Rejected but paid", sentence: "This bill was rejected in the GST invoice inbox but has been paid." },
  TAX_RULE37_RISK: { title: "180-day GST credit risk", sentence: "Unpaid for almost 180 days — pay it or the GST credit must be reversed with interest." },
  TAX_LUT_MISSING: { title: "No valid LUT", sentence: "An export was billed without IGST but no Letter of Undertaking covers it." },
  LUT_MISSING_OR_INVALID: { title: "No valid LUT", sentence: "An export was billed without IGST but no Letter of Undertaking covers it." },
  HSN_NOT_IN_MASTER: { title: "Unknown HSN code", sentence: "The item’s HSN code isn’t in the official list." },
  HSN_DIGITS_INSUFFICIENT: { title: "HSN code too short", sentence: "The HSN code has fewer digits than the law requires for your turnover." },
  // MSME
  MSME_43BH_DEADLINE: { title: "MSME 45-day deadline", sentence: "A micro or small supplier must be paid within 45 days — after that, interest runs and the expense can’t be deducted this year." },
  // screening signals (patterns, never proof)
  SCREEN_PRICE_OUTLIER: { title: "Unusual price", sentence: "This price is unusual for this item — worth a second look." },
  SCREEN_BELOW_APPROVAL_LIMIT: { title: "Just under an approval limit", sentence: "The amount sits just below an approval limit — worth a second look." },
  SCREEN_BENFORD_FIRST_DIGIT: { title: "Unusual amount pattern", sentence: "This supplier’s amounts follow an unusual pattern — worth a second look." },
  SCREEN_NEW_BANK_ACCOUNT_PAYMENT: { title: "First payment to a new account", sentence: "This is the first payment to a newly added bank account — confirm it with the supplier." },
};

const FAMILY: [RegExp, FindingPlain][] = [
  [/^(DUP|DUPLICATE)/, { title: "Possible duplicate", sentence: "Something here looks recorded twice — check before paying." }],
  [/^(QTY|INVOICE_QTY|BILLED_ABOVE)/, { title: "Quantity doesn’t match", sentence: "The quantities on the order, receipt and bill don’t agree." }],
  [/^DELIVERY/, { title: "Delivery issue", sentence: "The delivery doesn’t match the order." }],
  [/^PRICE/, { title: "Price issue", sentence: "The price on the bill doesn’t match what was agreed." }],
  [/^PAY/, { title: "Payment issue", sentence: "Something about this payment needs a check." }],
  [/^(TAX|GSTIN|HSN)/, { title: "GST issue", sentence: "Something about the GST on this bill needs a check." }],
  [/^MSME/, { title: "MSME deadline", sentence: "A micro or small supplier’s 45-day payment limit is involved." }],
  [/^SCREEN/, { title: "Screening signal", sentence: "An unusual pattern worth a second look — not proof of a problem." }],
  [/^(DOC|INVOICE|RECEIPT)/, { title: "Missing document", sentence: "A document Satya expected hasn’t been recorded." }],
];

/** Plain title + sentence for any finding code (never returns the raw code). */
export function findingPlain(code: string | null | undefined): FindingPlain {
  const key = String(code ?? "").toUpperCase();
  if (FINDING_PLAIN[key]) return FINDING_PLAIN[key];
  for (const [re, plain] of FAMILY) if (re.test(key)) return plain;
  return { title: "Issue to review", sentence: "Satya found something that needs a person to check." };
}

export const findingTitle = (code: string | null | undefined) => findingPlain(code).title;
export const findingSentence = (code: string | null | undefined) => findingPlain(code).sentence;

/* ---------------- engine text sanitizer ---------------- */

export type DocNames = Map<string, string> | Record<string, string>;

const DOC_ID = /\bdoc_[A-Za-z0-9_]+/g;
const lookup = (names: DocNames | undefined, id: string) =>
  !names ? undefined : names instanceof Map ? names.get(id) : names[id];

/** doc_bpi_po_12 → "PO-12" (seed ids carry type + number); otherwise null. */
function docIdFallback(id: string): string | null {
  const m = id.match(/^doc_bpi_([a-z]+)_(\d+)(?:_\d+)?$/);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

/** Cleans engine/finding text for people:
 *  - "₹₹1,000" → "₹1,000";  "44 day(s)" → "44 days" (and any "word(s)")
 *  - "₹88736.00" / bare "12000.00" → "₹88,736.00" / "₹12,000.00" (Indian grouping)
 *  - ISO dates "2026-10-01" → "1 Oct 2026"
 *  - internal ids "doc_…" → the document number when `docNames` has it,
 *    otherwise dropped ("PO doc_x line 1" → "PO line 1"; a lone id → "this document")
 *  - "invoiced 16 exceeds delivered 8" → "invoiced 16 units, only 8 delivered" */
export function sanitizeEngineText(text: string | null | undefined, docNames?: DocNames): string {
  if (!text) return "";
  let out = String(text);

  out = out.replace(/(?:₹\s*){2,}/g, "₹");
  out = out.replace(/\b(\d+)\s+([A-Za-z]+)\(s\)/g, (_m, n: string, word: string) => (Number(n) === 1 ? `${n} ${word}` : `${n} ${word}s`));
  out = out.replace(/\b([A-Za-z]+)\(s\)/g, "$1s");

  out = out.replace(DOC_ID, (id, offset: number, whole: string) => {
    const known = lookup(docNames, id) ?? docIdFallback(id);
    if (known) return known;
    const before = whole.slice(Math.max(0, offset - 12), offset);
    return /\b(PO|Invoice|Payment|GRN|QC|Order|Bill|Receipt|Credit note|Debit note)\s$/i.test(before) ? "\u0000" : "this document";
  });
  out = out.replace(/\s\u0000/g, "").replace(/\u0000/g, "");

  out = out.replace(/invoiced (\d+(?:\.\d+)?) exceeds delivered (\d+(?:\.\d+)?)/gi, (_m, a: string, b: string) => `invoiced ${a} units, only ${b} delivered`);
  out = out.replace(/invoiced (\d+(?:\.\d+)?) exceeds QC-accepted (\d+(?:\.\d+)?)/gi, (_m, a: string, b: string) => `invoiced ${a} units, only ${b} passed quality check`);
  out = out.replace(/grand (?=₹|\d)/g, "total ");
  out = out.replace(/(\d+(?:\.\d+)?) units delivered, none invoiced/gi, (_m, n: string) => `${n} units delivered, no bill yet`);

  // money: ₹-prefixed amounts (any size, optional existing grouping) …
  out = out.replace(/₹\s?(-?\d[\d,]*(?:\.\d+)?)(?![\d%])/g, (_m, n: string) => formatMoney(n.replaceAll(",", "")));
  // … and bare 2-decimal amounts of ₹100+ that aren't percentages or part of a date/id
  out = out.replace(/(^|[\s(:=])(\d{3,}\.\d{2})(?![\d%.\w])/g, (_m, lead: string, n: string) => `${lead}${formatMoney(n)}`);

  out = out.replace(/\b(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z?)?\b/g, (_m, d: string) => formatDate(d));
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Indian-grouped rupees for prose: humanMoney("720000") → "₹7,20,000.00". */
export const humanMoney = (value: string | number | null | undefined) => formatMoney(value ?? null);
