// compose.js — evidence-mode answers (no language model). Used when quota is
// exhausted, when a model answer fails grounding twice, and as the offline
// eval baseline. Same answer style as the model: a bold one-line answer,
// then "Why" bullets with [S#] citations, then the evidence line. Every
// figure is copied from a tool result (and sums go through exact.js).

import { inr, sumMoney as exactSum, parseExact } from "./exact.js";
import { findingText } from "./tools/read.js";

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const cite = (ref) => (ref ? ` [${ref}]` : "");
const bullets = (lines) => lines.filter(Boolean).map((l) => `- ${l}`).join("\n");
const nonZero = (v) => (parseExact(v) ?? 0n) !== 0n;
const dateText = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return ymd || "";
  return `${Number(m[3])} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1]}`;
};

/**
 * @param {string} intent
 * @param {object} o
 * @param {Record<string, any>} o.data last data per tool name
 * @param {string[]} o.missing
 * @param {object} o.sources SourceRegistry
 * @param {object} [o.route] router output
 * @returns {{markdown:string, followUps:string[], answerType:string}}
 */
export function composeEvidenceAnswer(intent, { data = {}, missing = [], sources, route = {}, message = "", bank = null }) {
  // exact sums the composer derives are registered like calculator results
  const sumMoney = (values) => {
    const v = exactSum(values);
    bank?.addDerived(v, { op: "sum", inputs: values.map((x) => String(x ?? "0")) });
    return v;
  };
  const count = (items, idOf = (x) => x?.documentId || x?.id) => {
    bank?.addDerived(items.length, { op: "count", items: items.map(idOf).filter(Boolean) });
    return items.length;
  };
  void message;
  const head = (line) => `**${line}**`;
  const why = (lines) => (lines.filter(Boolean).length ? `\n\n**Why**\n\n${bullets(lines)}` : "");
  const evidence = () => {
    const refs = sources?.refs?.().slice(0, 6) || [];
    return refs.length ? `\n\n_Evidence:_ ${refs.map((r) => `[${r}]`).join(" ")}` : "";
  };
  const gap = missing.length ? `\n\n_I couldn't get: ${[...new Set(missing)].join("; ")} — I won't guess those._` : "";
  const out = (markdown, followUps = [], answerType = "answer") => ({ markdown: `${markdown}${gap}`, followUps: followUps.slice(0, 3), answerType });

  switch (intent) {
    case "smalltalk":
      return out("**Hello — I'm Satya.** Ask me what's due, what we owe a supplier, MSME deadlines, GST credit at risk, or ask me to draft a supplier message or a payment run.", ["What needs my attention today?", "What is due this week?", "Which MSME payments are close to 45 days?"]);
    case "out_of_scope":
      if (route.reason === "needs data Satya doesn't hold") {
        return out("**I don't know — Satya doesn't hold your bank balance or forecasts, so I won't guess.** I can tell you what is due and when, which is the cash going out: try \"What is due this week?\" or \"How much cash do we need this month?\"", ["What is due this week?", "What should we pay first?"], "refusal");
      }
      return out(`**I can't help with that.** ${route.reason === "instruction override attempt" ? "I follow Satya's rules and only work from your own records." : route.reason === "outside your workspace" ? "I can only see your own workspace's records — never another company's." : "I answer questions about your purchase orders, receipts, invoices, payments, suppliers and GST/MSME compliance."} For tax or legal positions, please check with your CA.`, ["What needs my attention today?", "Which suppliers do we owe the most?"], "refusal");
    case "general":
      return out("**I need a little more to go on.** Tell me the supplier, document number or period you mean — for example \"How much do we owe Kaveri Pumps?\", \"What's due this week?\" or \"Status of PO SATYAD/PO/26-27/100009\".", ["What needs my attention today?", "What is due this week?", "Which suppliers do we owe the most?"], "clarification");
    default:
      break;
  }

  const sup = data.get_supplier_summary;
  const pay = data.list_payables;
  const msme = data.msme_payments_due;
  const itc = data.gst_itc_at_risk;
  const g2b = data.gstr2b_mismatches;
  const fnd = data.list_findings;
  const dash = data.dashboard_today;
  const kase = data.get_case;
  const doc = data.get_document;
  const pays = data.payment_history;
  const calc = data.calculate;
  const cmp = data.compare_periods;
  const spend = data.spend_by_period;
  const expo = data.supplier_exposure;
  const help = data.search_help;
  const hsn = data.hsn_lookup;
  const run = data.propose_payment_run;
  const draft = data.draft_supplier_message;
  const ims = data.propose_ims_actions;
  const decision = data.propose_decision;
  const alloc = data.propose_allocation;
  const assign = data.propose_assignment;
  const remind = data.propose_reminder;
  const explain = data.explain_finding;

  // proposals first: the card is the answer
  if (run) {
    return out(`${head(run.count ? `Pay ${plural(run.count, "invoice")} now for ${inr(run.total)}${run.budget ? ` out of your ${inr(run.budget)}` : ""}.` : "Nothing can be paid from this run yet.")}${why([
      run.count ? `Ranked by MSME 45-day deadline first, then s.43B(h) year-end risk, then days overdue.` : null,
      nonZero(run.heldBack) ? `${inr(run.heldBack)} is held back because it is disputed (open issues on those invoices).` : null,
      run.budget ? `${inr(run.remaining)} of the budget is left after this run.` : "No budget was given, so this covers everything overdue or due within the week.",
      run.excludedCount ? `${plural(run.excludedCount, "invoice")} left out — see the card for why.` : null,
    ])}\n\nReview the run below and save it for approval — I don't make payments.${evidence()}`, ["Draft a remittance advice for the first supplier", "Which of these are MSME suppliers?", "Show the disputed invoices"], "proposal");
  }
  if (draft) {
    return out(`${head(`Here's ${draft.language === "hi" ? "a Hindi " : draft.channel === "whatsapp" ? "a " : "an "}${draft.channel === "whatsapp" ? "WhatsApp message" : "email"} draft for ${draft.supplier}.`)}${why([
      draft.issues.length ? `It lists ${plural(draft.issues.length, "open issue")} on their documents: ${[...new Set(draft.issues.map((i) => i.meaning))].slice(0, 3).join("; ")}.` : `It covers ${plural(draft.invoices.length, "open invoice")}.`,
      draft.hasRecipient ? "The recipient is taken from the supplier master." : "There is no contact on file — add one in the card before sending.",
      "Nothing is sent until you confirm; you can edit every word first.",
    ])}${evidence()}`, [`How much do we owe ${draft.supplier}?`, "Translate it to Hindi", "Make it a WhatsApp message"], "proposal");
  }
  if (ims) {
    return out(`${head(ims.estimated ? `There is no GSTR-2B imported for ${ims.period}, so I can't suggest IMS actions yet.` : `${plural(ims.decisions.length, "GSTR-2B row")} need a decision for ${ims.period}; ${ims.matched} matched row(s) can be accepted.`)}${why([
      ims.estimated ? "IMS actions apply to supplier-filed 2B rows; import the 2B JSON under Compliance first." : null,
      ims.suspectedMissingIn2B?.length ? `${plural(ims.suspectedMissingIn2B.length, "invoice")} in your books are not in 2B — ITC at risk ${inr(ims.itcAtRisk)}.` : null,
      ...ims.decisions.slice(0, 4).map((d) => `${d.invoice} (${d.supplier}): **${d.action}** — ${d.reason}${cite(d.ref)}`),
    ])}${evidence()}`, ["Which invoices are missing from GSTR-2B?", "What is our ITC at risk?"], "proposal");
  }
  if (decision) {
    const ACTION = { APPROVE: "approve", PLACE_ON_HOLD: "put it on hold", REQUEST_CLARIFICATION: "ask the supplier to clarify", ESCALATE: "escalate" };
    return out(`${head(`I recommend you ${ACTION[decision.recommended]}.`)}${why([
      `Basis: ${decision.reason}.`,
      decision.requested && decision.requested !== decision.recommended ? `You asked to ${ACTION[decision.requested]} — the card shows that, with a warning.` : null,
      "Confirming records the decision on the case; it does not pay or notify anyone.",
    ])}${evidence()}`, ["Draft a dispute email to this supplier", "Assign this case to a colleague", "Set a follow-up reminder"], "proposal");
  }
  if (alloc) {
    return out(`${head(alloc.allocations.length ? `Payment ${alloc.payment.utr || alloc.payment.id} matches ${plural(alloc.allocations.length, "document")}.` : `No exact match for payment ${alloc.payment.utr || alloc.payment.id}.`)}${why([
      `${inr(alloc.payment.remaining)} of it is not yet matched.`,
      alloc.solutions > 1 ? `${alloc.solutions} exact combinations exist — check the remittance advice before confirming.` : alloc.solutions === 1 ? "This is the only exact combination of open invoices." : "Allocate it manually from the Payments page, or ask the supplier for remittance details.",
    ])}${evidence()}`, ["Draft a remittance advice to this supplier", "Which payments are unallocated?"], "proposal");
  }
  if (assign) return out(`${head(assign.assignee ? `Assign it to ${assign.assignee} (${assign.priority} priority).` : "I couldn't find a colleague to assign this to.")}${evidence()}`, ["Set a follow-up reminder"], "proposal");
  if (remind) return out(`${head(`Set a follow-up for ${dateText(remind.dueDate)}.`)}${evidence()}`, ["What is open on this case?"], "proposal");

  const att = data.read_attachment;
  if (intent === "attachment_review" && att) {
    const checks = [...(data.match_attachment?.checks || []), ...(data.check_attachment_gst?.checks || [])];
    const failed = checks.filter((c) => c.status === "fail");
    const review = checks.filter((c) => c.status === "warn");
    const what = att.typeLabel || "document";
    const id = `${what}${att.number ? ` ${att.number}` : ""}`;
    const verdict = failed.length
      ? `Don't pay this ${what} yet — ${plural(count(failed), "check")} failed.`
      : review.length
        ? `This ${what} needs a quick look before you pay — ${plural(count(review), "check")} to review.`
        : checks.length
          ? `No problems found in this ${what} — all ${count(checks)} checks passed.`
          : `I read this ${what} but couldn't check it against your books.`;
    const mark = { pass: "✓", warn: "Review —", fail: "Problem —" };
    const ordered = [...failed, ...review, ...checks.filter((c) => c.status === "pass")];
    const stated = [att.date ? `dated ${dateText(att.date)}` : null, att.totals?.grand ? `for ${inr(att.totals.grand)}` : null].filter(Boolean).join(" ");
    return out(`${head(verdict)}\n\nThe attached ${id}${stated ? ` is ${stated}` : ""}${cite(att.ref)}.${checks.length ? `\n\n**Checks**\n\n${bullets(ordered.slice(0, 9).map((c) => `${mark[c.status] || ""} **${c.label}:** ${c.detail}${cite(c.ref)}`))}` : ""}${att.extraction?.needsReview?.length ? `\n\n_Some fields were hard to read (${att.extraction.needsReview.slice(0, 4).join(", ")}) — check them against the paper copy._` : ""}\n\n_${att.inBooks ? "This document is already posted in your books." : "Read from your attachment and saved as a draft in Imports — it is not in your books until you confirm it there."} GST points are screening, not tax advice._${evidence()}`,
    failed.length || review.length
      ? ["Draft a query to the supplier about this invoice", "Show the purchase order it quotes", "What else is open with this supplier?"]
      : ["What else is open with this supplier?", "Plan payments for this week"]);
  }

  switch (intent) {
    case "briefing": {
      const lines = [];
      if (pay) lines.push(`**${inr(pay.totals.overdue)}** is overdue across ${plural(pay.totals.overdueCount, "invoice")}; another **${inr(pay.totals.dueThisWeek)}** falls due this week.`);
      if (msme && msme.totals.overdueCount) lines.push(`${plural(msme.totals.overdueCount, "MSME invoice")} (${inr(msme.totals.overdueAmount)}) are past the legal deadline — interest is accruing (est. ${inr(msme.totals.interestEstimate)}).`);
      if (pay && nonZero(pay.totals.disputed)) lines.push(`${inr(pay.totals.disputed)} of that is disputed — hold it back until the issues are cleared.`);
      if (dash && nonZero(dash.itcAtRisk)) lines.push(`${inr(dash.itcAtRisk)} of GST credit sits on invoices with open issues.`);
      if (fnd?.items?.length) lines.push(`Top issue: ${fnd.items[0].meaning} (${fnd.items[0].severity})${fnd.items[0].exposure ? ` — ${inr(fnd.items[0].exposure)}` : ""}${cite(fnd.items[0].ref)}.`);
      const cash = pay ? sumMoney([pay.totals.overdue, pay.totals.dueThisWeek]) : null;
      return out(`${head(cash ? `You need about ${inr(cash)} to clear what's overdue and due this week.` : "Here's today's position.")}${why(lines)}${evidence()}`, ["What should we pay first?", "Which MSME payments are past 45 days?", "Show the critical issues"]);
    }
    case "payables_due":
    case "ageing": {
      if (!pay) break;
      const t = pay.totals;
      const top = pay.rows.slice(0, 3).map((r) => `${r.invoice} — ${r.supplier}: ${inr(r.outstanding)}${r.overdueDays ? `, ${r.overdueDays} days overdue` : `, due ${dateText(r.dueDate)}`}${r.msme ? " (MSME)" : ""}${cite(r.ref)}`);
      if (intent === "ageing") {
        const a = pay.ageing;
        return out(`${head(`${inr(t.outstanding)} is outstanding; ${inr(t.overdue)} of it is overdue.`)}${why([
          `Not yet due: ${inr(a.notDue)}`, `1–30 days overdue: ${inr(a["0-30"])}`, `31–60 days: ${inr(a["31-60"])}`, `61–90 days: ${inr(a["61-90"])}`, `Over 90 days: ${inr(a["90+"])}`,
          nonZero(t.disputed) ? `${inr(t.disputed)} of the total is disputed.` : null,
        ])}${evidence()}`, ["What should we pay first?", "Which suppliers do we owe the most?"]);
      }
      const label = pay.status === "overdue" ? "overdue" : pay.status === "due_by" ? "overdue or due soon" : "open";
      return out(`${head(`${inr(t.outstanding)} is ${label} across ${plural(t.count, "invoice")}.`)}${why([
        nonZero(t.overdue) ? `${inr(t.overdue)} is already overdue (${plural(t.overdueCount, "invoice")}).` : null,
        nonZero(t.dueThisWeek) ? `${inr(t.dueThisWeek)} falls due within 7 days (${plural(t.dueThisWeekCount, "invoice")}).` : null,
        nonZero(t.disputed) ? `${inr(t.disputed)} is disputed — you can hold that back; ${inr(t.payable)} is payable.` : null,
        nonZero(t.msmeOverdue) ? `${inr(t.msmeOverdue)} is owed to MSME suppliers past the legal deadline.` : null,
        ...top,
      ])}${evidence()}`, ["What should we pay first?", "Which of these are MSME suppliers?", "Show the ageing"]);
    }
    case "supplier_balance": {
      if (!sup) break;
      const issues = [...new Set((sup.issues || []).map((i) => i.meaning))];
      const owed = nonZero(sup.outstanding);
      return out(`${head(owed ? `We owe ${sup.name} ${inr(sup.outstanding)} across ${plural(sup.openInvoices.length, "open invoice")}.` : `Nothing is outstanding to ${sup.name} right now.`)}${why([
        `Invoiced ${inr(sup.invoiced)}, paid ${inr(sup.paid)}${nonZero(sup.creditNotes) ? `, credit notes ${inr(sup.creditNotes)}` : ""}${cite(sup.ref)}.`,
        nonZero(sup.disputed) ? `${inr(sup.disputed)} of it is tied up in open issues (${issues.slice(0, 2).join("; ")}); the undisputed part is ${inr(sup.undisputedOutstanding)}.` : null,
        nonZero(sup.unallocatedPayments) ? `${inr(sup.unallocatedPayments)} of payments to them is not yet matched to invoices — matching it may reduce what we owe.` : null,
        sup.msme?.covered && nonZero(sup.msme.overdue) ? `MSME (${sup.msme.category}): ${inr(sup.msme.overdue)} is past the 45-day legal limit.` : null,
        ...sup.openInvoices.slice(0, 3).map((i) => `${i.number} (${dateText(i.date)}): ${inr(i.outstanding)} open${i.overdueDays ? `, ${i.overdueDays} days overdue` : ""}${cite(i.ref)}`),
      ])}${evidence()}`, [`Draft a ${nonZero(sup.disputed) ? "dispute" : "payment schedule"} email to ${sup.name}`, `Show payments to ${sup.name}`, "What should we pay first?"]);
    }
    case "supplier_exposure": {
      if (!expo?.suppliers?.length) break;
      const [first] = expo.suppliers;
      return out(`${head(`We owe the most to ${first.supplier}: ${inr(first.outstanding)} (${first.sharePct}% of ${inr(expo.totalOutstanding)}).`)}${why(expo.suppliers.slice(0, 5).map((x) => `${x.supplier}: ${inr(x.outstanding)} outstanding${nonZero(x.overdue) ? `, ${inr(x.overdue)} overdue` : ""}${nonZero(x.disputed) ? `, ${inr(x.disputed)} disputed` : ""}${x.riskBand ? ` — risk ${x.riskBand}` : ""}${cite(x.ref)}`))}${evidence()}`, [`How much do we owe ${first.supplier} and why?`, "What should we pay first?"]);
    }
    case "msme":
    case "s43bh": {
      if (!msme) break;
      const t = msme.totals;
      const rows = msme.rows.slice(0, 4).map((r) => `${r.invoice} — ${r.supplier} (${r.category}): ${inr(r.outstanding)}, ${r.daysLeft < 0 ? `${-r.daysLeft} days past the deadline` : `deadline ${dateText(r.dueDate)}`}${cite(r.ref)}`);
      if (intent === "s43bh") {
        return out(`${head(`${inr(t.s43bhExpenseAtRisk)} of expense deduction is at risk under s.43B(h) if these MSME invoices stay unpaid at year end.`)}${why([
          "s.43B(h): amounts owed to micro and small enterprises are deductible only in the year paid if you miss the MSMED 45-day limit.",
          `${plural(t.overdueCount, "invoice")} (${inr(t.overdueAmount)}) are already past the limit.`,
          ...rows,
          "This is screening from your records — confirm the tax position with your CA.",
        ])}${evidence()}`, ["What should we pay first?", "Draft payment reminders for MSME suppliers"]);
      }
      return out(`${head(t.overdueCount ? `${plural(t.overdueCount, "MSME invoice")} worth ${inr(t.overdueAmount)} are past the 45-day legal limit.` : `No MSME invoice is past its deadline; ${plural(t.count, "invoice")} are open.`)}${why([
        nonZero(t.interestEstimate) ? `Interest accrues at 3× the RBI bank rate (est. ${inr(t.interestEstimate)} so far).` : null,
        t.dueThisWeekCount ? `${plural(t.dueThisWeekCount, "more invoice")} (${inr(t.dueThisWeekAmount)}) reach the deadline within 7 days.` : null,
        ...rows,
      ])}${evidence()}`, ["What should we pay first?", "What is our 43B(h) exposure?", "Draft a payment schedule to the first supplier"]);
    }
    case "gst_itc": {
      if (!itc) break;
      const r37Risk = nonZero(itc.itcBlockedOrAtRisk);
      const g2bRisk = itc.gstr2b && nonZero(itc.gstr2b.itcAtRisk);
      const headline = r37Risk && g2bRisk
        ? `${inr(itc.itcBlockedOrAtRisk)} of input tax credit is at risk under Rule 37, and ${inr(itc.gstr2b.itcAtRisk)} more sits on invoices not matched in GSTR-2B.`
        : r37Risk ? `${inr(itc.itcBlockedOrAtRisk)} of input tax credit is blocked or at risk under Rule 37.`
          : g2bRisk ? `${inr(itc.gstr2b.itcAtRisk)} of input tax credit is at risk on invoices not matched in GSTR-2B${itc.gstr2b.estimated ? " (estimate)" : ""}.`
            : "No input tax credit is flagged as at risk right now.";
      return out(`${head(headline)}${why([
        g2bRisk ? `GSTR-2B: ${plural(itc.gstr2b.missingIn2B, "invoice")} not matched, ${itc.gstr2b.mismatched} with tax differences — ${itc.gstr2b.basis}.` : null,
        itc.itcOnBooks ? `ITC on purchase invoices in books: ${inr(itc.itcOnBooks)}${cite(itc.ref)}.` : null,
        itc.rule37 ? `Rule 37 (unpaid 180 days): ${itc.rule37.breached ?? 0} breached, ${itc.rule37.approaching ?? 0} approaching — ${inr(itc.rule37.itcAtRisk)} ITC on the unpaid part.` : null,
        ...((itc.rule37?.rows) || []).slice(0, 3).map((r) => `${r.invoice} (${r.supplier}): ${r.daysWaiting} days unpaid, ${inr(r.itcOnUnpaid)} ITC${cite(r.ref)}`),
        g2b ? `GSTR-2B ${g2b.period}: ${g2b.counts.missingIn2B} invoice(s) missing in 2B, ${g2b.counts.mismatched} mismatched${g2b.estimated ? " (estimated — no 2B imported)" : ""}.` : null,
        "Screening only — confirm reversals with your CA.",
      ])}${evidence()}`, ["Which invoices are missing from GSTR-2B?", "Suggest IMS actions", "What should we pay first?"]);
    }
    case "gstr2b": {
      if (!g2b) break;
      return out(`${head(g2b.estimated ? `No GSTR-2B is imported yet — ${plural(g2b.counts.missingIn2B, "invoice")} look at risk from open issues (estimate).` : `${plural(g2b.counts.missingIn2B, "invoice")} are missing from GSTR-2B for ${g2b.period}, and ${g2b.counts.mismatched} don't match.`)}${why([
        `ITC at risk: ${inr(g2b.itcAtRisk)}.`,
        ...g2b.missingIn2B.slice(0, 4).map((r) => `${r.invoice} — ${r.supplier}: tax ${inr(r.tax)}${cite(r.ref)}`),
        ...g2b.mismatched.slice(0, 3).map((r) => `${r.invoice} — ${r.supplier}: books ${inr(r.tax)} vs 2B ${inr(r.reportedTax)}${cite(r.ref)}`),
        g2b.counts.missingInBooks ? `${plural(g2b.counts.missingInBooks, "2B row")} have no invoice in your books.` : null,
      ])}${evidence()}`, ["Suggest IMS actions", "Draft a reminder to the first supplier to file GSTR-1"]);
    }
    case "findings":
    case "explain_finding": {
      if (explain) {
        return out(`${head(`Issue: ${explain.meaning} (${explain.severity}).`)}${why([
          explain.detail ? `Detail: ${explain.detail}${cite(explain.ref)}` : null,
          explain.exposure ? `Exposure: ${inr(explain.exposure)}.` : null,
          explain.recommendedAction ? `Suggested next step: ${String(explain.recommendedAction).replaceAll("_", " ").toLowerCase()}.` : null,
        ])}${evidence()}`, ["Put this case on hold", "Draft a dispute email to this supplier"]);
      }
      if (kase && intent === "explain_finding") return caseAnswer(kase);
      if (!fnd) break;
      const [top] = fnd.items;
      return out(`${head(fnd.total ? `${plural(fnd.total, "open issue")} need attention${top ? `; the most serious: ${top.meaning}` : ""}.` : "No open issues match.")}${why([
        ...fnd.byType.slice(0, 5).map((t) => `${t.count} × ${t.meaning}${nonZero(t.exposure) ? ` (${inr(t.exposure)})` : ""}`),
        ...fnd.items.slice(0, 3).map((f) => `${f.severity}: ${f.detail || f.meaning}${cite(f.ref)}`),
      ])}${evidence()}`, ["Which suppliers are behind these issues?", "Put the first case on hold", "Draft a dispute email"]);
    }
    case "case_status":
    case "document_lookup": {
      if (kase && (intent === "case_status" || !doc)) return caseAnswer(kase);
      if (!doc) break;
      const total = doc.totals?.grand ?? doc.payment?.amount;
      const life = doc.lifecycle || [];
      const ordered = life.reduce((s, l) => s + (Number(l.ordered) || 0), 0);
      const received = life.reduce((s, l) => s + (Number(l.received) || 0), 0);
      const open = pay?.rows?.find((r) => r.documentId === doc.id);
      bank?.addDerived(ordered, { op: "sum", inputs: life.map((l) => String(l.ordered ?? 0)) });
      bank?.addDerived(received, { op: "sum", inputs: life.map((l) => String(l.received ?? 0)) });
      const kind = doc.type === "PO" ? "Purchase order" : doc.type === "INVOICE_IN" ? "Invoice" : doc.type === "PAYMENT_OUT" ? "Payment" : "Document";
      const headline = doc.type === "INVOICE_IN"
        ? (open ? `Invoice ${doc.number} has ${inr(open.outstanding)} outstanding${open.overdueDays ? `, ${open.overdueDays} days overdue` : `, due ${dateText(open.dueDate)}`}.` : `Invoice ${doc.number}${total ? ` (${inr(total)})` : ""} is fully settled.`)
        : `${kind} ${doc.number} is ${String(doc.status || "recorded").replaceAll("_", " ")}${total ? ` — ${inr(total)}` : ""}.`;
      return out(`${head(headline)}${why([
        `${kind} dated ${dateText(doc.date)}${doc.supplier ? ` from ${doc.supplier}` : ""}${total ? `, total ${inr(total)}` : ""}${cite(doc.ref)}.`,
        open && nonZero(open.disputed) ? `${inr(open.disputed)} of it is disputed (${open.issues.map(findingText).slice(0, 2).join("; ")}).` : null,
        open?.msme ? `MSME supplier — legal payment deadline ${dateText(open.msme.dueDate)}.` : null,
        life.length ? `Ordered ${ordered}, received ${received} across ${plural(count(life, (l) => String(l.lineNo)), "line")}.` : null,
        doc.terms?.creditDays != null ? `Credit terms: ${doc.terms.creditDays} days.` : null,
      ])}${evidence()}`, ["What issues are open on this?", "Draft a clarification email to this supplier", "Show the money trail"]);
    }
    case "payments":
    case "unallocated_payments":
    case "allocation": {
      if (!pays) break;
      const unalloc = pays.rows.filter((r) => nonZero(r.unallocated));
      return out(`${head(intent === "payments" ? `${plural(pays.totals.count, "payment")} totalling ${inr(pays.totals.paid)}.` : `${plural(count(unalloc), "payment")} (${inr(sumMoney(unalloc.map((r) => r.unallocated)))}) are not matched to invoices.`)}${why([
        ...(intent === "payments" ? pays.rows : unalloc).slice(0, 5).map((r) => `${dateText(r.date)} — ${r.supplier}: ${inr(r.amount)}${r.utr ? ` (UTR ${r.utr})` : ""}${nonZero(r.unallocated) ? `, ${inr(r.unallocated)} unmatched` : ""}${cite(r.ref)}`),
        intent !== "payments" ? "Ask me to match one — e.g. \"allocate payment <UTR>\"." : null,
      ])}${evidence()}`, ["Which payments are unallocated?", "Draft a remittance advice"]);
    }
    case "calculation": {
      if (!calc) break;
      return out(`${head(`${calc.expression} = ${calc.rounded}`)}\n\nWorked out exactly (no rounding until the last step).`, []);
    }
    case "compare": {
      if (!cmp) break;
      const ch = cmp.changeBvsA;
      const dir = (d) => ((parseExact(d) ?? 0n) >= 0n ? "up" : "down");
      return out(`${head(`Invoices ${dir(ch.invoiced.diff)} ${inr(String(ch.invoiced.diff).replace(/^-/, ""))}${ch.invoiced.pct != null ? ` (${String(ch.invoiced.pct).replace(/^-/, "")}%)` : ""} in ${cmp.periodB.label} vs ${cmp.periodA.label}.`)}${why([
        `${cmp.periodA.label}: invoiced ${inr(cmp.periodA.invoiced)} (${plural(cmp.periodA.invoiceCount, "invoice")}), paid ${inr(cmp.periodA.paid)}.`,
        `${cmp.periodB.label}: invoiced ${inr(cmp.periodB.invoiced)} (${plural(cmp.periodB.invoiceCount, "invoice")}), paid ${inr(cmp.periodB.paid)}.`,
        `Payments ${dir(ch.paid.diff)} ${inr(String(ch.paid.diff).replace(/^-/, ""))}.`,
      ])}`, ["Which suppliers drove the change?", "Show spend by supplier this year"]);
    }
    case "spend": {
      if (!spend) break;
      return out(`${head(`Invoiced ${inr(spend.totals.invoiced)} and paid ${inr(spend.totals.paid)} from ${dateText(spend.from)} to ${dateText(spend.to)}.`)}${why(spend.rows.slice(0, 6).map((r) => `${r.label}: invoiced ${inr(r.invoiced)}, paid ${inr(r.paid)}`))}`, ["Compare this month with last month", "Which suppliers do we owe the most?"]);
    }
    case "how_to": {
      const hit = help?.hits?.[0];
      if (!hit) break;
      return out(`**${hit.title}**\n\nI found this in the Satya guide — open Help for the full article. Ask me about your own records any time, e.g. "Which invoices are missing from GSTR-2B?"`, ["What needs my attention today?"]);
    }
    case "hsn": {
      if (!hsn?.items?.length) break;
      const rows = hsn.items.slice(0, 4).map((x) => `${x.code}: ${x.gstRatePct != null ? `${x.gstRatePct}% GST` : "rate not mapped"}${x.conditional ? " (conditional)" : ""}`);
      return out(`${head(`${hsn.items[0].code}${hsn.items[0].gstRatePct != null ? ` attracts ${hsn.items[0].gstRatePct}% GST` : " has no mapped rate"} in Satya's HSN master.`)}${why(rows)}\n\nConfirm conditional rates with your CA.`, []);
    }
    default:
      break;
  }
  // nothing usable came back
  const need = route.needs || (intent === "supplier_balance" || intent === "draft_message" ? "which supplier you mean" : ["decision", "assign", "reminder", "case_status"].includes(intent) ? "the PO, invoice or case you mean" : null);
  return out(`**I don't have enough on record to answer that${need ? ` — tell me ${need}` : ""}.**${evidence()}`, ["What needs my attention today?", "What is due this week?"], need ? "clarification" : "partial");

  function caseAnswer(c) {
    const l = c.ledger || {};
    return out(`${head(`${c.title || c.id}: ${c.openFindings.length ? `${plural(c.openFindings.length, "open issue")}` : "no open issues"}${l.recordedOutstanding ? `, ${inr(l.recordedOutstanding)} outstanding on record` : ""}.`)}${why([
      l.ordered != null ? `Ordered ${l.ordered}, received ${l.received ?? "—"}, accepted ${l.accepted ?? "—"}, invoiced ${l.invoiced ?? "—"}${cite(c.ref)}.` : null,
      l.settled ? `Paid so far: ${inr(l.settled)}.` : null,
      l.supportedOutstanding && l.recordedOutstanding && l.supportedOutstanding !== l.recordedOutstanding ? `Only ${inr(l.supportedOutstanding)} is supported by deliveries — the rest needs checking.` : null,
      ...c.openFindings.slice(0, 3).map((f) => `${f.severity}: ${f.detail || findingText(f.code)}${f.exposure ? ` (${inr(f.exposure)})` : ""}${cite(f.ref)}`),
      c.recommendation ? `Engine recommendation: ${String(c.recommendation).replaceAll("_", " ").toLowerCase()}.` : null,
    ])}${evidence()}`, ["Put this case on hold", "Draft a dispute email to this supplier", "Assign this case"]);
  }
}
