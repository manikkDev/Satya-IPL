// templates.js — deterministic answers per intent (evidence-only mode).
// Used when every LLM path is exhausted or the writer fails validation twice.
// Numbers still come from the facts registry — templates only arrange them.

const bullet = (lines) => lines.filter(Boolean).map((l) => `- ${l}`).join("\n");

const FACTS_BY_LABEL = (registry) =>
  Object.fromEntries([...registry.facts.values()].map((f) => [f.label, f.id]));

/**
 * @param {string} intent
 * @param {FactRegistry} registry facts collected during retrieval
 * @param {object} ctx {retrieved: {tool -> data}, missing: string[]}
 * @returns {{answerMarkdown:string, certainty:string, followUps:string[], responseMode:"evidence_only"}}
 */
export function deterministicAnswer(intent, registry, ctx = {}) {
  const F = FACTS_BY_LABEL(registry);
  const missing = ctx.missing?.length
    ? `\n\nMissing evidence: ${ctx.missing.join("; ")} — I won't guess the rest.`
    : "";
  const base = { followUps: followUpsFor(intent), responseMode: "evidence_only" };

  switch (intent) {
    case "supplier_balance": {
      const s = ctx.retrieved?.get_supplier_summary || {};
      const name = s.name || "the supplier";
      const fact = (suffix) => F[`${s.name || "supplier"} ${suffix}`];
      const ref = (id) => (id ? `{{${id}}}` : null);
      const owed = fact("outstanding (owed)");
      const openCount = s.counts?.openInvoices ?? (s.openInvoices || []).length;
      const head = owed
        ? `We owe **${name}** ${ref(owed)} across ${openCount} open invoice${openCount === 1 ? "" : "s"}.`
        : `I couldn't find an outstanding balance for **${name}** in your records.`;
      const why = [
        fact("invoiced") && `Invoiced ${ref(fact("invoiced"))}, paid ${ref(fact("paid")) || "—"}${fact("credit notes") ? `, credit notes ${ref(fact("credit notes"))}` : ""}.`,
        fact("disputed (open issues)") && `${ref(fact("disputed (open issues)"))} of that is tied up in open issues; the undisputed part is ${ref(fact("undisputed outstanding"))}.`,
        fact("payments not yet matched to invoices") && s.unallocatedPayments?.amount !== "0.00" && `${ref(fact("payments not yet matched to invoices"))} of payments are not yet matched to invoices — matching them may reduce what is owed.`,
        fact("MSME overdue") && `MSME (${s.msme?.category}) supplier: ${ref(fact("MSME overdue"))} is past the 45-day MSMED deadline.`,
      ].filter(Boolean);
      const invoices = (s.openInvoices || []).slice(0, 5).map((inv) => {
        const id = F[`invoice ${inv.number} outstanding`];
        return `${inv.number} (${inv.date})${id ? ` — ${ref(id)} open` : ""}${inv.overdueDays ? `, ${inv.overdueDays} days overdue` : ""}`;
      });
      const byCode = new Map();
      for (const f of s.openFindings?.items || []) {
        const key = `${String(f.code || "issue").replaceAll("_", " ").toLowerCase()} (${f.severity})`;
        byCode.set(key, (byCode.get(key) || 0) + 1);
      }
      const issues = [...byCode].slice(0, 4).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
      return {
        answerMarkdown: [
          head,
          why.length ? `\n**Why:**\n\n${bullet(why)}` : "",
          invoices.length ? `\n**Open invoices:**\n\n${bullet(invoices)}` : "",
          issues.length ? `\n**Open issues on this supplier (${s.openFindings?.count}):**\n\n${bullet(issues)}` : "",
          missing,
        ].filter(Boolean).join("\n"),
        certainty: registry.weakestCertainty(),
        followUps: [`Show open invoices for ${name}`, `Which ${name} issues are blocking payment?`, `Draft a reminder to ${name}`],
        responseMode: "evidence_only",
      };
    }
    case "status":
    case "lookup": {
      const lines = [
        F.ordered && `Ordered: {{${F.ordered}}}`,
        F.received && `Received: {{${F.received}}}`,
        F.accepted && `Accepted: {{${F.accepted}}}`,
        F.invoiced && `Invoiced: {{${F.invoiced}}}`,
        F.settled && `Paid: {{${F.settled}}}`,
        F.supportedOutstanding && `Delivery-supported outstanding: {{${F.supportedOutstanding}}}`,
      ];
      return {
        ...base,
        answerMarkdown: lines.filter(Boolean).length
          ? `Here is what the records show:\n\n${bullet(lines)}${missing}`
          : `I couldn't find that in your records. Check the reference and try again — I won't substitute another record.${missing}`,
        certainty: registry.weakestCertainty(),
      };
    }
    case "why_amount":
    case "analytics":
    case "compare": {
      const steps = (ctx.calculation || []).map(
        (s) => `- ${s.step || s.label || s.description || "step"}${s.factId ? ` {{${s.factId}}}` : ""}`,
      );
      const lines = [...registry.facts.values()]
        .filter((f) => f.unit === "INR")
        .map((f) => `- ${f.label}: {{${f.id}}}`);
      return {
        ...base,
        answerMarkdown: `${steps.length ? "How it adds up:\n\n" + bullet(steps) + "\n\n" : ""}${lines.length ? bullet(lines) : "I don't have the figures needed to answer that yet."}${missing}`,
        certainty: registry.weakestCertainty(),
      };
    }
    case "explain_finding": {
      const findings = ctx.findings || [];
      const lines = findings.map(
        (f) => `- **${f.title}**: ${f.explanation || f.detail || ""}${f.action ? ` Next step: ${f.action}.` : ""}`,
      );
      return {
        ...base,
        answerMarkdown: `${lines.length ? bullet(lines) : "No matching finding is recorded in the current snapshot."}\n\nA discrepancy is a question about evidence, not a verdict.${missing}`,
        certainty: findings.some((f) => f.certainty === "AMBIGUOUS") ? "AMBIGUOUS" : registry.weakestCertainty(),
      };
    }
    case "compliance": {
      const deadlines = (ctx.deadlines || []).slice(0, 8).map(
        (d) => `- ${d.label || d.kind}: due ${d.dueDateFactId ? `{{${d.dueDateFactId}}}` : d.dueDate || ""}${d.amountFactId ? ` ({{${d.amountFactId}}})` : ""}`,
      );
      return {
        ...base,
        answerMarkdown: `${deadlines.length ? "Upcoming deadlines on record:\n\n" + bullet(deadlines) : "No compliance deadlines are on record right now."}${missing}\n\nDeadlines are computed from your documents; confirm specifics with your CA.`,
        certainty: registry.weakestCertainty(),
      };
    }
    case "draft_message": {
      return {
        ...base,
        answerMarkdown: ctx.draft || "I couldn't draft a message — tell me which supplier and which document you need.",
        certainty: "CONFIRMED",
      };
    }
    case "how_to": {
      const snippets = (ctx.helpSnippets || []).slice(0, 3).map((s) => s.text.trim());
      return {
        ...base,
        answerMarkdown: snippets.length ? snippets.join("\n\n") : "I don't have help text for that yet. Try asking about a PO, GRN, invoice, e-invoice or payment.",
        certainty: "CONFIRMED",
      };
    }
    case "out_of_scope":
      return {
        ...base,
        answerMarkdown:
          "That's outside what I can help with. I work with your purchase orders, invoices, receipts, payments and GST records — I can show evidence, not give tax or legal advice. For tax positions please check with your CA.",
        certainty: "CONFIRMED",
      };
    case "smalltalk":
      return {
        ...base,
        answerMarkdown: "Hello! Ask me about a purchase order, a delivery, an invoice, a payment or a deadline — I'll answer from your records.",
        certainty: "CONFIRMED",
      };
    default:
      return {
        ...base,
        answerMarkdown: `Here's what I found in the records.\n\n${bullet(
          [...registry.facts.values()].slice(0, 6).map((f) => `${f.label}: {{${f.id}}}`),
        )}${missing}`,
        certainty: registry.weakestCertainty(),
      };
  }
}

function followUpsFor(intent) {
  switch (intent) {
    case "status":
      return ["What is still left to deliver?", "Show the payments on this order", "Any issues flagged?"];
    case "compliance":
      return ["Which MSME payments are due this week?", "Show ITC at risk", "List held invoices"];
    default:
      return ["Show the evidence", "What needs clarification?", "Summarise the balances"];
  }
}
