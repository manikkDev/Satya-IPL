// pipeline.js — the "Ask Satya" agent runtime.
//
//   guard → route (deterministic; cheap model when unsure) → resolve named
//   records → plan/execute:
//     * LLM available: tool-calling loop (≤6 rounds, parallel calls), the
//       final round streamed token-by-token through a grounding gate;
//     * LLM unavailable, or it answered without touching tools on a
//       substantive question: the deterministic plan runs the same tools
//       and the evidence composer writes the answer
//   → verify (numbers ⊆ tool results ∪ calculator ∪ user input; [S#] refs
//     real; no action claims; no echoed injections) → retry once → repair or
//     fall back → persist.
//
// SSE events (send): status, tool, delta, reset, action, (answer is returned)

import { ulid } from "ulid";
import { classify, classifyWithLlm, planFor, NO_DATA_INTENTS, ABOUT_ATTACHMENT } from "./router.js";
import { createToolkit, viewJson, ATTACHMENT_TOOLS } from "./tools/index.js";
import { normalizeOptions, policyFor, optionsPrompt, scopeLabel, planNeedsInput, PLAN_QUESTION, analyseExtras, workingSection, noteFromAnswer } from "./options.js";
import { SourceRegistry, normalizeCitations } from "./sources.js";
import { NumberBank, verifyAnswer, stripUngrounded, extractClaims } from "./grounding.js";
import { composeEvidenceAnswer } from "./compose.js";
import { workingMemory, refreshSummary } from "./memory.js";
import { prompt, fill } from "./promptLoader.js";

const MAX_MESSAGE = 2000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const stripControl = (text) => String(text || "").replace(CONTROL_CHARS, " ").slice(0, MAX_MESSAGE);
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

/** Intents whose answer must rest on tool data. */
const needsData = (intent) => !NO_DATA_INTENTS.has(intent) && intent !== "general";

/**
 * Tools offered to the model per routed intent (plus search + calculator).
 * A focused tool list keeps prompts small — free tiers meter tokens per
 * minute — and keeps the planner on task. "general" gets everything.
 */
const FAMILY = {
  briefing: ["dashboard_today", "list_payables", "msme_payments_due", "list_findings", "gst_itc_at_risk", "supplier_exposure", "propose_payment_run"],
  payables_due: ["list_payables", "supplier_exposure", "get_supplier_summary", "msme_payments_due", "propose_payment_run"],
  ageing: ["list_payables", "supplier_exposure", "get_supplier_summary"],
  supplier_balance: ["get_supplier_summary", "list_payables", "payment_history", "list_findings", "explain_finding", "draft_supplier_message", "spend_by_period"],
  supplier_exposure: ["supplier_exposure", "list_payables", "get_supplier_summary"],
  msme: ["msme_payments_due", "list_payables", "get_supplier_summary", "propose_payment_run", "draft_supplier_message"],
  s43bh: ["msme_payments_due", "list_payables", "propose_payment_run"],
  gst_itc: ["gst_itc_at_risk", "gstr2b_mismatches", "list_findings", "propose_ims_actions", "draft_supplier_message"],
  gstr2b: ["gstr2b_mismatches", "gst_itc_at_risk", "propose_ims_actions", "draft_supplier_message"],
  ims: ["propose_ims_actions", "gstr2b_mismatches", "gst_itc_at_risk"],
  findings: ["list_findings", "explain_finding", "get_case", "get_document", "propose_decision", "draft_supplier_message"],
  explain_finding: ["list_findings", "explain_finding", "get_case", "get_document", "propose_decision", "draft_supplier_message"],
  case_status: ["get_case", "get_document", "list_findings", "list_payables", "propose_decision", "propose_assignment", "propose_reminder"],
  document_lookup: ["get_document", "get_case", "list_payables", "list_findings", "propose_decision", "draft_supplier_message"],
  payments: ["payment_history", "get_supplier_summary", "propose_allocation", "spend_by_period", "draft_supplier_message"],
  unallocated_payments: ["payment_history", "list_findings", "propose_allocation"],
  allocation: ["payment_history", "propose_allocation", "get_document"],
  payment_run: ["propose_payment_run", "list_payables", "msme_payments_due"],
  draft_message: ["draft_supplier_message", "get_supplier_summary", "list_findings", "payment_history"],
  decision: ["get_case", "propose_decision", "list_findings", "draft_supplier_message"],
  assign: ["get_case", "propose_assignment"],
  reminder: ["get_case", "propose_reminder"],
  calculation: [],
  compare: ["compare_periods", "spend_by_period"],
  spend: ["spend_by_period", "compare_periods"],
  how_to: ["search_help"],
  hsn: ["hsn_lookup", "search_help"],
  attachment_review: [...ATTACHMENT_TOOLS, "get_document", "get_case", "list_findings", "get_supplier_summary", "hsn_lookup", "draft_supplier_message", "propose_decision"],
};
/** Draft mode adds the writing tools to whatever the question needs. */
const DRAFT_TOOLS = ["draft_supplier_message", "get_supplier_summary", "list_findings", "get_case", "explain_finding", "payment_history"];
const toolsFor = (intent, opts) => {
  if (policyFor(opts.mode).allTools && intent !== "calculation") return null; // Analyse: every tool
  const base = FAMILY[intent];
  if (!base) return null;
  return [...new Set([
    "search_records", "calculate", ...base,
    ...(opts.mode === "draft" ? DRAFT_TOOLS : []),
    ...(opts.mode === "plan" ? ["propose_payment_run", "list_payables", "msme_payments_due"] : []),
    ...(opts.attachmentIds.length ? ATTACHMENT_TOOLS : []),
  ])];
};
const DRAFT_NOTE = /\b(note|memo|summary|internal|cfo|ceo|boss|md|director|team|approval|board|management)\b/i;

