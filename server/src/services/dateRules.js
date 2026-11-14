// Date-sensitive checks evaluated by the server at TODAY's IST date on every
// reconcile (and by the daily re-check), merged with the engine's findings.
// The engine is deterministic over the documents it is given (its Rule 37
// check measures from the latest document date), so deadlines that move
// with the calendar live here:
//   MSME_43BH_DEADLINE   micro/small supplier, unpaid, MSMED s.15 deadline
//                        due within 7 days or passed (43B(h) disallowance)
//   TAX_RULE37_RISK      unpaid 150+ days after invoice date (180-day ITC
//                        reversal under CGST Rule 37) — replaces the engine's
//   TAX_EINVOICE_LATE    IRN obtained > 30 days after the invoice date for a
//                        supplier at AATO >= ₹10 cr (30-day reporting limit)
//   TAX_NOT_IN_GSTR2B /  from the GSTR-2B match status on the invoice
//   TAX_GSTR2B_MISMATCH
// Screening only — not tax or legal advice.
import Supplier from "../models/Supplier.js";
import { settledPaiseFor } from "./settlement.js";
import { acceptanceDates, msmeCategoryOf, msmeDeadline } from "./msme.js";
import { daysBetween, todayIst, istDate } from "../lib/fy.js";
import { toPaise, fromPaise, grandOf, taxOf } from "../lib/money.js";

export const RULE_VERSION = "server-date-rules/1";
// engine codes the server re-evaluates (engine output for these is replaced)
export const SERVER_OWNED_CODES = new Set(["TAX_RULE37_RISK"]);
const GSTR2B_SETTLED = new Set(["matched", "amount_differs", "pending_2b", "before_2b_import"]);

const finding = (code, severity, certainty, title, message, documentId, amount = null, extra = {}) => ({
  code, severity, certainty, title, message, evidence: [{ documentId }], amount, ruleVersion: RULE_VERSION, source: "server", ...extra,
});

