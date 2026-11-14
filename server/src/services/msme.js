import Document from "../models/Document.js";
import { addDays, daysBetween, todayIst } from "../lib/fy.js";

// MSMED Act 2006 s.15–16 screening (not legal advice):
// * applies to MICRO and SMALL suppliers only (medium enterprises are not
//   "suppliers" under s.2(n));
// * the clock runs from the day of ACCEPTANCE (or deemed acceptance) of the
//   goods — not the invoice date — so the GRN/QC acceptance date is used
//   when the evidence exists, else the invoice date (flagged as such);
// * agreed written terms apply but can never exceed 45 days; with no agreed
//   terms the limit is 15 days.
export const MSME_MAX_DAYS = 45;
export const MSME_DEFAULT_DAYS = 15;

export const msmeCategoryOf = (supplier, invoice) => {
  const cat = supplier?.udyam?.category || invoice?.seller?.udyam?.category || null;
  if (cat) return cat;
  if (supplier?.msme || invoice?.seller?.udyam) return "unknown";
  return null;
};

/** micro/small = covered; unknown category (msme flag only) = covered but flagged. */
export const msmeCovered = (category) => category === "micro" || category === "small" || category === "unknown";

export const agreedDaysFor = (supplier, invoice) => {
  const raw = invoice?.terms?.creditDays ?? supplier?.paymentTermsDays;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? { days: n, basis: "agreed" } : { days: MSME_DEFAULT_DAYS, basis: "no_written_terms" };
};

/**
 * Acceptance date per invoice: QC acceptance (acceptedQty > 0) or GRN
 * receipt for the invoice's GRN refs, else for its PO refs; latest such date
 * not after today. Returns Map invoiceId -> {date, source}.
 */
export const acceptanceDates = async (groupId, invoices) => {
  const grnIds = new Set();
  const poIds = new Set();
  for (const inv of invoices) for (const l of inv.lines || []) {
    if (l.refs?.grnId) grnIds.add(l.refs.grnId);
    if (l.refs?.poId) poIds.add(l.refs.poId);
  }
  const out = new Map();
  if (!grnIds.size && !poIds.size) return out;
  const evidence = await Document.find({
    groupId, type: { $in: ["GRN", "QC"] }, status: { $nin: ["draft", "cancelled", "reversed"] },
    $or: [{ id: { $in: [...grnIds] } }, { "lines.refs.grnId": { $in: [...grnIds] } }, { "lines.refs.poId": { $in: [...poIds] } }],
  }, { id: 1, type: 1, date: 1, lines: 1 }).lean();
  const today = todayIst();
  const accepted = (d) => d.type === "GRN" || (d.lines || []).some((l) => Number(l.acceptedQty ?? l.qty ?? 0) > 0);
  for (const inv of invoices) {
    const myGrns = new Set((inv.lines || []).map((l) => l.refs?.grnId).filter(Boolean));
    const myPos = new Set((inv.lines || []).map((l) => l.refs?.poId).filter(Boolean));
    const relevant = evidence.filter((d) => accepted(d) && d.date <= today && (
      myGrns.has(d.id) || (d.lines || []).some((l) => myGrns.has(l.refs?.grnId)) ||
      (!myGrns.size && (d.lines || []).some((l) => myPos.has(l.refs?.poId)))));
    const qc = relevant.filter((d) => d.type === "QC");
    const pick = (qc.length ? qc : relevant).map((d) => d.date).sort().at(-1);
    if (pick) out.set(inv.id, { date: pick, source: qc.length ? "qc_acceptance" : "grn_receipt" });
  }
  return out;
};

/** Deadline for one invoice. */
export const msmeDeadline = (invoice, supplier, acceptance) => {
  const agreed = agreedDaysFor(supplier, invoice);
  const legalDays = Math.min(agreed.days, MSME_MAX_DAYS);
  const start = acceptance?.date || invoice.date;
  const dueDate = addDays(start, legalDays);
  return {
    agreedDays: agreed.days, termsBasis: agreed.basis, legalDays,
    clockStart: start, clockBasis: acceptance?.source || "invoice_date",
    dueDate, daysLeft: daysBetween(todayIst(), dueDate),
  };
};