/**
 * @param {object} o
 * @param {string} o.message
 * @param {object} [o.context] {page, caseId?, documentId?, supplierId?, entityId?}
 * @param {object} o.auth {userId, groupId, roles}
 * @param {object|null} o.llm gateway-like {generate, stream?, canServe?} or null (evidence mode)
 * @param {Function} o.call serverCall bound to the user's JWT
 * @param {object} [o.rag]
 * @param {object} [o.store] ConversationStore
 * @param {object} [o.conversation]
 * @param {Function} [o.send] SSE emitter
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.today] YYYY-MM-DD override (tests/eval)
 * @param {object} [o.options] agent options from the composer (options.js)
 */
export async function runCopilot({ message, context = {}, auth, llm = null, call, rag = null, store = null, conversation = null, send = () => {}, signal, today = todayIst(), options = {} }) {
  const started = Date.now();
  const opts = normalizeOptions(options);
  const policy = policyFor(opts.mode);
  const sources = new SourceRegistry();
  const bank = new NumberBank();
  const text = stripControl(message).trim();
  bank.addUserText(text);
  const memory = workingMemory(conversation);
  const focus = memory.focusEntities || {};
  const scope = { groupId: auth?.groupId || null, entityId: opts.scope.entityId || context.entityId || null, userId: auth?.userId || null };
  const toolkit = createToolkit({ call, rag, scope, sources, bank, userMessage: text, today, onEvent: send, options: opts });
  const llmInfo = { provider: null, model: null };
  let extras = [];

  if (!text) {
    return finish({ content: "**Ask me about your payables, suppliers, invoices or GST/MSME deadlines.**", answerType: "clarification", intent: "general", responseMode: "evidence_only" });
  }

  /* ---- 1. route ------------------------------------------------------ */
  send("status", { stage: "understanding", detail: "Reading your question" });
  let route = classify(text, { memory: { ...focus, lastIntent: memory.lastIntent }, context, today });
  const llmUsable = Boolean(llm) && (typeof llm.canServe !== "function" || llm.canServe("chat") || llm.groq?.enabled);
  if (route.confidence < 0.5 && llmUsable) {
    const better = await classifyWithLlm(llm, text, { contextText: `page=${context.page || "ask"}` }).catch(() => null);
    if (better && better !== route.intent) route = { ...route, intent: better, confidence: 0.6, reason: "model classification" };
  }

  if (NO_DATA_INTENTS.has(route.intent)) {
    const c = composeEvidenceAnswer(route.intent, { data: {}, sources, route, message: text });
    return finish({ content: c.markdown, answerType: c.answerType, followUps: c.followUps, intent: route.intent, responseMode: "evidence_only" });
  }
  // mode + attachment steer the route (refusals above are never overridden)
  if (opts.attachmentIds.length && (ABOUT_ATTACHMENT.test(text) || route.intent === "general" || route.confidence < 0.8)) {
    route = { ...route, intent: "attachment_review", confidence: 0.9, reason: "question about the attached document" };
  } else if (opts.mode === "plan" && !["payment_run", "attachment_review"].includes(route.intent)) {
    route = { ...route, intent: "payment_run", confidence: 0.85, reason: "Plan payments mode" };
  }
  // Draft mode, internal note ("a note for our CFO on what is due") — answer
  // the underlying question; the note is written from that verified answer
  if (opts.mode === "draft" && route.intent === "draft_message" && DRAFT_NOTE.test(text)) {
    const subject = text.replace(/^[\s\S]*?\b(?:on|about|regarding|covering|summari[sz]ing|explaining|of)\b\s+/i, "");
    const inner = subject !== text && subject.length > 5 ? classify(subject, { memory: { ...focus, lastIntent: memory.lastIntent }, context, today }) : null;
    if (inner && !["general", "draft_message", "smalltalk", "out_of_scope"].includes(inner.intent)) route = { ...inner, reason: `Draft mode note: ${inner.reason}` };
  }
  if (opts.mode === "plan" && route.intent === "payment_run" && memory.lastIntent !== "payment_run" && planNeedsInput(text, opts)) {
    return finish({ content: PLAN_QUESTION.content, answerType: "clarification", options: PLAN_QUESTION.options, intent: route.intent, responseMode: "evidence_only" });
  }
  const scopeText = scopeLabel(opts.scope);
  if (scopeText || opts.mode !== "ask") {
    const modeName = { analyse: "Analyse", draft: "Draft", plan: "Plan payments" }[opts.mode];
    send("status", { stage: "understanding", detail: [modeName ? `${modeName} mode` : null, scopeText ? `scoped to ${scopeText}` : null].filter(Boolean).join(" · ") });
  }

  /* ---- 2. resolve named records -------------------------------------- */
  send("status", { stage: "retrieving", detail: "Finding the records you mentioned" });
  const resolved = await resolveEntities({ toolkit, route, context, focus, text });
  resolved.attachmentIds = opts.attachmentIds;
  // a scoped supplier is the default subject of supplier questions
  if (opts.scope.supplierId && !resolved.supplierId) {
    resolved.supplierId = opts.scope.supplierId;
    if (/supplier/.test(resolved.needs || "")) delete resolved.needs;
    delete resolved.clarify;
  }
  if (opts.mode === "draft" && resolved.supplierId && !DRAFT_NOTE.test(text) && ["supplier_balance", "payments", "findings", "explain_finding", "general"].includes(route.intent)) {
    route = { ...route, intent: "draft_message", reason: "Draft mode" };
  }
  if (resolved.clarify) {
    return finish({ content: resolved.clarify.content, answerType: "clarification", options: resolved.clarify.options, intent: route.intent, responseMode: "evidence_only" });
  }

  // multi-step without a model: "draft a note to the supplier we owe most",
  // "put the biggest issue's case on hold" — find the subject first
  const SUPERLATIVE = /\b(most|top|biggest|largest|highest|worst|most serious|first)\b/i;
  if (SUPERLATIVE.test(text) && ["draft_message", "supplier_balance", "payments"].includes(route.intent) && !resolved.supplierId) {
    const r = await toolkit.run("supplier_exposure", { limit: 5 });
    resolved.supplierId = r.data?.suppliers?.[0]?.supplierId || null;
    if (resolved.supplierId) delete resolved.needs;
  }
  if (SUPERLATIVE.test(text) && ["decision", "assign", "reminder"].includes(route.intent) && !resolved.caseId) {
    const r = await toolkit.run("list_findings", { severity: "critical,high", limit: 5 });
    resolved.caseId = r.data?.items?.find((f) => f.caseId)?.caseId || null;
    if (resolved.caseId) delete resolved.needs;
  }
  const basePlan = planFor(route.intent, { entities: route.entities, resolved, message: text, today });
  extras = opts.mode === "analyse" ? analyseExtras(route.intent, { resolved }).filter((x) => !basePlan.some((b) => b.tool === x.tool)) : [];
  const plan = [...basePlan, ...extras];
  // attachment questions read the document first, so the model starts from it
  const prefetch = route.intent === "attachment_review";
  if (prefetch) await runPlan(plan);

  /* ---- 3. agent loop (LLM) or deterministic plan ---------------------- */
  let answerText = null;
  let responseMode = "evidence_only";
  const gate = new StreamGate({ bank, sources, send });
  if (llmUsable && !signal?.aborted) {
    send("status", { stage: "planning", detail: "Working out which records to check" });
    const system = fill(prompt("agent.v2"), {
      TODAY: today,
      CONTEXT: contextBlock({ route, resolved, context, plan: prefetch ? [] : plan, memory, opts, scopeText }),
    });
    const ask = prefetch
      ? `${text}\n\nRecords already retrieved for this question (tool results):\n${toolkit.results.map((r, i) => `Tool ${r.name} result: ${viewJson(toolViewOf(toolkit, i))}`).join("\n\n")}`
      : text;
    const contents = [...historyContents(memory), { role: "user", parts: [{ text: ask }] }];
    const agent = await agentLoop({ llm, toolkit, system, contents, gate, send, signal, started, toolNames: toolsFor(route.intent, opts), policy });
    if (agent.ok) {
      llmInfo.provider = agent.provider;
      llmInfo.model = agent.model;
      // Bug fix (was: Groq answering without function calls skipped
      // retrieval): a substantive question answered with ZERO tool calls is
      // never trusted — run the deterministic plan and rewrite from data.
      if (!toolkit.log.length && needsData(route.intent)) {
        gate.discard();
        await runPlan(plan);
        if (toolkit.log.length) {
          const rewrite = await writeFromData({ llm, system, contents, toolkit, gate, send, signal });
          if (rewrite.ok) answerText = rewrite.text;
        } else {
          answerText = agent.text;
        }
      } else {
        answerText = agent.text;
      }
      if (answerText) responseMode = "agent";
    }
  }
  if (!answerText) {
    if (!toolkit.log.length || !plan.every((step) => toolkit.called().includes(step.tool))) {
      await runPlan(plan.filter((step) => !toolkit.called().includes(step.tool)));
    }
  }

  /* ---- 4. verify; retry once; repair or fall back -------------------- */
  send("status", { stage: "checking", detail: "Checking every figure against your records" });
  const identifiers = [...collectIdentifiers(toolkit.results), ...Object.values(resolved).filter((v) => typeof v === "string")];
  let verdict = answerText ? verifyAnswer(answerText, { bank, sourceRefs: sources.refs(), identifiers }) : null;
  if (answerText && !verdict.ok && process.env.COPILOT_DEBUG) console.warn(`[copilot] grounding failed: ${verdict.violations.join(" | ")}\n${answerText}`);
  if (answerText && !verdict.ok && llmUsable && !signal?.aborted) {
    send("reset", { reason: "grounding" });
    gate.discard();
    send("status", { stage: "writing", detail: "Rewriting so every figure is backed by a record" });
    const retry = await retryWrite({ llm, toolkit, answerText, violations: verdict.violations, gate, send, signal, today, route, resolved, context, memory, text, opts, scopeText });
    if (retry.ok) {
      const v2 = verifyAnswer(retry.text, { bank, sourceRefs: sources.refs(), identifiers });
      answerText = retry.text;
      verdict = v2;
    }
  }
  if (answerText && !verdict.ok) {
    const repaired = stripUngrounded(answerText, verdict.ungrounded).replace(/\[S\d+\]/g, (m) => (sources.get(m.slice(1, -1)) ? m : ""));
    const v3 = verifyAnswer(repaired, { bank, sourceRefs: sources.refs(), identifiers });
    if (v3.ok && repaired.length > 60 && /^\*\*/.test(repaired.trim())) {
      answerText = repaired;
      verdict = v3;
    } else {
      answerText = null; // fall back to the evidence composer
    }
  }
  const composed = composeEvidenceAnswer(route.intent, { data: dataByTool(toolkit.results), missing: toolkit.results.filter((r) => r.missing).map((r) => r.missing), sources, route: { ...route, needs: resolved.needs }, message: text, bank: answerText ? null : bank });
  if (!answerText) {
    if (gate.emitted) send("reset", { reason: "fallback" });
    answerText = composed.markdown;
    responseMode = "evidence_only";
    verdict = verifyAnswer(answerText, { bank, sourceRefs: sources.refs(), identifiers });
    if (!verdict.ok && verdict.ungrounded.length) {
      answerText = stripUngrounded(answerText, verdict.ungrounded);
      verdict = verifyAnswer(answerText, { bank, sourceRefs: sources.refs(), identifiers });
    }
  }

  /* ---- 5. option extras: analyse summary, draft note, working ------- */
  const extraParts = [];
  if (opts.mode === "analyse" && responseMode === "evidence_only") {
    const also = toolkit.log.filter((l) => l.ok && extras.some((x) => x.tool === l.name) && l.summary).map((l) => `- ${toolkit.defs[l.name]?.label || l.name}: ${l.summary}`);
    if (also.length) extraParts.push(`**Also checked**\n\n${also.join("\n")}`);
  }
  const answerKind = responseMode === "agent" ? "answer" : composed.answerType;
  if (opts.mode === "draft" && !["clarification", "refusal", "partial"].includes(answerKind) && !toolkit.cards.some((c) => c.kind === "supplier_message") && !/^:::draft/m.test(answerText)) {
    const note = noteFromAnswer(answerText, route.intent === "attachment_review" ? "Note on the attached document" : "Internal note");
    if (note) extraParts.push(note);
  }
  if (opts.showWorking) {
    const working = workingSection(answerText, bank.derivations);
    extraParts.push(working || "**How we calculated**\n\nNo arithmetic was needed — every figure above is quoted directly from your records.");
  }
  if (extraParts.length) {
    let extended = `${answerText.trim()}\n\n${extraParts.join("\n\n")}`;
    let v = verifyAnswer(extended, { bank, sourceRefs: sources.refs(), identifiers });
    if (!v.ok && v.ungrounded.length) {
      extended = `${answerText.trim()}\n\n${stripUngrounded(extraParts.join("\n\n"), v.ungrounded)}`;
      v = verifyAnswer(extended, { bank, sourceRefs: sources.refs(), identifiers });
    }
    if (v.ok || v.claims - v.grounded <= verdict.claims - verdict.grounded) {
      if (gate.emitted) send("delta", { text: `\n\n${extended.slice(answerText.trim().length).trim()}` });
      answerText = extended;
      verdict = v;
    }
  }

  const missing = toolkit.results.filter((r) => r.missing).map((r) => r.missing);
  return finish({
    content: answerText,
    answerType: toolkit.cards.length ? "proposal" : responseMode === "agent" ? "answer" : composed.answerType,
    followUps: composed.followUps,
    intent: route.intent,
    responseMode,
    verdict,
    missing,
    focus: { caseId: resolved.caseId || null, documentId: resolved.documentId || null, supplierId: resolved.supplierId || null, paymentId: resolved.paymentId || null },
  });

  /* ---- helpers --------------------------------------------------------- */
  async function runPlan(steps) {
    if (!steps.length) return;
    send("status", { stage: "retrieving", detail: "Pulling the matching records" });
    // independent reads in parallel; two-step plans (find → explain) follow up
    await Promise.all(steps.map((step) => toolkit.run(step.tool, step.args)));
    if (route.intent === "explain_finding" && !toolkit.called().includes("explain_finding")) {
      const fnd = dataByTool(toolkit.results).list_findings;
      if (fnd?.items?.[0]?.id) await toolkit.run("explain_finding", { findingId: fnd.items[0].id });
    }
    if (route.intent === "allocation" && !toolkit.called().includes("propose_allocation")) {
      const unalloc = (dataByTool(toolkit.results).payment_history?.rows || []).filter((r) => r.status !== "allocated");
      const named = route.entities.utrs.map((u) => u.toUpperCase());
      const byUtr = unalloc.find((r) => r.utr && named.includes(String(r.utr).toUpperCase()));
      if (byUtr || unalloc.length === 1) await toolkit.run("propose_allocation", { paymentId: (byUtr || unalloc[0]).id });
    }
    if (route.intent === "draft_message" && !toolkit.called().includes("draft_supplier_message") && resolved.supplierId) {
      await toolkit.run("draft_supplier_message", { supplierId: resolved.supplierId });
    }
  }

  async function finish(result) {
    const verdict = result.verdict || verifyAnswer(result.content, { bank, sourceRefs: sources.refs(), identifiers: [] });
    const citations = sources.used(result.content);
    const messageId = `msg_${ulid().toLowerCase()}`;
    const payload = {
      messageId,
      agentOptions: {
        mode: opts.mode, showWorking: opts.showWorking, includeScreening: opts.includeScreening, confirmedOnly: opts.confirmedOnly,
        scope: Object.fromEntries(Object.entries(opts.scope).filter(([, v]) => v)), attachments: opts.attachmentIds.length,
      },
      content: result.content,
      answerType: result.answerType || "answer",
      certainty: result.missing?.length ? "INSUFFICIENT_EVIDENCE" : verdict.ok ? "CONFIRMED" : "PROBABLE",
      citations: citations.length ? citations : [],
      sources: sources.top(12),
      tables: toolkit.tables.slice(0, 4).map((t) => ({ ...t, rows: t.rows.slice(0, 50) })),
      actions: toolkit.cards,
      followUps: result.followUps || [],
      suggestedFollowUps: result.followUps || [],
      options: result.options,
      grounding: {
        checked: true,
        claims: verdict.claims,
        grounded: verdict.grounded,
        ungrounded: verdict.ungrounded,
        rate: verdict.claims ? Number((verdict.grounded / verdict.claims).toFixed(3)) : 1,
        citationsValid: verdict.citations.valid.length,
        citationsInvalid: verdict.citations.invalid.length,
        // exact computations made by code (sums, calculator, counts, dates)
        // with their inputs, so any figure can be recomputed by an auditor
        derivations: bank.derivations.slice(0, 200),
      },
      responseMode: result.responseMode || "evidence_only",
      mode: result.responseMode === "agent" ? "llm" : "evidence_only",
      llm: llmInfo,
      intent: result.intent,
      missingEvidence: result.missing?.length ? result.missing : undefined,
      toolCalls: toolkit.log,
      graphRef: result.focus,
      latencyMs: Date.now() - started,
      queriedAt: new Date().toISOString(),
    };
    await persist(payload, result);
    return payload;
  }

  async function persist(payload, result) {
    if (!store || !auth?.userId || signal?.aborted) return; // a stopped answer is not saved
    try {
      let conv = conversation;
      if (!conv) conv = await store.create({ userId: auth.userId, groupId: auth.groupId, title: text });
      await store.appendMessages(conv.id, { userId: auth.userId, groupId: auth.groupId }, [
        { role: "user", content: text, at: payload.queriedAt },
        {
          role: "assistant", id: payload.messageId, content: payload.content, answerType: payload.answerType,
          citations: payload.citations, tables: payload.tables, actions: payload.actions, followUps: payload.followUps,
          grounding: payload.grounding, responseMode: payload.responseMode, intent: payload.intent, toolCalls: payload.toolCalls, at: payload.queriedAt,
          agentOptions: payload.agentOptions, options: payload.options, certainty: payload.certainty, sources: payload.sources,
        },
      ]);
      const patch = { lastIntent: result.intent };
      if (result.focus && Object.values(result.focus).some(Boolean)) patch.focusEntities = { ...focus, ...Object.fromEntries(Object.entries(result.focus).filter(([, v]) => v)) };
      await store.update(conv.id, patch);
      payload.conversationId = conv.id;
      if (llm) void refreshSummary(llm, store, conv).catch(() => {});
    } catch {
      /* persistence is best-effort */
    }
  }
}

