// briefing.js — the daily briefing on the Ask start screen. Runs the same
// read tools as the copilot (user-scoped JWT), no language model: what is
// overdue, what falls due this week, MSME clocks, biggest open issues, GST
// credit at risk, and the cash needed. Every figure is a tool value or an
// exact sum of tool values.

import { createToolkit } from "./tools/index.js";
import { SourceRegistry } from "./sources.js";
import { NumberBank } from "./grounding.js";
import { sumMoney, parseExact } from "./exact.js";

const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : String(ymd || "");
};
const nonZero = (v) => (parseExact(v) ?? 0n) !== 0n;

/**
 * @param {object} o
 * @param {Function} o.call serverCall bound to the user's JWT
 * @param {object} o.scope {groupId, entityId?, userId}
 * @returns {Promise<object>} briefing payload
 */
export async function buildBriefing({ call, scope, today = todayIst() }) {
  const sources = new SourceRegistry();
  const bank = new NumberBank();
  const toolkit = createToolkit({ call, scope, sources, bank, userMessage: "", today });
  const [due, msme, findings, itc] = await Promise.all([
    toolkit.run("list_payables", { status: "due_by", dueWithinDays: 7, limit: 50 }),
    toolkit.run("msme_payments_due", { withinDays: 15 }),
    toolkit.run("list_findings", { severity: "critical,high", limit: 5 }),
    toolkit.run("gst_itc_at_risk", {}),
  ]);
  const sections = [];
  const pay = due.data;
  let cash = null;
  if (pay) {
    const overdueRows = pay.rows.filter((r) => r.overdueDays > 0);
    const weekRows = pay.rows.filter((r) => r.overdueDays === 0);
    cash = { overdue: pay.totals.overdue, dueThisWeek: pay.totals.dueThisWeek, total: sumMoney([pay.totals.overdue, pay.totals.dueThisWeek]), disputed: pay.totals.disputed, payable: pay.totals.payable };
    sections.push({
      id: "overdue", title: "Overdue", tone: overdueRows.length ? "critical" : "ok",
      metric: { value: pay.totals.overdue, format: "inr", caption: `${pay.totals.overdueCount} invoice${pay.totals.overdueCount === 1 ? "" : "s"}` },
      items: overdueRows.slice(0, 3).map((r) => ({ label: `${r.supplier}`, detail: `${r.invoice} · ${r.overdueDays} days overdue${r.msme ? " · MSME" : ""}`, amount: r.outstanding, href: sources.get(r.ref)?.href, ref: r.ref })),
      ask: "Which overdue invoices should we pay first?",
    });
    sections.push({
      id: "due_week", title: "Due this week", tone: weekRows.length ? "warn" : "ok",
      metric: { value: pay.totals.dueThisWeek, format: "inr", caption: `${pay.totals.dueThisWeekCount} invoice${pay.totals.dueThisWeekCount === 1 ? "" : "s"}` },
      items: weekRows.slice(0, 3).map((r) => ({ label: r.supplier, detail: `${r.invoice} · due ${dateText(r.dueDate)}`, amount: r.outstanding, href: sources.get(r.ref)?.href, ref: r.ref })),
      ask: "What is due this week?",
    });
  }
  if (msme.data) {
    const t = msme.data.totals;
    sections.push({
      id: "msme", title: "MSME 45-day clock", tone: t.overdueCount ? "critical" : t.dueThisWeekCount ? "warn" : "ok",
      metric: { value: t.overdueAmount, format: "inr", caption: `${t.overdueCount} past the limit${nonZero(t.interestEstimate) ? ` · interest est. ₹${t.interestEstimate}` : ""}` },
      items: msme.data.rows.slice(0, 3).map((r) => ({ label: r.supplier, detail: `${r.invoice} · ${r.daysLeft < 0 ? `${-r.daysLeft} days past` : `${r.daysLeft} days left`}`, amount: r.outstanding, href: sources.get(r.ref)?.href, ref: r.ref })),
      ask: "Which MSME payments are past 45 days?",
    });
  }
  if (findings.data) {
    const f = findings.data;
    const exposure = sumMoney(f.items.map((x) => x.exposure || "0"));
    sections.push({
      id: "issues", title: "Biggest open issues", tone: f.total ? "warn" : "ok",
      metric: { value: String(f.total), format: "int", caption: nonZero(exposure) ? `₹${exposure} exposure in the top ${f.items.length}` : "critical and high" },
      items: f.items.slice(0, 3).map((x) => ({ label: x.meaning, detail: x.detail || x.severity, amount: x.exposure, href: sources.get(x.ref)?.href, ref: x.ref })),
      ask: "What are the critical issues I should review first?",
    });
  }
  if (itc.data) {
    const g = itc.data;
    // Rule 37 reversals plus credit on invoices not matched in GSTR-2B
    const atRisk = toolkit.ctx.sum([g.itcBlockedOrAtRisk || "0", g.gstr2b?.itcAtRisk || "0"]);
    const r37 = g.rule37 ? `Rule 37: ${g.rule37.breached ?? 0} breached, ${g.rule37.approaching ?? 0} approaching` : "";
    const g2b = g.gstr2b && nonZero(g.gstr2b.itcAtRisk) ? `${g.gstr2b.missingIn2B} invoice(s) not matched in GSTR-2B${g.gstr2b.estimated ? " (estimate)" : ""}` : "";
    sections.push({
      id: "gst", title: "GST credit at risk", tone: nonZero(atRisk) ? "warn" : "ok",
      metric: { value: atRisk, format: "inr", caption: [g2b, r37].filter(Boolean).join(" · ") },
      items: (g.rule37?.rows || []).slice(0, 3).map((r) => ({ label: r.supplier, detail: `${r.invoice} · ${r.daysWaiting} days unpaid`, amount: r.itcOnUnpaid, href: sources.get(r.ref)?.href, ref: r.ref })),
      ask: "What is our ITC at risk and why?",
    });
  }
  const failed = toolkit.results.filter((r) => r.missing).map((r) => r.missing);
  return {
    asOf: today,
    headline: cash
      ? (nonZero(cash.total) ? { text: "Cash needed to clear overdue and this week's dues", value: cash.total, format: "inr" } : { text: "Nothing overdue or due this week", value: null })
      : null,
    cash,
    sections,
    suggestions: [
      ...(cash && nonZero(cash.total) ? [`We have ₹${cash.total} this week — what should we pay first?`] : []),
      ...sections.filter((s) => s.tone !== "ok").map((s) => s.ask),
    ].slice(0, 4),
    missing: failed.length ? failed : undefined,
    generatedFrom: toolkit.log.map((l) => l.name),
  };
}
