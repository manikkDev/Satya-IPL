// tools/proposals.js — proposal tools. They NEVER write: each returns an
// action card the UI shows with Confirm / Cancel; on confirm the CLIENT calls
// the named server endpoint with the user's own token.
//
// Prompt-injection isolation (CaMeL-style): a proposal's consequential
// parameters come only from trusted sources —
//   * the user's own message (budget, requested action, dates, channel), and
//   * structured fields returned by the API (ids, amounts, contacts, codes).
// Arguments the model passes are accepted only when they agree with those
// sources; free text inside documents can never pick an action, an amount,
// a recipient or a payee.

import { ulid } from "ulid";
import { amt, findingText } from "./read.js";
import { parseExact, formatExact, inr } from "../exact.js";
import { extractClaims, INJECTION_MARKERS } from "../grounding.js";

const s = (v) => (v == null ? "" : String(v));
const cardId = () => `act_${ulid().toLowerCase()}`;
const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const t = p.toString();
  return t ? `?${t}` : "";
};

/* ------------------------------------------------- trusted user intent */

/** What the USER asked for, read from their own words only. */
export function trustedIntent(userMessage = "") {
  const text = String(userMessage);
  const q = text.toLowerCase();
  const amounts = extractClaims(text).filter((c) => c.kind === "amount" || (c.kind === "number" && Number(c.value) >= 1000)).map((c) => c.value);
  const dates = extractClaims(text).filter((c) => c.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(c.value)).map((c) => c.value);
  let action = null;
  if (/\b(approve|clear (?:it|this) for payment|release (?:it|this))\b/.test(q)) action = "APPROVE";
  if (/\b(hold|put (?:it|this) on hold|block|stop payment)\b/.test(q)) action = "PLACE_ON_HOLD";
  if (/\b(clarif|ask (?:the )?supplier|query the supplier|request (?:a |the )?(?:document|credit note|clarification))/.test(q)) action = action || "REQUEST_CLARIFICATION";
  if (/\bescalat/.test(q)) action = "ESCALATE";
  const channel = /\bwhats ?app\b/.test(q) ? "whatsapp" : /\bsms\b/.test(q) ? "sms" : /\b(e-?mail|mail|letter)\b/.test(q) ? "email" : null;
  const language = /\b(hindi|हिंदी|हिन्दी)\b/i.test(text) ? "hi" : null;
  let purpose = null;
  if (/\b(remittance|payment advice|we (?:have )?paid|paid you|utr)\b/.test(q)) purpose = "remittance";
  else if (/\b(dispute|overbill|over-bill|excess|wrong (?:rate|price|quantity)|duplicate|short (?:supply|delivery)|debit note|credit note)\b/.test(q)) purpose = "dispute";
  else if (/\b(remind|reminder|chase|follow ?up|pending (?:document|invoice))\b/.test(q)) purpose = "reminder";
  else if (/\b(clarif|query|confirm|explain|missing)\b/.test(q)) purpose = "clarification";
  else if (/\b(schedule|when we (?:will|can) pay|payment plan|part payment)\b/.test(q)) purpose = "payment_schedule";
  return { amounts, dates, action, channel, language, purpose };
}

const sameAmount = (a, list) => {
  const v = parseExact(a);
  return v != null && list.some((x) => parseExact(x) === v);
};

/* ------------------------------------------------------------ helpers */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(ymd || "");
};

const REASON_TEXT = (r, row) => ({
  msme_overdue: `MSME — past its legal deadline${row.msme?.interestEstimate ? ` (interest est. ${inr(row.msme.interestEstimate)})` : ""}`,
  msme_due_soon: `MSME — legal deadline ${row.msme?.dueDate ? dateText(row.msme.dueDate) : "soon"}`,
  s43bh_fy_end: "s.43B(h): deduction at risk if unpaid at year end",
  overdue: `${row.overdueDays} days overdue`,
  due_soon: `due ${dateText(row.dueDate)}`,
  disputed: null,
}[r]);

const reasonLine = (row) => (row.reasons || []).map((r) => REASON_TEXT(r, row)).filter(Boolean).join("; ") || `due ${dateText(row.dueDate)}`;