/* ======================================================= agent loop */

async function agentLoop({ llm, toolkit, system, contents, gate, send, signal, started, toolNames = null, policy = policyFor("ask") }) {
  let provider = null;
  let model = null;
  for (let step = 0; step < policy.maxSteps; step++) {
    if (signal?.aborted || Date.now() - started > policy.budgetMs) break;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: toolkit.declarations(toolNames) }],
      generationConfig: { temperature: 0.1, maxOutputTokens: policy.maxTokens, lowLatency: true },
    };
    const out = typeof llm.stream === "function"
      ? await llm.stream("chat", body, { onText: (t) => gate.push(t), signal })
      : await llm.generate("chat", body);
    if (!out.ok) return { ok: false, reason: out.reason };
    provider = out.provider || provider;
    model = out.model || model;
    const parts = out.parts || out.raw?.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      if (typeof llm.stream !== "function" && out.text) gate.push(out.text);
      gate.end();
      return { ok: true, text: normalizeCitations(String(out.text || "").trim()), provider, model, steps: step + 1 };
    }
    // the model chose tools: anything streamed this round was preamble
    if (gate.emitted) send("reset", { reason: "tools" });
    gate.discard();
    send("status", { stage: "retrieving", detail: calls.length > 1 ? `Checking ${calls.length} things at once` : step > 0 ? "Following up on what I found" : "Checking your records" });
    contents.push({ role: "model", parts });
    const results = await Promise.all(calls.map((c) => toolkit.run(c.functionCall.name, c.functionCall.args || {})));
    contents.push({
      role: "user",
      parts: results.map((r, i) => ({
        functionResponse: {
          name: calls[i].functionCall.name,
          ...(calls[i].functionCall.id ? { id: calls[i].functionCall.id } : {}),
          response: { result: viewJson(r.view ?? { missing: r.missing || r.error }) },
        },
      })),
    });
  }
  // out of rounds: answer from what we have, no more tools
  if (signal?.aborted) return { ok: false, reason: "aborted" };
  send("status", { stage: "writing", detail: "Writing the answer" });
  contents.push({ role: "user", parts: [{ text: "Answer now from the tool results above, in the required format. Do not call more tools." }] });
  const out = typeof llm.stream === "function"
    ? await llm.stream("chat", { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.1, maxOutputTokens: policy.maxTokens, lowLatency: true } }, { onText: (t) => gate.push(t), signal })
    : await llm.generate("chat", { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.1, maxOutputTokens: policy.maxTokens } });
  if (!out.ok) return { ok: false, reason: out.reason };
  if (typeof llm.stream !== "function" && out.text) gate.push(out.text);
  gate.end();
  return { ok: true, text: normalizeCitations(String(out.text || "").trim()), provider: out.provider || provider, model: out.model || model, steps: policy.maxSteps };
}

