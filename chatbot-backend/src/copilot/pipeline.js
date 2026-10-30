// pipeline.js — "Evidence-first agentic GraphRAG" copilot (P2-C4).
// Stages: guard → understand → resolve → retrieve (agentic loop, or
// deterministic seeded retrieval when the LLM is down) → check → write →
// validate → stream. Numbers come from tools, language from the LLM, and a
// validator sits between them. Emits contract SSE events via send().

import { FactRegistry } from "./facts.js";
import { understand } from "./understand.js";
import { validateAnswer, collectIdentifiers } from "./validate.js";
import { deterministicAnswer } from "./templates.js";
import { createTools } from "./tools/index.js";
import { workingMemory, refreshSummary } from "./memory.js";
import { prompt, fill } from "./promptLoader.js";

const MAX_MESSAGE = 2000;
const MAX_ROUNDS = 4;
const MAX_TOOL_CALLS = 8;
const RETRIEVE_BUDGET_MS = 20_000;
const CONTROL_CHARS = /[-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const stripControl = (text) => String(text || "").replace(CONTROL_CHARS, " ").slice(0, MAX_MESSAGE);

/**
 * @param {object} o
 * @param {string} o.message raw user text
 * @param {object} o.context {page, caseId?, documentId?, supplierId?, entityId?}
 * @param {object} o.auth {userId, roles:Set, groupId}
 * @param {object} o.llm gateway-like {generate(task, body)}
 * @param {Function} o.call serverCall (user JWT already bound)
 * @param {object} [o.rag] hybrid search {search(groupId,q,k), searchHelp}
 * @param {object} [o.store] ConversationStore
 * @param {object} [o.conversation] loaded conversation doc
 * @param {Function} [o.send] SSE emitter (event, data)
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<object>} final answer payload
 */
export async function runCopilot({
  message,
  context = {},
  auth,
  llm,
  call,
  rag = null,
  store = null,
  conversation = null,
  send = () => {},
  signal,
}) {
  const registry = new FactRegistry();
  const retrieved = {}; // tool name -> last data (for templates + identifiers)
  const missing = [];
  const toolLog = [];

  /* ---- 1. Guard -------------------------------------------------------- */
  const cleanMessage = stripControl(message);
  if (!cleanMessage.trim()) {
    return finish({ answerType: "clarification", content: "Ask me a question about your purchase orders, receipts, invoices, payments or deadlines.", certainty: "CONFIRMED" });
  }

  const scope = { groupId: auth?.groupId || context.groupId, entityId: context.entityId, userId: auth?.userId };
  const tools = createTools({ call, rag, scope });
  const toolCtx = { registry };
  const memory = workingMemory(conversation);
  const runTool = async (name, args) => {
    const started = Date.now();
    const result = await tools[name].run(args, { registry });
    toolLog.push({ name, args: sanitizeArgs(args), ms: Date.now() - started, ok: !result.missing });
    send("tool", { name, args: sanitizeArgs(args), ms: Date.now() - started, ok: !result.missing });
    retrieved[name] = result.data;
    if (result.missing) missing.push(result.missing);
    return result;
  };

  /* ---- 2. Understand --------------------------------------------------- */
  send("status", { stage: "understanding", detail: "Reading your question" });
  const contextText = `page=${context.page || "ask"} caseId=${context.caseId || ""} documentId=${context.documentId || ""} supplierId=${context.supplierId || ""} memoryFocus=${JSON.stringify(memory.focusEntities || {})} memorySummary=${memory.summary || ""}`;
  const intent = await understand(llm, { message: cleanMessage, contextText });

  if (intent.needsClarification && intent.clarificationQuestion) {
    return finish({
      answerType: "clarification",
      content: intent.clarificationQuestion,
      certainty: "CONFIRMED",
    });
  }
  if (intent.intent === "out_of_scope") {
    return finishFromTemplate(intent.intent, registry, { retrieved, missing });
  }

  /* ---- 3. Resolve ------------------------------------------------------ */
  const resolved = { caseId: context.caseId, documentId: context.documentId, supplierId: context.supplierId };
  const mentions = [
    ...(intent.entities.docRefs || []).map((v) => ({ q: v, type: null })),
    ...(intent.entities.poNumbers || []).map((v) => ({ q: v, type: "PO" })),
    ...(intent.entities.invoiceNumbers || []).map((v) => ({ q: v, type: "INVOICE_IN" })),
    ...(intent.entities.grnNumbers || []).map((v) => ({ q: v, type: "GRN" })),
    ...(intent.entities.suppliers || []).map((v) => ({ q: v, type: null })),
  ];
  // Drop shadowed mentions: a supplier/generic token contained in a doc ref
  // ("SATYAD" inside "SATYAD/PO/26-27/100009") must not re-clarify after the
  // exact doc already resolved.
  const docQs = [...(intent.entities.docRefs || []), ...(intent.entities.poNumbers || []), ...(intent.entities.invoiceNumbers || []), ...(intent.entities.grnNumbers || [])];
  const unshadowed = mentions.filter((m) => !docQs.some((q) => q !== m.q && q.includes(m.q)));
  const resolutionOptions = [];
  for (const m of unshadowed.slice(0, 4)) {
    const r = await runTool("search_records", { query: m.q, type: m.type || undefined });
    const items = r.data?.items || [];
    // If the message names one candidate verbatim (option pick, or the user
    // typed a full number), resolve it instead of asking again.
    const direct = items.length > 1 && items.find((i) => i.number && cleanMessage.includes(i.number));
    if (direct) {
      resolved.documentId ||= direct.id;
      if (direct.type === "PO") resolved.caseId ||= direct.id;
      continue;
    }
    if (items.length > 1) resolutionOptions.push({ mention: m.q, items });
    else if (items.length === 1) {
      if (items[0].kind === "supplier") resolved.supplierId ||= items[0].id;
      else {
        resolved.documentId ||= items[0].id;
        if (items[0].type === "PO") resolved.caseId ||= items[0].id;
      }
    }
  }
  // Never clarify once a document is resolved — remaining ambiguity in other
  // mentions is noise, not a question.
  const stillAmbiguous = resolutionOptions.filter((o) => !resolved.documentId);
  if (stillAmbiguous.length) {
    return finish({
      answerType: "clarification",
      content: `I found more than one match for ${resolutionOptions.map((o) => o.mention).join(", ")}. Which one do you mean?`,
      options: resolutionOptions.flatMap((o) =>
        o.items.slice(0, 5).map((i) => ({ id: i.id, label: i.number || i.name || i.id, kind: i.kind, hint: i.supplier || i.name })),
      ),
      certainty: "AMBIGUOUS",
    });
  }
  // Pronoun/context fallback: reuse focus when nothing explicit resolved.
  if (!resolved.caseId && !resolved.documentId) {
    resolved.caseId = memory.focusEntities?.caseId || null;
    resolved.documentId = memory.focusEntities?.documentId || null;
  }

  /* ---- 4. Retrieve (agentic loop or seeded deterministic) --------------- */
  send("status", { stage: "retrieving", detail: "Pulling the matching records" });
  const namedUnfound = mentions.length && !resolved.documentId && !resolved.caseId && !resolved.supplierId
    ? `the record named in the question`
    : null;

  // Resolved doc + simple intent → deterministic retrieve; the LLM tool loop
  // (up to 4 rounds) is only worth the calls for reasoning-heavy intents.
  const SIMPLE = new Set(["status", "lookup", "why_amount", "summary"]);
  const skipAgentic = (resolved.documentId || resolved.caseId) && SIMPLE.has(intent.intent);
  const llmAlive = skipAgentic ? false : await agenticRetrieve({ llm, tools, toolCtx, runTool, intent, message: cleanMessage, resolved, send, signal });
  if (!llmAlive) await seededRetrieve({ runTool, intent, resolved, scope, registry });

  /* ---- 4b. Surface retrieved records as evidence + focus ---------------- */
  // Facts were registered per-tool, but documents themselves often weren't —
  // this guarantees citations, the sources panel and graphRef for any path.
  const docPool = collectDocs(retrieved);
  for (const d of [...docPool.values()].slice(0, 8)) {
    registry.addEvidence({
      evidenceId: d.id,
      label: `${d.type || "record"} ${d.number || d.externalRef || d.id}`.trim(),
      documentId: d.id,
    });
  }
  if (!resolved.documentId && !resolved.caseId) {
    const first = [...docPool.values()][0];
    if (first) {
      resolved.documentId = first.id;
      if (first.type === "PO") resolved.caseId = first.id;
    }
  }

  /* ---- 5. Check (sufficiency) ------------------------------------------ */
  send("status", { stage: "checking", detail: "Checking the evidence covers the answer" });
  const need = requiredSlots(intent.intent);
  let covered = haveSlots(need, { registry, retrieved });
  if (!covered) {
    // one targeted follow-up before conceding
    await targetedRetrieve({ runTool, intent, resolved, scope });
    covered = haveSlots(need, { registry, retrieved });
  }
  if (!covered) {
    missing.push(need.missing || `evidence for "${intent.intent}"`);
    if (namedUnfound) missing.push(namedUnfound);
  }

  /* ---- 6. Write (LLM, then validate; fallback to template) -------------- */
  send("status", { stage: "writing", detail: "Drafting the answer from evidence" });
  const draft = await writeAnswer({ llm, intent, message: cleanMessage, registry, memory, retrieved });
  let responseMode = "grounded_ai";
  let final = null;
  if (draft) {
    const identifiers = collectIdentifiers(retrieved).concat(
      Object.values(intent.entities).flat(),
      [context.caseId, context.documentId].filter(Boolean),
    );
    const verdict = validateAnswer(draft, registry, { identifiers });
    if (verdict.ok) {
      final = draft;
    } else {
      const retry = await writeAnswer({ llm, intent, message: cleanMessage, registry, memory, retrieved, violations: verdict.violations });
      if (retry && validateAnswer(retry, registry, { identifiers }).ok) final = retry;
    }
  }
  if (!final) {
    responseMode = "evidence_only";
    const t = deterministicAnswer(intent.intent, registry, {
      retrieved,
      missing,
      findings: retrieved.list_findings?.items || (retrieved.explain_finding ? [retrieved.explain_finding] : []),
      deadlines: retrieved.get_compliance_deadlines?.deadlines,
      helpSnippets: retrieved.search_help?.hits,
      calculation: calculationFacts(registry),
      draft: draftText(registry, retrieved, intent),
    });
    final = t;
  }

  return finish({
    answerType: intent.needsClarification ? "clarification" : answerTypeFor(intent.intent, covered),
    content: final.answerMarkdown,
    certainty: final.certainty || registry.weakestCertainty(),
    suggestedFollowUps: final.followUps || [],
    cards: final.cards || [],
    responseMode: final.responseMode || responseMode,
    missingEvidence: missing.length ? missing : undefined,
    focus: { caseId: resolved.caseId, documentId: resolved.documentId, supplierId: resolved.supplierId },
    toolCalls: toolLog,
    intent: intent.intent,
  });

  /* ---- helpers ---------------------------------------------------------- */
  function finish(result) {
    return finalize(result, { registry, conversation, store, auth, message: cleanMessage, toolLog, llm });
  }

  function finishFromTemplate(intentName, reg, ctx) {
    const t = deterministicAnswer(intentName, reg, ctx);
    return finish({
      answerType: intentName === "out_of_scope" ? "refusal" : "answer",
      content: t.answerMarkdown,
      certainty: t.certainty,
      suggestedFollowUps: t.followUps,
      responseMode: "evidence_only",
      toolCalls: toolLog,
      intent: intentName,
    });
  }
}

/* ---------- agentic retrieval ------------------------------------------ */

async function agenticRetrieve({ llm, tools, toolCtx, runTool, intent, message, resolved, send, signal }) {
  const declarations = Object.values(tools).map((t) => t.declaration);
  const seed = `User question: <record>${message}</record>\nIntent: ${intent.intent}\nResolved ids: ${JSON.stringify(resolved)}\nEntities mentioned: ${JSON.stringify(intent.entities)}\nCall the tools needed to gather the evidence for this answer. Stop when you have enough.`;
  const contents = [{ role: "user", parts: [{ text: seed }] }];
  const started = Date.now();
  let calls = 0;
  for (let round = 0; round < MAX_ROUNDS && calls < MAX_TOOL_CALLS && Date.now() - started < RETRIEVE_BUDGET_MS; round++) {
    if (signal?.aborted) break;
    const out = await llm.generate("understand", {
      contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: { temperature: 0, maxOutputTokens: 1200 },
    });
    if (!out.ok) return false;
    const parts = out.raw?.candidates?.[0]?.content?.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    if (!fnCalls.length) return true;
    contents.push({ role: "model", parts });
    const responses = [];
    for (const fc of fnCalls) {
      if (calls >= MAX_TOOL_CALLS || Date.now() - started >= RETRIEVE_BUDGET_MS) break;
      const tool = tools[fc.name];
      if (!tool) {
        responses.push({ functionResponse: { name: fc.name, response: { name: fc.name, content: { error: "unknown tool" } } } });
        continue;
      }
      calls += 1;
      let result;
      try {
        result = await runTool(fc.name, fc.args || {});
      } catch (error) {
        result = { data: null, missing: `${fc.name} failed (${error.message})` };
      }
      responses.push({
        functionResponse: {
          name: fc.name,
          response: { name: fc.name, content: { data: result.data, missing: result.missing || null } },
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }
  return true;
}

/* ---------- deterministic seeded retrieval (evidence-only path) -------- */

async function seededRetrieve({ runTool, intent, resolved, scope, registry }) {
  const eid = resolved.entityId || scope.entityId;
  switch (intent.intent) {
    case "status":
    case "lookup":
      if (resolved.caseId) await runTool("get_case_context", { caseId: resolved.caseId });
      else if (resolved.documentId) {
        await runTool("get_document", { documentId: resolved.documentId });
        await runTool("get_line_lifecycle", { poId: resolved.documentId });
      } else if (eid) await runTool("dashboard_today", { entityId: eid });
      break;
    case "why_amount":
    case "compare":
    case "analytics":
      if (resolved.caseId) await runTool("get_case_context", { caseId: resolved.caseId });
      else if (eid) await runTool("dashboard_today", { entityId: eid });
      await runTool("list_findings", { entityId: eid, caseId: resolved.caseId });
      break;
    case "explain_finding":
      await runTool("list_findings", { entityId: eid, caseId: resolved.caseId, status: "open" });
      break;
    case "compliance":
      if (eid) await runTool("get_compliance_deadlines", { entityId: eid });
      break;
    case "how_to":
      await runTool("search_help", { query: intent.entities.items?.[0] || intent.clarificationQuestion || "procurement documents" });
      break;
    case "draft_message":
      if (resolved.supplierId) await runTool("get_supplier_summary", { supplierId: resolved.supplierId });
      if (resolved.caseId) await runTool("get_case_context", { caseId: resolved.caseId });
      break;
    case "what_if":
      if (resolved.caseId) await runTool("run_scenario", { caseId: resolved.caseId, changes: [] });
      break;
    default:
      if (resolved.caseId) await runTool("get_case_context", { caseId: resolved.caseId });
      else if (eid) await runTool("dashboard_today", { entityId: eid });
  }
  void registry;
}

async function targetedRetrieve({ runTool, intent, resolved, scope }) {
  // Last-resort fetch for missing slots: focus doc/case, else entity dashboard.
  if (resolved.caseId && !resolved._caseFetched) {
    await runTool("get_case_context", { caseId: resolved.caseId });
    resolved._caseFetched = true;
    return;
  }
  if (resolved.documentId) return runTool("get_document", { documentId: resolved.documentId });
  const eid = scope.entityId;
  if (eid) return runTool("dashboard_today", { entityId: eid });
}

/* ---------- write ------------------------------------------------------- */

async function writeAnswer({ llm, intent, message, registry, memory, retrieved, violations = [] }) {
  const contextJson = JSON.stringify({
    facts: registry.asPromptMap(),
    evidence: [...registry.evidence.values()].map((e) => ({ n: `E${e.n}`, label: e.label, documentId: e.documentId })),
    identifiers: collectIdentifiers(retrieved).slice(0, 80),
    records: slimRecords(retrieved),
    memory: { summary: memory.summary, recent: memory.turns.map((t) => `${t.role}: ${t.content.slice(0, 300)}`) },
  });
  const taskPrompt = fill(prompt("write.v1"), {
    QUESTION: message,
    INTENT: intent.intent,
    CONTEXT: contextJson,
    VIOLATIONS: violations.length ? `VIOLATIONS TO FIX: ${violations.join("; ")}` : "",
  });
  const systemText = intent.intent === "draft_message"
    ? `${prompt("system.v1")}\n\n${prompt("draft_message.v1")}`
    : prompt("system.v1");
  const out = await llm.generate("chat", {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: [{ text: taskPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1800,
      responseMimeType: "application/json",
    },
  });
  if (!out.ok) return null;
  try {
    const parsed = JSON.parse(String(out.text).replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (typeof parsed.answerMarkdown !== "string") return null;
    return {
      answerMarkdown: parsed.answerMarkdown,
      certainty: parsed.certainty,
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 3) : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards.slice(0, 4) : undefined,
    };
  } catch {
    return null;
  }
}

/* ---------- slots & misc ------------------------------------------------ */

const REQUIRED = {
  status: { test: (reg) => reg.factIds().length > 0, missing: "order/delivery records" },
  lookup: { test: (reg, ret) => Boolean(ret.get_document || ret.get_case_context || ret.search_records?.items?.length), missing: "the record asked for" },
  why_amount: { test: (reg) => [...reg.facts.values()].some((f) => f.unit === "INR"), missing: "the figures behind that amount" },
  explain_finding: { test: (reg, ret) => Boolean(ret.list_findings?.items?.length || ret.explain_finding), missing: "a matching finding" },
  compliance: { test: (reg, ret) => Boolean(ret.get_compliance_deadlines || ret.dashboard_today), missing: "compliance deadlines" },
  analytics: { test: (reg) => reg.factIds().length >= 1, missing: "summary figures" },
  how_to: { test: (reg, ret) => Boolean(ret.search_help?.hits?.length), missing: "help text" },
  draft_message: { test: (reg, ret) => Boolean(ret.get_supplier_summary || ret.get_case_context || ret.search_records?.items?.length), missing: "the supplier or document for the draft" },
  what_if: { test: (reg, ret) => Boolean(ret.run_scenario), missing: "the scenario result" },
};

function requiredSlots(intent) {
  return REQUIRED[intent] || { test: () => true };
}
function haveSlots(need, { registry, retrieved }) {
  return need.test(registry, retrieved);
}
function answerTypeFor(intent, covered) {
  if (!covered) return "partial";
  return { status: "status", lookup: "record", explain_finding: "finding", why_amount: "breakdown", compliance: "compliance", how_to: "help", draft_message: "draft", smalltalk: "answer" }[intent] || "answer";
}
function calculationFacts(registry) {
  return [...registry.facts.values()].map((f) => ({ step: f.label, factId: f.id }));
}
function draftText(registry, retrieved, intent) {
  if (intent.intent !== "draft_message") return null;
  const supplier = retrieved.get_supplier_summary?.name || retrieved.search_records?.items?.find((i) => i.kind === "supplier")?.name || "the supplier";
  const refs = [...registry.facts.values()].filter((f) => f.label).slice(0, 4).map((f) => `{{${f.id}}}`).join(", ");
  return `Draft message for ${supplier} — copy and send yourself:\n\nSubject: Clarification needed on our records\n\nDear ${supplier} team,\n\nWhile checking our records we found items we can't match yet (${refs || "the referenced documents"}). Please share the supporting document (remittance advice, credit note, or PO reference as applicable) so we can complete the reconciliation.\n\nRegards,\nAccounts team`;
}
/** Pull document-shaped objects out of tool payloads at any depth. */
const collectDocs = (retrieved) => {
  const out = new Map();
  const walk = (v, depth) => {
    if (!v || typeof v !== "object" || depth > 4) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (v.id && (v.number || v.externalRef || v.type)) { out.set(v.id, v); return; }
    for (const key of ["items", "documents", "document", "nodes", "po", "invoice"]) if (v[key]) walk(v[key], depth + 1);
  };
  for (const data of Object.values(retrieved)) walk(data, 0);
  return out;
};

const slimRecords = (retrieved) =>
  Object.fromEntries(Object.entries(retrieved).map(([k, v]) => [k, JSON.stringify(v).slice(0, 1500)]));
const sanitizeArgs = (args) =>
  Object.fromEntries(Object.entries(args || {}).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 120) : v]));

/* ---------- finalize ---------------------------------------------------- */

async function finalize(result, { registry, conversation, store, auth, message, toolLog, llm }) {
  const content = registry.render(result.content);
  const payload = {
    content,
    answerType: result.answerType || "answer",
    certainty: result.certainty || registry.weakestCertainty(),
    // When the writer skipped [E#] markers, still surface the evidence used —
    // labeled as sources, not inline cites.
    citations: registry.citations(result.content).length
      ? registry.citations(result.content)
      : [...registry.evidence.values()].slice(0, 6).map((e) => ({ n: e.n, evidenceId: e.evidenceId, label: e.label, documentId: e.documentId, href: e.href })),
    facts: registry.forAnswer(),
    // Fill missing card values from the fact registry — the LLM often emits
    // label+detail but drops the number it was given.
    cards: (result.cards || []).map((c) => {
      if (c?.value) return c;
      const fact = [...registry.facts.values()].find((f) => f.label.toLowerCase().includes((c?.label || "").toLowerCase()) || (c?.label || "").toLowerCase().includes(f.label.toLowerCase()));
      return { ...c, value: fact ? fact.value : c?.value };
    }),
    suggestedFollowUps: result.suggestedFollowUps || [],
    options: result.options,
    responseMode: result.responseMode || "evidence_tools",
    missingEvidence: result.missingEvidence,
    toolCalls: toolLog,
    intent: result.intent,
    queriedAt: new Date().toISOString(),
  };
  if (result.focus) payload.graphRef = result.focus;

  // Persist the turn (conversations are C-owned).
  if (store && auth?.userId) {
    try {
      let conv = conversation;
      if (!conv) conv = await store.create({ userId: auth.userId, groupId: auth.groupId, title: message });
      await store.appendMessages(conv.id, { userId: auth.userId, groupId: auth.groupId }, [
        { role: "user", content: message, at: payload.queriedAt },
        { role: "assistant", content: payload.content, citations: payload.citations, toolCalls: toolLog, responseMode: payload.responseMode, at: payload.queriedAt },
      ]);
      if (result.focus && (result.focus.caseId || result.focus.documentId || result.focus.supplierId)) {
        await store.update(conv.id, { focusEntities: result.focus });
      }
      payload.conversationId = conv.id;
      void refreshSummary(llm, store, conv).catch(() => {});
    } catch {
      /* persistence is best-effort */
    }
  }
  return payload;
}