export function proposalTools() {
  const t = {};

  /* ---------------------------------------------------- payment run */
  t.propose_payment_run = {
    kind: "proposal",
    label: "Drafting a payment run",
    declaration: {
      name: "propose_payment_run",
      description: "Propose which invoices to pay now, ranked by MSME 45-day deadline, s.43B(h) year-end risk, interest and days overdue; holds back disputed amounts; fits a cash budget if the user gave one. Returns an action card the user can save for approval. Never pays anything.",
      parameters: {
        type: "object",
        properties: {
          budget: { type: "string", description: "cash available, exactly as the user stated it (omit if not stated)" },
          dueWithinDays: { type: "number", description: "include invoices due within N days (default 7); overdue are always included" },
          supplierId: { type: "string" },
        },
      },
    },
    async run(args, ctx) {
      const trusted = ctx.trusted;
      // budget only if the user's own message states that amount
      let budget = null;
      if (args.budget != null) {
        const claimed = extractClaims(`₹${String(args.budget).replace(/^₹/, "")}`).find((c) => c.kind === "amount")?.value ?? s(args.budget);
        if (sameAmount(claimed, trusted.amounts)) budget = formatExact(parseExact(claimed), 2);
      }
      if (!budget && trusted.amounts.length === 1 && /\b(budget|have|available|cash|limit|only|up to|upto|within|spend|afford)\b/i.test(ctx.userMessage)) {
        budget = formatExact(parseExact(trusted.amounts[0]), 2);
      }
      const within = Math.min(Math.max(Number(args.dueWithinDays) || 7, 0), 90);
      const r = await ctx.call(`/api/v2/assistant/payables${qs({ status: "due_by", dueWithinDays: within, supplierId: args.supplierId, sort: "priority", limit: 200, entityId: ctx.scope.entityId })}`);
      if (!r.ok) return { missing: `payables ledger (${r.error})` };
      const rows = (r.data.items || []).slice().sort((a, b) =>
        a.priority - b.priority
        || (a.msme?.daysLeft ?? 9999) - (b.msme?.daysLeft ?? 9999)
        || b.overdueDays - a.overdueDays);
      const picked = [];
      const excluded = [];
      let remaining = budget ? parseExact(budget) : null;
      for (const row of rows) {
        const payable = parseExact(amt(row.payable)) ?? 0n;
        const disputed = parseExact(amt(row.disputed)) ?? 0n;
        const issues = [...new Set((row.findings || []).map((f) => findingText(f.code)))];
        if (payable <= 0n) {
          excluded.push({ ...base(row), amount: amt(row.outstanding), why: `fully disputed — ${issues.join("; ") || "open issue"}` });
          continue;
        }
        if (remaining != null && payable > remaining) {
          excluded.push({ ...base(row), amount: formatExact(payable, 2), why: `doesn't fit the remaining budget (${inr(formatExact(remaining, 2))})` });
          continue;
        }
        if (remaining != null) remaining -= payable;
        picked.push({
          ...base(row),
          amount: formatExact(payable, 2),
          heldBack: disputed > 0n ? formatExact(disputed, 2) : null,
          why: reasonLine(row) + (disputed > 0n ? `; ${inr(formatExact(disputed, 2))} held back (${issues[0] || "disputed"})` : ""),
        });
      }
      const total = ctx.sum(picked.map((p) => p.amount));
      const heldBack = ctx.sum(picked.map((p) => p.heldBack || "0").concat(excluded.filter((e) => e.why.startsWith("fully")).map((e) => e.amount)));
      if (budget) ctx.expr(`${budget} - ${total}`, "budget left after this run");
      const msmeCount = ctx.count(picked.filter((p) => p.msmeDueDate));
      for (const p of [...picked, ...excluded]) p.ref = ctx.sources.add({ kind: "document", id: p.documentId, type: "INVOICE_IN", caseId: p.caseId, number: p.invoice, label: `Invoice ${p.invoice}` });
      const id = cardId();
      const card = {
        id,
        kind: "payment_run",
        title: budget ? `Payment run within ${inr(budget)}` : "Payment run — everything due",
        summary: picked.length
          ? `Pay ${picked.length} invoice${picked.length === 1 ? "" : "s"} for ${inr(total)}${msmeCount ? ` (${msmeCount} MSME)` : ""}${budget ? `, leaving ${inr(formatExact(remaining, 2))}` : ""}.`
          : "Nothing fits — see the excluded invoices.",
        status: "proposed",
        facts: [
          { label: "To pay", value: total, format: "inr" },
          ...(budget ? [{ label: "Budget", value: budget, format: "inr" }, { label: "Left over", value: formatExact(remaining, 2), format: "inr" }] : []),
          { label: "Held back (disputed)", value: heldBack, format: "inr" },
        ],
        table: {
          columns: [
            { key: "invoice", label: "Invoice" }, { key: "supplier", label: "Supplier" },
            { key: "why", label: "Why now" }, { key: "amount", label: "Pay", format: "inr", align: "right" },
          ],
          rows: picked.map((p) => ({ ...p, _ref: p.ref })),
        },
        excluded: excluded.slice(0, 20).map((e) => ({ invoice: e.invoice, supplier: e.supplier, amount: e.amount, why: e.why, _ref: e.ref })),
        warnings: [
          ...(budget ? [] : ["No cash limit was given — this lists everything overdue or due soon. Tell me your budget to fit it."]),
          "This saves a proposal for approval. It does not pay anyone — release payments from your bank or ERP.",
        ],
        execute: picked.length ? {
          method: "POST",
          path: "/api/v2/assistant/payment-runs",
          body: { title: budget ? `Payment run within ₹${budget}` : "Payment run — due now", budget: budget || undefined, items: picked.map((p) => ({ documentId: p.documentId, amount: p.amount, reason: p.why.slice(0, 300) })), source: "copilot", idempotencyKey: id },
          successText: "Saved for approval",
        } : null,
        confirmLabel: "Save run for approval",
        permission: "payment.release.maker",
      };
      const data = { budget, total, remaining: remaining != null ? formatExact(remaining, 2) : null, heldBack, picked, excluded, count: ctx.count(picked), excludedCount: ctx.count(excluded) };
      return {
        data,
        view: { budget, total, remaining: data.remaining, heldBackForDisputes: heldBack, picked: picked.slice(0, 15), excluded: excluded.slice(0, 10), note: "Proposal only; card shown to the user for confirmation" },
        card,
        summary: `${picked.length} invoice(s), ₹${total}`,
      };
    },
  };

  /* ------------------------------------------------- supplier message */
  t.draft_supplier_message = {
    kind: "proposal",
    label: "Drafting the supplier message",
    declaration: {
      name: "draft_supplier_message",
      description: "Draft an email or WhatsApp message to a supplier — purpose: dispute (over-billing, duplicate, short supply, rate), clarification (missing documents), reminder (pending credit note/invoice), remittance (we paid you), payment_schedule. Built only from the supplier's records; recipient comes from the supplier master. Returns an editable action card; nothing is sent until the user confirms.",
      parameters: {
        type: "object",
        properties: {
          supplierId: { type: "string" },
          purpose: { type: "string", description: "dispute | clarification | reminder | remittance | payment_schedule" },
          channel: { type: "string", description: "email | whatsapp" },
          language: { type: "string", description: "en | hi" },
          invoiceNumbers: { type: "array", items: { type: "string" } },
        },
        required: ["supplierId"],
      },
    },
    async run(args, ctx) {
      const trusted = ctx.trusted;
      const purpose = ["dispute", "clarification", "reminder", "remittance", "payment_schedule"].includes(trusted.purpose || args.purpose) ? (trusted.purpose || args.purpose) : "clarification";
      const channel = trusted.channel || (["email", "whatsapp"].includes(args.channel) ? args.channel : "email");
      const language = trusted.language || (args.language === "hi" ? "hi" : "en");
      const r = await ctx.call(`/api/v2/suppliers/${encodeURIComponent(args.supplierId)}/summary${qs({ entityId: ctx.scope.entityId })}`);
      if (!r.ok) return { missing: `supplier ${args.supplierId} (${r.error})` };
      const d = r.data;
      const supRef = ctx.sources.add({ kind: "supplier", id: d.id, label: d.name });
      const wanted = new Set((args.invoiceNumbers || []).map((x) => s(x).toUpperCase()));
      let invoices = (d.openInvoices || []).map((i) => ({ id: i.id, number: i.number, date: i.date, outstanding: amt(i.outstanding), overdueDays: i.overdueDays, caseId: i.caseId }));
      if (wanted.size) invoices = invoices.filter((i) => wanted.has(s(i.number).toUpperCase()));
      const issues = (d.openFindings?.items || []).map((f) => ({ code: f.code, meaning: findingText(f.code), amount: f.amount, documentIds: f.documentIds || [], caseId: f.caseId }));
      const docName = new Map([...(d.openInvoices || []).map((i) => [i.id, i.number]), ...(d.documents || []).map((x) => [x.id, x.number])]);
      const payments = (d.recentPayments || []).map((p) => ({ number: p.number, date: p.date, amount: amt(p.amount), utr: p.utr, allocations: (p.allocations || []).map((a) => ({ invoice: docName.get(a.documentId) || a.documentId, amount: amt(a.amount) })) }));
      const contact = (d.contacts || []).find((c) => (channel === "email" ? c.email : c.phone)) || null;
      const to = channel === "email" ? contact?.email || "" : contact?.phone || "";
      const msg = composeMessage({ purpose, language, channel, supplier: d.name, contactName: contact?.name, invoices, issues, payments, docName, outstanding: amt(d.outstanding), disputed: amt(d.disputed), buyer: ctx.buyerName });
      const caseId = invoices.find((i) => i.caseId)?.caseId || issues.find((i) => i.caseId)?.caseId;
      const id = cardId();
      const card = {
        id,
        kind: "supplier_message",
        title: `${channel === "email" ? "Email" : "WhatsApp"} to ${d.name}`,
        summary: `${PURPOSE_LABEL[purpose]} — ${language === "hi" ? "Hindi" : "English"} draft, built from ${invoices.length} invoice(s) and ${issues.length} open issue(s) on record.`,
        status: "proposed",
        fields: [
          { key: "channel", label: "Channel", type: "select", value: channel, options: ["email", "whatsapp"], bind: "channel" },
          { key: "to", label: channel === "email" ? "To (email)" : "To (mobile)", type: "text", value: to, bind: "to", required: true },
          ...(channel === "email" ? [{ key: "subject", label: "Subject", type: "text", value: msg.subject, bind: "subject" }] : []),
          { key: "body", label: "Message", type: "textarea", value: msg.body, bind: "body", required: true },
        ],
        warnings: [
          ...(to ? [] : [`No ${channel === "email" ? "email address" : "mobile number"} on file for ${d.name} — type one, or add it to the supplier master.`]),
          channel === "email" ? "Confirm puts this in the Outbox; it is sent from there (emails wait during quiet hours, 22:00–08:00 IST)." : "Confirm creates a WhatsApp share link — you send it from your own phone.",
        ],
        execute: {
          method: "POST",
          path: "/api/v2/workflow/outbox",
          body: { channel, to, ...(channel === "email" ? { subject: msg.subject } : {}), body: msg.body, supplierId: d.id, ...(caseId ? { caseId } : {}), idempotencyKey: id },
          successText: channel === "email" ? "Queued in the Outbox" : "WhatsApp link ready",
        },
        confirmLabel: channel === "email" ? "Queue email" : "Create WhatsApp link",
        permission: "finding.decide",
        sources: [supRef],
      };
      return {
        data: { supplier: d.name, purpose, channel, language, invoices, issues, payments, hasRecipient: Boolean(to) },
        view: { supplierRef: supRef, supplier: d.name, purpose, channel, language, recipientOnFile: Boolean(to), invoicesMentioned: invoices.map((i) => i.number), issuesMentioned: issues.map((i) => i.meaning), note: "Draft shown to the user in an editable card; do not repeat the full text" },
        card,
        summary: `${PURPOSE_LABEL[purpose]} draft for ${d.name}`,
      };
    },
  };

  /* ------------------------------------------------------ IMS actions */
  t.propose_ims_actions = {
    kind: "proposal",
    label: "Suggesting IMS actions",
    declaration: {
      name: "propose_ims_actions",
      description: "Suggest accept / reject / pending for GSTR-2B (IMS) rows of a period, with a reason per row, from the books-vs-2B match. Returns an action card to record the decisions; the user still acts on the GST portal.",
      parameters: { type: "object", properties: { period: { type: "string", description: "YYYY-MM" } } },
    },
    async run(args, ctx) {
      const r = await ctx.call(`/api/v2/compliance/gstr2b${qs({ period: /^\d{4}-\d{2}$/.test(s(args.period)) ? args.period : undefined, entityId: ctx.scope.entityId })}`);
      if (!r.ok) return { missing: `GSTR-2B match (${r.error})` };
      const d = r.data;
      const decisions = [];
      if (!d.estimated) {
        for (const x of d.missingInBooks || []) {
          decisions.push({ documentId: x.documentId, invoice: x.invoice, supplier: x.supplier, tax: amt(x.tax), action: "pending", reason: "In 2B but not in your books — keep pending until you find and book the invoice (or reject if you never bought this)." });
        }
        for (const x of d.mismatched || []) {
          const over = (parseExact(amt(x.reportedTax)) ?? 0n) > (parseExact(amt(x.tax)) ?? 0n);
          decisions.push({ documentId: x.documentId, invoice: x.invoice, supplier: x.supplier, tax: amt(x.tax), reportedTax: amt(x.reportedTax), action: over ? "reject" : "pending",
            reason: over ? `Supplier reported more tax (${inr(amt(x.reportedTax))}) than your invoice (${inr(amt(x.tax))}) — reject so they correct it.` : `Tax differs by ${inr(amt(x.taxDifference))} — keep pending and ask the supplier to amend.` });
        }
      }
      const suspected = (d.missingIn2B || []).map((x) => ({ invoice: x.invoice, supplier: x.supplier, tax: amt(x.tax) }));
      for (const row of decisions) row.ref = row.documentId ? ctx.sources.add({ kind: "document", id: row.documentId, number: row.invoice, label: `Invoice ${row.invoice}` }) : null;
      const id = cardId();
      const card = {
        id,
        kind: "ims_actions",
        title: `IMS actions — ${d.period}`,
        summary: d.estimated
          ? "No GSTR-2B has been imported for this period, so there are no supplier rows to act on yet."
          : `${decisions.length} row(s) need a decision; ${d.matched} matched row(s) can be accepted.`,
        status: "proposed",
        facts: [
          { label: "Matched (accept)", value: String(d.matched ?? 0), format: "int" },
          { label: "Need a decision", value: String(decisions.length), format: "int" },
          { label: "ITC at risk", value: amt(d.itcAtRisk), format: "inr" },
        ],
        table: decisions.length ? {
          columns: [{ key: "invoice", label: "Invoice" }, { key: "supplier", label: "Supplier" }, { key: "action", label: "Suggest" }, { key: "reason", label: "Why" }],
          rows: decisions.map((x) => ({ ...x, _ref: x.ref })),
        } : null,
        warnings: [
          d.estimated ? "Import the GSTR-2B JSON for this period (Compliance → GSTR-2B) to get row-level suggestions." : "Recording here does not file anything — take the same action on the GST portal IMS before the GSTR-3B due date.",
          ...(suspected.length ? [`${suspected.length} invoice(s) in your books are not in 2B — follow up with those suppliers (ITC at risk).`] : []),
        ],
        execute: decisions.length ? {
          method: "POST",
          path: "/api/v2/assistant/ims-decisions",
          body: { period: d.period, decisions: decisions.map(({ ref, tax, reportedTax, ...x }) => ({ ...x, documentId: x.documentId || undefined })), source: "copilot" },
          successText: "Decisions recorded",
        } : null,
        confirmLabel: "Record decisions",
        permission: "finding.decide",
      };
      return { data: { period: d.period, estimated: d.estimated, matched: d.matched, decisions, suspectedMissingIn2B: suspected, itcAtRisk: amt(d.itcAtRisk) }, view: { period: d.period, estimated: d.estimated, matched: d.matched, decisions: decisions.slice(0, 15), suspectedMissingIn2B: suspected.slice(0, 10), itcAtRisk: amt(d.itcAtRisk) }, card, summary: `${decisions.length} IMS suggestion(s)` };
    },
  };

  /* --------------------------------------------------------- decision */
  t.propose_decision = {
    kind: "proposal",
    label: "Preparing a decision",
    declaration: {
      name: "propose_decision",
      description: "Prepare a decision on an investigation case: PLACE_ON_HOLD, APPROVE, REQUEST_CLARIFICATION or ESCALATE, with the reason and the issues it rests on. Satya recommends from the case's open issues; an action the user explicitly asked for is shown with a warning if it conflicts. Returns an action card.",
      parameters: { type: "object", properties: { caseId: { type: "string" }, action: { type: "string" }, findingId: { type: "string" } }, required: ["caseId"] },
    },
    async run(args, ctx) {
      const r = await ctx.call(`/api/v2/cases/${encodeURIComponent(args.caseId)}`);
      if (!r.ok) return { missing: `case ${args.caseId} (${r.error})` };
      const c = r.data;
      const open = (c.findings || []).filter((f) => f.status === "open");
      const blocking = open.filter((f) => ["critical", "high"].includes(f.severity) && /DUP|EXCEEDS|PRICE_VARIANCE|SHORTFALL/.test(f.code));
      const docGaps = open.filter((f) => /MISSING|GSTIN_INVALID|EWAYBILL|CREDIT_NOTE_PENDING/.test(f.code));
      const recommended = blocking.length ? "PLACE_ON_HOLD" : docGaps.length ? "REQUEST_CLARIFICATION" : open.length ? "REQUEST_CLARIFICATION" : "APPROVE";
      const recReason = blocking.length
        ? `${blocking.length} high-severity issue(s): ${[...new Set(blocking.map((f) => findingText(f.code)))].join("; ")}`
        : docGaps.length ? `missing or invalid records: ${[...new Set(docGaps.map((f) => findingText(f.code)))].join("; ")}`
          : open.length ? `${open.length} open issue(s) to clear first` : "no open issues on this case";
      // only the USER can pick a different action
      const requested = ctx.trusted.action;
      const action = requested || recommended;
      const target = args.findingId && open.some((f) => f.id === args.findingId) ? args.findingId : (action === "PLACE_ON_HOLD" ? blocking[0]?.id : docGaps[0]?.id) || undefined;
      const exposure = ctx.sum(blocking.map((f) => f.data?.amount || "0"));
      const id = cardId();
      const caseRef = ctx.sources.add({ kind: "case", id: c.id, label: c.title || c.id });
      const card = {
        id,
        kind: "decision",
        title: `${ACTION_LABEL[action]} — ${c.title || c.id}`,
        summary: `Satya recommends ${ACTION_LABEL[recommended].toLowerCase()}: ${recReason}.`,
        status: "proposed",
        facts: [
          { label: "Open issues", value: String(open.length), format: "int" },
          ...(blocking.length ? [{ label: "Exposure (high issues)", value: exposure, format: "inr" }] : []),
        ],
        table: open.length ? {
          columns: [{ key: "severity", label: "Severity" }, { key: "meaning", label: "Issue" }, { key: "amount", label: "Exposure", format: "inr", align: "right" }],
          rows: open.slice(0, 8).map((f) => ({ severity: f.severity, meaning: findingText(f.code), amount: f.data?.amount ?? null, _ref: ctx.sources.add({ kind: "finding", id: f.id, caseId: c.id, label: findingText(f.code) }) })),
        } : null,
        fields: [{ key: "reason", label: "Reason (saved with the decision)", type: "textarea", value: `${ACTION_LABEL[action]}: ${recReason}.`, bind: "reason", required: true }],
        warnings: [
          ...(requested && requested !== recommended ? [`You asked to ${ACTION_LABEL[requested].toLowerCase()}, but Satya would ${ACTION_LABEL[recommended].toLowerCase()} because ${recReason}.`] : []),
          "Confirming records the decision on the case and re-runs the check. It does not pay or notify anyone.",
        ],
        execute: {
          method: "POST",
          path: `/api/v2/cases/${encodeURIComponent(c.id)}/decisions`,
          body: { action, ...(target ? { findingId: target } : {}), reason: `${ACTION_LABEL[action]}: ${recReason}.`, expectedRevision: c.revision },
          successText: "Decision recorded",
        },
        confirmLabel: ACTION_LABEL[action],
        permission: "finding.decide",
        sources: [caseRef],
      };
      return { data: { caseId: c.id, recommended, requested, action, reason: recReason, openIssues: open.length, exposure }, view: { caseRef, recommended, requestedByUser: requested, action, reason: recReason, openIssues: open.length }, card, summary: `${ACTION_LABEL[action]} proposed` };
    },
  };

  /* ------------------------------------------------------- allocation */
  t.propose_allocation = {
    kind: "proposal",
    label: "Matching the payment to invoices",
    declaration: {
      name: "propose_allocation",
      description: "Propose how an unallocated payment should be matched to open invoices/credit notes (exact subset-sum from the allocation engine). Returns an action card; nothing is allocated until the user confirms.",
      parameters: { type: "object", properties: { paymentId: { type: "string" } }, required: ["paymentId"] },
    },
    async run(args, ctx) {
      const r = await ctx.call(`/api/v2/payments/${encodeURIComponent(args.paymentId)}/allocate`);
      if (!r.ok) return { missing: `payment ${args.paymentId} (${r.error})` };
      const d = r.data;
      const names = new Map([...(d.openInvoices || []).map((i) => [i.id, i.number]), ...(d.credits || []).map((c) => [c.id, `credit note ${c.id}`])]);
      const solutions = d.suggestion?.solutions || [];
      const best = solutions[0] || null;
      const payRef = ctx.sources.add({ kind: "payment", id: d.payment.id, number: d.payment.utr, label: `Payment ${d.payment.utr || d.payment.id}` });
      const rows = (best?.allocations || []).map((a) => ({ documentId: a.documentId, invoice: names.get(a.documentId) || a.documentId, amount: amt(a.amount), _ref: ctx.sources.add({ kind: "document", id: a.documentId, number: names.get(a.documentId), label: `Invoice ${names.get(a.documentId) || a.documentId}` }) }));
      const id = cardId();
      const card = {
        id,
        kind: "allocation",
        title: `Match payment ${d.payment.utr || d.payment.id}`,
        summary: best
          ? `${inr(d.payment.remaining)} unmatched → ${rows.length} document(s)${solutions.length > 1 ? ` (${solutions.length} exact combinations exist — showing the first; check before confirming)` : " (the only exact combination)"}.`
          : `No exact combination of open invoices adds up to ${inr(d.payment.remaining)}.`,
        status: "proposed",
        facts: [
          { label: "Payment", value: amt(d.payment.amount), format: "inr" },
          { label: "Unmatched", value: d.payment.remaining, format: "inr" },
          ...(best ? [{ label: "Residual after match", value: amt(best.residual), format: "inr" }] : []),
        ],
        table: rows.length ? { columns: [{ key: "invoice", label: "Document" }, { key: "amount", label: "Allocate", format: "inr", align: "right" }], rows } : null,
        warnings: [
          ...(d.suggestionError ? [`Allocation engine unavailable: ${d.suggestionError.message}`] : []),
          ...(solutions.length > 1 ? ["More than one exact match exists — confirm with the remittance advice first."] : []),
          "Confirming writes the allocation (audit-logged) and re-runs reconciliation.",
        ],
        fields: [{ key: "reason", label: "Reason", type: "text", value: solutions.length === 1 ? "Exact unique match proposed by Satya" : "Matched by amount; confirmed against remittance advice", bind: "reason", required: true }],
        execute: best ? {
          method: "POST",
          path: `/api/v2/payments/${encodeURIComponent(d.payment.id)}/allocate`,
          body: { allocations: rows.map((x) => ({ documentId: x.documentId, amount: x.amount })), reason: "Exact unique match proposed by Satya", expectedRevision: d.payment.revision },
          successText: "Payment matched",
        } : null,
        confirmLabel: "Allocate payment",
        permission: "payment.release.maker",
        sources: [payRef],
      };
      return { data: { payment: d.payment, solutions: solutions.length, unique: Boolean(d.suggestion?.unique), allocations: rows.map(({ _ref, ...x }) => x) }, view: { paymentRef: payRef, remaining: d.payment.remaining, solutions: solutions.length, proposed: rows.map(({ _ref, ...x }) => ({ ...x, ref: _ref })), openInvoiceCount: (d.openInvoices || []).length }, card, summary: best ? `${rows.length} allocation(s)` : "no exact match" };
    },
  };

  /* ------------------------------------------------------- assignment */
  t.propose_assignment = {
    kind: "proposal",
    label: "Choosing an owner",
    declaration: {
      name: "propose_assignment",
      description: "Propose assigning an investigation case to a colleague (named by the user, or the best-suited AP role) with a priority. Returns an action card.",
      parameters: { type: "object", properties: { caseId: { type: "string" }, assignee: { type: "string", description: "person's name as the user said it" }, priority: { type: "string" } }, required: ["caseId"] },
    },
    async run(args, ctx) {
      const [people, kase] = await Promise.all([ctx.call("/api/v2/workflow/assignees"), ctx.call(`/api/v2/cases/${encodeURIComponent(args.caseId)}`)]);
      if (!kase.ok) return { missing: `case ${args.caseId} (${kase.error})` };
      const list = people.ok ? people.data?.items || [] : [];
      const msg = ctx.userMessage.toLowerCase();
      const named = list.find((p) => s(p.name).toLowerCase().split(/\s+/).some((w) => w.length > 2 && msg.includes(w)));
      const ranked = [...list].sort((a, b) => roleRank(a.roles) - roleRank(b.roles));
      const pick = named || ranked[0] || null;
      const priority = /\burgent|asap|high priority\b/.test(msg) ? "high" : ["low", "normal", "high"].includes(args.priority) && msg.includes(args.priority) ? args.priority : "normal";
      const id = cardId();
      const caseRef = ctx.sources.add({ kind: "case", id: kase.data.id, label: kase.data.title || kase.data.id });
      const card = {
        id,
        kind: "assignment",
        title: `Assign ${kase.data.title || kase.data.id}`,
        summary: pick ? `Assign to ${pick.name} (${(pick.roles || []).join(", ") || "member"}), ${priority} priority.` : "No colleagues found in this workspace.",
        status: "proposed",
        fields: [
          { key: "assignee", label: "Assign to", type: "select", value: pick?.id || "", options: list.map((p) => ({ value: p.id, label: `${p.name} — ${(p.roles || []).join(", ")}` })), bind: "assignee", required: true },
          { key: "priority", label: "Priority", type: "select", value: priority, options: ["low", "normal", "high"], bind: "priority" },
        ],
        warnings: [...(args.assignee && !named ? [`I couldn't match "${s(args.assignee).slice(0, 40)}" to a workspace member — pick from the list.`] : [])],
        execute: pick ? { method: "POST", path: `/api/v2/workflow/cases/${encodeURIComponent(kase.data.id)}/assign`, body: { assignee: pick.id, priority }, successText: "Assigned" } : null,
        confirmLabel: "Assign",
        permission: "finding.decide",
        sources: [caseRef],
      };
      return { data: { caseId: kase.data.id, assignee: pick?.name || null, priority }, view: { caseRef, proposedAssignee: pick?.name || null, priority, people: list.length }, card, summary: pick ? `assign to ${pick.name}` : "no assignee" };
    },
  };

  /* --------------------------------------------------------- reminder */
  t.propose_reminder = {
    kind: "proposal",
    label: "Setting a follow-up",
    declaration: {
      name: "propose_reminder",
      description: "Propose a follow-up reminder on an investigation case (due date + note). Returns an action card.",
      parameters: { type: "object", properties: { caseId: { type: "string" }, dueDate: { type: "string" }, note: { type: "string" } }, required: ["caseId"] },
    },
    async run(args, ctx) {
      const kase = await ctx.call(`/api/v2/cases/${encodeURIComponent(args.caseId)}`);
      if (!kase.ok) return { missing: `case ${args.caseId} (${kase.error})` };
      const dueDate = ctx.trusted.dates[0] || ctx.dateAdd(ctx.today, /\btomorrow\b/i.test(ctx.userMessage) ? 1 : /\bnext week\b/i.test(ctx.userMessage) ? 7 : 2);
      const open = (kase.data.findings || []).filter((f) => f.status === "open");
      const fallbackNote = `Follow up on ${kase.data.title || kase.data.id}: ${open.length ? [...new Set(open.map((f) => findingText(f.code)))].slice(0, 2).join("; ") : "check status"}`;
      const note = args.note && !INJECTION_MARKERS.test(args.note) ? s(args.note).slice(0, 300) : fallbackNote;
      const id = cardId();
      const caseRef = ctx.sources.add({ kind: "case", id: kase.data.id, label: kase.data.title || kase.data.id });
      const card = {
        id,
        kind: "reminder",
        title: `Reminder — ${kase.data.title || kase.data.id}`,
        summary: `Remind on ${dueDate}.`,
        status: "proposed",
        fields: [
          { key: "dueDate", label: "Due", type: "date", value: dueDate, bind: "dueDate", required: true },
          { key: "note", label: "Note", type: "textarea", value: note, bind: "note", required: true },
        ],
        execute: { method: "POST", path: `/api/v2/workflow/cases/${encodeURIComponent(kase.data.id)}/reminders`, body: { dueDate, note }, successText: "Reminder set" },
        confirmLabel: "Set reminder",
        permission: "finding.decide",
        sources: [caseRef],
      };
      return { data: { caseId: kase.data.id, dueDate }, view: { caseRef, dueDate, note }, card, summary: `reminder ${dueDate}` };
    },
  };

  return t;
}