/** Pure rule evaluation over prepared inputs (unit-testable). */
export const evaluateDateRules = ({ invoices, suppliersById, settled, acceptance, today }) => {
  const out = [];
  for (const inv of invoices) {
    const sup = suppliersById.get(inv.supplierId || inv.seller?.supplierId) || null;
    const grand = toPaise(grandOf(inv));
    const paid = settled.get(inv.id) || 0n;
    const outstanding = grand - paid;
    const label = inv.number || inv.id;
    if (outstanding > 0n) {
      const cat = msmeCategoryOf(sup, inv);
      if (cat === "micro" || cat === "small") {
        const dl = msmeDeadline(inv, sup, acceptance.get(inv.id));
        const left = daysBetween(today, dl.dueDate);
        if (left <= 7) {
          out.push(finding("MSME_43BH_DEADLINE", left < 0 ? "high" : "medium", "PROBABLE",
            left < 0 ? "MSME payment overdue" : "MSME payment due soon",
            left < 0
              ? `Invoice ${label} to a ${cat} enterprise is ${-left} day(s) past its MSMED s.15 deadline (${dl.dueDate}); ₹${fromPaise(outstanding)} unpaid. Interest at 3× bank rate accrues, and under s.43B(h) the expense is disallowed if still unpaid at year end.`
              : `Invoice ${label} to a ${cat} enterprise must be paid by ${dl.dueDate} (${left} day(s) left, ${dl.legalDays}-day limit from ${dl.clockBasis === "invoice_date" ? "invoice date" : "acceptance"}); ₹${fromPaise(outstanding)} unpaid.`,
            inv.id, fromPaise(outstanding), { dueDate: dl.dueDate, daysLeft: left }));
        }
      }
      const age = daysBetween(inv.date, today);
      const itc = toPaise(taxOf(inv));
      if (age >= 150 && itc > 0n) {
        const left = 180 - age;
        out.push(finding("TAX_RULE37_RISK", left < 0 ? "high" : "medium", "POSSIBLE",
          left < 0 ? "ITC reversal due (Rule 37)" : "ITC reversal approaching (Rule 37)",
          left < 0
            ? `Invoice ${label} is unpaid ${age} days after its date — ITC of ₹${fromPaise(itc)} must be reversed under CGST Rule 37 (re-claimable on payment).`
            : `Invoice ${label} reaches 180 days unpaid in ${left} day(s) — pay it or reverse ITC of ₹${fromPaise(itc)} (CGST Rule 37).`,
          inv.id, fromPaise(itc), { daysLeft: left }));
      }
    }
    const irnAck = inv.gst?.ackDate;
    const big = sup?.aatoBand === ">=10cr";
    if (inv.gst?.irn && irnAck && big) {
      let ackDay = null;
      try { ackDay = istDate(irnAck); } catch { ackDay = null; }
      const lag = ackDay ? daysBetween(inv.date, ackDay) : null;
      if (lag !== null && lag > 30) {
        out.push(finding("TAX_EINVOICE_LATE", "high", "POSSIBLE", "E-invoice reported late",
          `IRN for invoice ${label} was generated ${lag} days after the invoice date; suppliers with AATO ≥ ₹10 cr must report within 30 days, so the invoice may not be a valid e-invoice for ITC.`, inv.id));
      }
    }
    const g = inv.gst?.gstr2b;
    if (g?.status === "only_in_books") {
      out.push(finding("TAX_NOT_IN_GSTR2B", "medium", "PROBABLE", "Invoice missing from GSTR-2B",
        `Invoice ${label} is not in the supplier's GSTR-2B for the imported periods — ITC of ₹${fromPaise(toPaise(taxOf(inv)))} is at risk until the supplier files it.`, inv.id, fromPaise(toPaise(taxOf(inv)))));
    } else if (g?.status === "amount_differs") {
      out.push(finding("TAX_GSTR2B_MISMATCH", "medium", "PROBABLE", "GSTR-2B value differs from books",
        `GSTR-2B reports invoice ${label} with tax differing by ₹${g.diff?.tax ?? "?"} and value by ₹${g.diff?.value ?? "?"} — claim ITC only on the lower figure or get the supplier to amend.`, inv.id, g.diff?.tax ?? null));
    }
  }
  return out;
};

/** Load inputs for a case's documents and evaluate. */
export const supplementalFindings = async ({ groupId, documents, today = todayIst() }) => {
  const invoices = documents.filter((d) => d.type === "INVOICE_IN" && !["cancelled", "reversed", "draft"].includes(d.status));
  if (!invoices.length) return [];
  const supIds = [...new Set(invoices.map((d) => d.supplierId || d.seller?.supplierId).filter(Boolean))];
  const [suppliers, settled, acceptance] = await Promise.all([
    supIds.length ? Supplier.find({ groupId, id: { $in: supIds } }, { id: 1, legalName: 1, udyam: 1, msme: 1, paymentTermsDays: 1, aatoBand: 1, einvoiceApplicable: 1 }).lean() : [],
    settledPaiseFor(groupId, invoices.map((d) => d.id)),
    acceptanceDates(groupId, invoices),
  ]);
  return evaluateDateRules({ invoices, suppliersById: new Map(suppliers.map((s) => [s.id, s])), settled, acceptance, today });
};

/**
 * Merge engine + server findings: server-owned codes replace the engine's;
 * the engine's TAX_NOT_IN_GSTR2B is dropped for invoices whose 2B status the
 * server has settled (matched / differs / not yet due).
 */
export const mergeFindings = (engineFindings, serverFindings, documents) => {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const kept = (engineFindings || []).filter((f) => {
    if (SERVER_OWNED_CODES.has(f.code)) return false;
    if (f.code === "TAX_NOT_IN_GSTR2B") {
      const docId = f.evidence?.[0]?.documentId;
      const st = byId.get(docId)?.gst?.gstr2b?.status;
      if (st && (GSTR2B_SETTLED.has(st) || st === "only_in_books")) return false; // server emits its own for only_in_books
    }
    return true;
  });
  return [...kept, ...serverFindings];
};