/** After a deterministic retrieval, have the model write from the data. */
async function writeFromData({ llm, system, contents, toolkit, gate, send, signal }) {
  send("status", { stage: "writing", detail: "Writing the answer from your records" });
  const views = toolkit.results.map((r, i) => `Tool ${r.name} result: ${viewJson(toolViewOf(toolkit, i))}`).join("\n\n");
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [...contents, { role: "user", parts: [{ text: `Records retrieved for this question (tool results):\n${views}\n\nAnswer the question from these results only, in the required format.` }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1200, lowLatency: true },
  };
  const out = typeof llm.stream === "function" ? await llm.stream("chat", body, { onText: (t) => gate.push(t), signal }) : await llm.generate("chat", body);
  if (!out.ok) return { ok: false };
  if (typeof llm.stream !== "function" && out.text) gate.push(out.text);
  gate.end();
  return { ok: true, text: normalizeCitations(String(out.text || "").trim()) };
}

async function retryWrite({ llm, toolkit, answerText, violations, gate, signal, today, route, resolved, context, memory, text, opts, scopeText }) {
  const system = fill(prompt("agent.v2"), { TODAY: today, CONTEXT: contextBlock({ route, resolved, context, plan: [], memory, opts, scopeText }) });
  const views = toolkit.results.map((r, i) => `Tool ${r.name} result: ${viewJson(toolViewOf(toolkit, i))}`).join("\n\n");
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{
      role: "user",
      parts: [{ text: `Question: ${text}\n\nTool results:\n${views}\n\nYour previous draft:\n${answerText}\n\nProblems found by the checker:\n- ${violations.join("\n- ")}\n\nRewrite the answer fixing every problem. Use only figures present in the tool results (or computed by calculate), cite only [S#] refs from the results, and never claim an action was taken.` }],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 1200, lowLatency: true },
  };
  const out = typeof llm.stream === "function" ? await llm.stream("chat", body, { onText: (t) => gate.push(t), signal }) : await llm.generate("chat", body);
  if (!out.ok) return { ok: false };
  if (typeof llm.stream !== "function" && out.text) gate.push(out.text);
  gate.end();
  return { ok: true, text: normalizeCitations(String(out.text || "").trim()) };
}