const base = (row) => ({
  documentId: row.documentId, invoice: row.invoice, supplier: row.supplier, supplierId: row.supplierId, caseId: row.caseId,
  dueDate: row.dueDate, msmeDueDate: row.msme?.dueDate || null, overdueDays: row.overdueDays, outstanding: amt(row.outstanding),
});

const roleRank = (roles = []) => (roles.includes("ap_manager") ? 0 : roles.includes("ap_clerk") ? 1 : roles.includes("treasury") ? 2 : 3);

export const ACTION_LABEL = { APPROVE: "Approve", PLACE_ON_HOLD: "Put on hold", REQUEST_CLARIFICATION: "Ask the supplier to clarify", ESCALATE: "Escalate" };
const PURPOSE_LABEL = { dispute: "Dispute", clarification: "Clarification request", reminder: "Reminder", remittance: "Remittance advice", payment_schedule: "Payment schedule" };

/* ------------------------------------------------------ message drafts */

/**
 * Supplier message from STRUCTURED fields only (numbers, dates, codes,
 * amounts). Never includes document free text.
 */
export function composeMessage({ purpose, language, channel, supplier, contactName, invoices, issues, payments, docName, outstanding, disputed, buyer }) {
  const hi = language === "hi";
  const greet = hi ? `नमस्ते ${contactName || supplier} जी,` : `Dear ${contactName || `${supplier} team`},`;
  const sign = hi ? `धन्यवाद,\nअकाउंट्स टीम${buyer ? `, ${buyer}` : ""}` : `Regards,\nAccounts team${buyer ? `, ${buyer}` : ""}`;
  const invLine = (i) => (hi
    ? `• इनवॉइस ${i.number} (${i.date}) — बकाया ${inr(i.outstanding)}`
    : `• Invoice ${i.number} dated ${i.date} — ${inr(i.outstanding)} outstanding`);
  const issueLine = (f) => {
    const docs = (f.documentIds || []).map((x) => docName.get(x)).filter(Boolean);
    const where = docs.length ? ` (${docs.join(", ")})` : "";
    return hi
      ? `• ${HINDI_ISSUE[f.code] || f.meaning}${where}${f.amount ? ` — राशि ${inr(f.amount)}` : ""}`
      : `• ${f.meaning[0].toUpperCase()}${f.meaning.slice(1)}${where}${f.amount ? ` — ${inr(f.amount)} affected` : ""}`;
  };
  let subject;
  let lines;
  switch (purpose) {
    case "dispute":
      subject = hi ? `बिलिंग में अंतर — ${supplier}` : `Billing discrepancy on your invoices — ${supplier}`;
      lines = hi
        ? ["हमारे रिकॉर्ड की जाँच में ये अंतर मिले हैं:", ...issues.slice(0, 6).map(issueLine), "", "कृपया क्रेडिट नोट या संशोधित इनवॉइस भेजें। विवादित राशि का भुगतान स्पष्टता मिलने तक रोका गया है; बाकी राशि सामान्य शर्तों पर दी जाएगी।"]
        : ["While reconciling our purchase records we found the following:", ...issues.slice(0, 6).map(issueLine), "",
          `Please send a credit note or a corrected invoice. We are holding the disputed amount${disputed && disputed !== "0.00" ? ` (${inr(disputed)})` : ""} until this is resolved; the undisputed balance will be paid on normal terms.`];
      break;
    case "remittance": {
      const p = payments[0];
      subject = hi ? `भुगतान सूचना — ${supplier}` : `Remittance advice — ${supplier}`;
      lines = p
        ? (hi
          ? [`हमने ${p.date} को ${inr(p.amount)} का भुगतान किया है${p.utr ? ` (UTR ${p.utr})` : ""}।`, ...(p.allocations.length ? ["यह भुगतान इन इनवॉइस के लिए है:", ...p.allocations.map((a) => `• ${a.invoice} — ${inr(a.amount)}`)] : []), "कृपया अपने खाते में समायोजित करें।"]
          : [`We have paid ${inr(p.amount)} on ${p.date}${p.utr ? ` (UTR ${p.utr})` : ""}.`, ...(p.allocations.length ? ["It settles:", ...p.allocations.map((a) => `• ${a.invoice} — ${inr(a.amount)}`)] : ["Please let us know which invoices you have applied it to."]), "Kindly update your ledger and confirm."])
        : [hi ? "हमारे रिकॉर्ड में हाल का कोई भुगतान नहीं मिला।" : "We could not find a recent payment on record to advise."];
      break;
    }
    case "reminder":
      subject = hi ? `लंबित दस्तावेज़ — ${supplier}` : `Pending documents — ${supplier}`;
      lines = hi
        ? ["कृपया इन मामलों के लिए लंबित दस्तावेज़ भेजें:", ...(issues.length ? issues.slice(0, 6).map(issueLine) : invoices.slice(0, 6).map(invLine))]
        : ["A gentle reminder — we are still waiting on the following:", ...(issues.length ? issues.slice(0, 6).map(issueLine) : invoices.slice(0, 6).map(invLine)), "", "Please share the pending document (credit note, delivery challan, e-way bill or corrected invoice) so we can release payment."];
      break;
    case "payment_schedule":
      subject = hi ? `भुगतान योजना — ${supplier}` : `Payment schedule — ${supplier}`;
      lines = hi
        ? [`आपके ${invoices.length} इनवॉइस पर कुल बकाया ${inr(outstanding)} है:`, ...invoices.slice(0, 8).map(invLine), "", "हम जल्द भुगतान की तारीख़ की पुष्टि करेंगे।"]
        : [`Our records show ${inr(outstanding)} outstanding across ${invoices.length} invoice(s):`, ...invoices.slice(0, 8).map(invLine), "", "We will confirm the payment date shortly. Please let us know if your records differ."];
      break;
    case "clarification":
    default:
      subject = hi ? `स्पष्टीकरण आवश्यक — ${supplier}` : `Clarification needed — ${supplier}`;
      lines = hi
        ? ["हमारे रिकॉर्ड मिलान में कुछ बिंदुओं पर स्पष्टीकरण चाहिए:", ...(issues.length ? issues.slice(0, 6).map(issueLine) : invoices.slice(0, 6).map(invLine)), "", "कृपया सहायक दस्तावेज़ भेजें।"]
        : ["We need your help to close a few points in our reconciliation:", ...(issues.length ? issues.slice(0, 6).map(issueLine) : invoices.slice(0, 6).map(invLine)), "", "Please share the supporting documents or confirm the correct figures."];
  }
  const body = [greet, "", ...lines, "", sign].join("\n");
  return { subject, body: channel === "whatsapp" ? body.replace(/\n{2,}/g, "\n\n") : body };
}