// The toolkit keeps model-facing views on each run's return value; we store
// the structured data, which is what the writer needs.
const toolViewOf = (toolkit, i) => toolkit.results[i]?.data ?? { missing: toolkit.results[i]?.missing };

/* ======================================================= streaming gate */

/**
 * Emits model text as `delta` events line by line, but only after each
 * complete line passes the numeric-grounding and citation check. The first
 * failing line stops the stream; the pipeline then resets and rewrites.
 */
export class StreamGate {
  constructor({ bank, sources, send }) {
    this.bank = bank;
    this.sources = sources;
    this.send = send;
    this.buffer = "";
    this.emitted = false;
    this.failed = false;
  }

  push(text) {
    if (this.failed) return;
    this.buffer += text;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx + 1);
      this.buffer = this.buffer.slice(idx + 1);
      if (!this.ok(line)) {
        this.failed = true;
        return;
      }
      this.emit(line);
    }
  }

  end() {
    if (!this.failed && this.buffer) {
      if (this.ok(this.buffer)) this.emit(this.buffer);
      else this.failed = true;
    }
    this.buffer = "";
  }

  ok(line) {
    const claims = extractClaims(line, { identifiers: [...this.bank.identifiers] });
    if (claims.some((c) => !this.bank.supports(c))) return false;
    for (const m of line.matchAll(/\[S(\d+)\]/g)) if (!this.sources.get(`S${m[1]}`)) return false;
    return true;
  }

  emit(text) {
    this.emitted = true;
    this.send("delta", { text });
  }

  discard() {
    this.buffer = "";
    this.emitted = false;
    this.failed = false;
  }
}

/* ======================================================= resolution */

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The supplier search hit that the mention names (substring either way). */
export function pickSupplier(items, mention) {
  const q = norm(mention);
  if (!q) return null;
  const suppliers = (items || []).filter((i) => i.kind === "supplier");
  const named = suppliers.filter((i) => {
    const n = norm(i.name);
    return n && (n.includes(q) || q.includes(n) || n.split(" ").slice(0, 2).join(" ") === q.split(" ").slice(0, 2).join(" "));
  });
  if (named.length === 1) return named[0];
  if (named.length > 1) return named.find((i) => norm(i.name) === q) || null;
  return suppliers.length === 1 ? suppliers[0] : null;
}

const PRONOUN = /\b(them|they|their|it|this|that|these|those|same|him|her|the supplier|this supplier|that invoice|this invoice|this case|that case)\b/i;
const SUPPLIER_INTENTS = new Set(["supplier_balance", "draft_message", "payments"]);
const CASE_INTENTS = new Set(["decision", "assign", "reminder", "case_status", "explain_finding"]);

async function resolveEntities({ toolkit, route, context, focus, text }) {
  const e = route.entities;
  const resolved = {
    caseId: e.caseIds[0] || null,
    supplierId: e.supplierIds[0] || null,
    findingId: e.findingIds[0] || null,
    documentId: null,
    paymentId: e.paymentIds[0] || null,
  };
  const lookups = [];
  for (const ref of e.docRefs.slice(0, 2)) lookups.push({ kind: "doc", q: ref });
  for (const utr of e.utrs.slice(0, 1)) lookups.push({ kind: "utr", q: utr });
  if (!resolved.supplierId) for (const name of e.suppliers.slice(0, 2)) lookups.push({ kind: "supplier", q: name });
  const results = await Promise.all(lookups.map((l) => toolkit.run("search_records", { query: l.q, ...(l.kind === "utr" ? { type: "PAYMENT_OUT" } : {}) })));
  const ambiguous = [];
  results.forEach((r, i) => {
    const l = lookups[i];
    const docs = r.data?.documents || [];
    const sups = r.data?.suppliers || [];
    if (l.kind === "doc" || l.kind === "utr") {
      const exact = docs.find((d) => norm(d.number) === norm(l.q)) || (docs.length === 1 ? docs[0] : null) || docs.find((d) => norm(d.number).endsWith(norm(l.q)));
      if (exact) {
        if (/^PAYMENT|^ADVANCE/.test(exact.type)) resolved.paymentId ||= exact.id;
        else resolved.documentId ||= exact.id;
        resolved.caseId ||= exact.caseId || null;
        resolved.supplierId ||= exact.supplierId || null;
        resolved.docType ||= exact.type;
      } else if (docs.length > 1) ambiguous.push({ mention: l.q, items: docs.map((d) => ({ id: d.id, label: d.number, hint: `${d.type} · ${d.supplier || ""}`.trim() })) });
    } else {
      const hit = pickSupplier(sups, l.q);
      if (hit) resolved.supplierId ||= hit.id;
      else if (sups.length > 1) ambiguous.push({ mention: l.q, items: sups.map((s) => ({ id: s.id, label: s.name, hint: s.gstin || "" })) });
    }
  });
  // page context ("Explain this" deep links) and conversation focus
  resolved.caseId ||= context.caseId || null;
  resolved.documentId ||= context.documentId || null;
  resolved.supplierId ||= context.supplierId || null;
  const named = e.docRefs.length || e.suppliers.length || e.caseIds.length || e.utrs.length;
  if (!named || PRONOUN.test(text)) {
    if (SUPPLIER_INTENTS.has(route.intent) || CASE_INTENTS.has(route.intent) || PRONOUN.test(text)) {
      resolved.supplierId ||= focus.supplierId || null;
      resolved.caseId ||= focus.caseId || null;
      resolved.documentId ||= focus.documentId || null;
      resolved.paymentId ||= focus.paymentId || null;
    }
  }
  if (!resolved.caseId && resolved.documentId) {
    const known = toolkit.results.flatMap((r) => r.data?.documents || []).find((d) => d.id === resolved.documentId);
    resolved.caseId = known?.caseId || null;
  }
  if (ambiguous.length && !(resolved.supplierId && SUPPLIER_INTENTS.has(route.intent)) && !resolved.documentId) {
    const first = ambiguous[0];
    return {
      ...resolved,
      clarify: {
        content: `**I found more than one match for "${first.mention}". Which one do you mean?**`,
        options: first.items.slice(0, 6).map((item) => ({ id: item.id, label: item.label, hint: item.hint, action: text.replace(first.mention, item.label) })),
      },
    };
  }
  if (SUPPLIER_INTENTS.has(route.intent) && !resolved.supplierId) resolved.needs = e.suppliers.length ? `which supplier — I couldn't find "${e.suppliers[0]}"` : "which supplier you mean";
  if (["decision", "assign", "reminder"].includes(route.intent) && !resolved.caseId) resolved.needs = "the PO or case you mean";
  return resolved;
}