const HINDI_ISSUE = {
  DUPLICATE_INVOICE_SUSPECT: "यह इनवॉइस किसी अन्य इनवॉइस का डुप्लिकेट लगता है",
  DUP_EXACT_INVOICE: "यह इनवॉइस पहले से दर्ज है (डुप्लिकेट)",
  INVOICE_QTY_EXCEEDS_RECEIVED: "प्राप्त मात्रा से अधिक बिल किया गया है",
  QTY_INVOICED_EXCEEDS_ACCEPTED: "QC में स्वीकृत मात्रा से अधिक बिल किया गया है",
  DELIVERY_SHORTFALL: "ऑर्डर से कम माल मिला है",
  PRICE_VARIANCE: "PO दर से अलग दर लगाई गई है",
  DOC_MISSING_INVOICE: "माल मिला पर इनवॉइस नहीं मिला",
  RECEIPT_EVIDENCE_MISSING: "बिना GRN के बिल किया गया है",
  DOC_CREDIT_NOTE_PENDING: "क्रेडिट नोट लंबित है",
  TAX_GSTIN_INVALID: "GSTIN मान्य नहीं है",
  TAX_TYPE_MISMATCH: "टैक्स का प्रकार (IGST/CGST-SGST) गलत है",
  TAX_EWAYBILL_MISSING: "ई-वे बिल नहीं है",
};