/* ======================================================= context */

function contextBlock({ route, resolved, context, plan, memory, opts = normalizeOptions({}), scopeText = null }) {
  const ids = Object.entries(resolved)
    .filter(([k, v]) => v && typeof v === "string" && k !== "needs")
    .map(([k, v]) => `${k}=${v}`)
    .concat((resolved.attachmentIds || []).map((id) => `attachmentId=${id}`))
    .join(", ");
  return [
    `Page: ${context.page || "/app/ask"}${context.entityId ? ` · entity ${context.entityId}` : ""}`,
    `Router guess: ${route.intent} (${route.reason})`,
    ids ? `Already resolved ids (use them, no need to search): ${ids}` : "No ids resolved yet.",
    resolved.needs ? `Missing: ${resolved.needs}` : "",
    plan.length ? `Suggested tools: ${plan.map((p) => `${p.tool}(${JSON.stringify(p.args)})`).join("; ")}` : "",
    memory.summary ? `Conversation so far (summary): ${memory.summary}` : "",
    optionsPrompt(opts, { scopeLabel: scopeText }),
  ].filter(Boolean).join("\n");
}

/** Last turns as alternating user/model text (old [S#] refs removed). */
function historyContents(memory) {
  const out = [];
  for (const t of (memory.turns || []).slice(-4)) {
    const role = t.role === "assistant" ? "model" : "user";
    const textPart = String(t.content || "").replace(/\[S\d+\]/g, "").slice(0, 700);
    if (!out.length && role === "model") continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += `\n${textPart}`;
    else out.push({ role, parts: [{ text: textPart }] });
  }
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

function dataByTool(results) {
  const out = {};
  for (const r of results) if (r.data) out[r.name] = r.data;
  return out;
}

function collectIdentifiers(results) {
  const out = new Set();
  const walk = (v, depth, key = "") => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") {
      if (/\d/.test(v) && v.length <= 60 && /(number|invoice|utr|id|gstin|code|label|name|supplier|title)$/i.test(key)) out.add(v);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1, key));
    if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, depth + 1, k);
  };
  for (const r of results) walk(r.data, 0);
  return [...out];
}

/* ------------------------------------------------- back-compat exports */
const SUPPLIER_LEVEL_RE = /\b(owe|owed|owing|outstanding|balance|payable|paid|pay\b|how much|dues?|due to|pending (?:amount|payment)|account with|statement)\b/i;
export const isSupplierLevelQuestion = (text) => SUPPLIER_LEVEL_RE.test(String(text || ""));
