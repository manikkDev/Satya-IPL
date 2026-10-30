// tools/index.js — the copilot tool set (contract §7 SSE `tool` events, 05 §4
// stage 4). Each tool is a thin wrapper over a server v2 GET endpoint called
// with the user's JWT, plus read-only RAG search. Tools return
// {data, facts, evidence, missing?} and register display facts on the shared
// registry — numbers never come from the LLM.

const s = (v) => (v == null ? "" : String(v));
const money = (m) => (m && typeof m === "object" ? m.amount : m);

function factMoney(registry, label, m, extra = {}) {
  const amount = money(m);
  if (amount == null || amount === "") return null;
  return registry.addFact({ label, value: s(amount), unit: "INR", ...extra });
}
function factQty(registry, label, v, uom, extra = {}) {
  if (v == null || v === "") return null;
  return registry.addFact({ label, value: s(v), unit: uom || "COUNT", ...extra });
}
function factDate(registry, label, v, extra = {}) {
  if (!v) return null;
  return registry.addFact({ label, value: s(v).slice(0, 10), unit: "DATE", ...extra });
}

const evd = (registry, e) =>
  e && registry.addEvidence({
    evidenceId: e.id || e.evidenceId || `ev-${Math.random().toString(36).slice(2)}`,
    label: e.label || `${e.documentType || ""} ${e.field || ""}`.trim() || "source evidence",
    documentId: e.documentId,
    locator: e.locator,
  });

/**
 * @param {object} deps
 * @param {Function} deps.call serverCall(path, opts) → {ok,status,data}
 * @param {object} [deps.rag] {search(groupId, q, k), searchHelp(q, k)}
 * @param {object} deps.scope {groupId, entityId?, userId}
 */
export function createTools({ call, rag = null, scope = {} }) {
  const tools = {};

  tools.get_case_context = {
    declaration: {
      name: "get_case_context",
      description: "Get an investigation case with its latest snapshot: ledger balances, findings, ambiguities. Use for questions about a PO/order/case overall.",
      parameters: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
    },
    async run({ caseId }, { registry }) {
      const r = await call(`/api/v2/cases/${encodeURIComponent(caseId)}`);
      if (!r.ok) return { data: null, missing: `case ${caseId} (${r.error})` };
      const snap = r.data?.snapshot || r.data?.latestSnapshot || r.data;
      const ledger = snap?.ledger || {};
      const docIds = r.data?.subjectIds || [];
      factQty(registry, "ordered", ledger.ordered, null, { documentIds: docIds });
      factQty(registry, "received", ledger.received, null, { documentIds: docIds });
      factQty(registry, "accepted", ledger.accepted, null, { documentIds: docIds });
      factQty(registry, "invoiced", ledger.invoiced, null, { documentIds: docIds });
      factMoney(registry, "settled", ledger.settled, { documentIds: docIds });
      factMoney(registry, "recordedOutstanding", ledger.recordedOutstanding, { documentIds: docIds });
      factMoney(registry, "supportedOutstanding", ledger.supportedOutstanding, { documentIds: docIds });
      factMoney(registry, "canonicalOutstanding", ledger.canonicalOutstanding, { documentIds: docIds });
      for (const e of (snap?.evidence || []).slice(0, 20)) evd(registry, e);
      return { data: { case: pick(r.data, ["id", "title", "status", "kind"]), ledger, findings: (snap?.findings || []).map(slimFinding), ambiguities: snap?.ambiguities || [] } };
    },
  };

  tools.get_document = {
    declaration: {
      name: "get_document",
      description: "Fetch one document (PO, invoice, GRN, payment…) by id with its lifecycle and links.",
      parameters: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"] },
    },
    async run({ documentId }, { registry }) {
      const r = await call(`/api/v2/documents/${encodeURIComponent(documentId)}`);
      if (!r.ok) return { data: null, missing: `document ${documentId} (${r.error})` };
      const d = r.data?.document || r.data;
      factMoney(registry, `${d.type || "document"} ${d.number || documentId} total`, d.totals?.grand, { documentIds: [d.id] });
      factDate(registry, `${d.type || "document"} ${d.number || ""} date`, d.date, { documentIds: [d.id] });
      return { data: slimDoc(d, r.data) };
    },
  };

  tools.get_line_lifecycle = {
    declaration: {
      name: "get_line_lifecycle",
      description: "Per-PO-line lifecycle quantities: ordered/received/accepted/rejected/invoiced/paid/open. Use for delivery status and partial delivery questions.",
      parameters: { type: "object", properties: { poId: { type: "string", description: "PO document id or case subject id" } }, required: ["poId"] },
    },
    async run({ poId }, { registry }) {
      const r = await call(`/api/v2/documents/${encodeURIComponent(poId)}`);
      if (!r.ok) return { data: null, missing: `PO ${poId} (${r.error})` };
      const lines = r.data?.lifecycle || r.data?.lines || [];
      for (const line of lines) {
        const tag = `line ${line.lineNo}`;
        factQty(registry, `${tag} ordered`, line.ordered, null, { documentIds: [poId] });
        factQty(registry, `${tag} received`, line.received, null, { documentIds: [poId] });
        factQty(registry, `${tag} accepted`, line.accepted, null, { documentIds: [poId] });
        factQty(registry, `${tag} open`, line.open, null, { documentIds: [poId] });
      }
      return { data: { poId, lines } };
    },
  };

  tools.list_findings = {
    declaration: {
      name: "list_findings",
      description: "List flagged issues (duplicates, mismatches, missing records) with severity, certainty and exposure. Filters: entityId, caseId, severity, status.",
      parameters: { type: "object", properties: { entityId: { type: "string" }, caseId: { type: "string" }, severity: { type: "string" }, status: { type: "string" } } },
    },
    async run(args, { registry }) {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(args).filter(([, v]) => v))).toString();
      const r = await call(`/api/v2/findings${q ? `?${q}` : ""}`);
      if (!r.ok) return { data: null, missing: `findings (${r.error})` };
      const items = (r.data?.items || r.data || []).slice(0, 25).map(slimFinding);
      items.forEach((f, i) => {
        if (f.exposure != null) factMoney(registry, `${f.title} exposure`, money(f.exposure) || f.exposure?.min, { documentIds: f.documentIds });
        for (const e of (f.evidence || []).slice(0, 3)) evd(registry, e);
        void i;
      });
      return { data: { items } };
    },
  };

  tools.explain_finding = {
    declaration: {
      name: "explain_finding",
      description: "Full detail on one finding: evidence, calculation steps, candidates when ambiguous, recommended action and what resolves it.",
      parameters: { type: "object", properties: { findingId: { type: "string" } }, required: ["findingId"] },
    },
    async run({ findingId }, { registry }) {
      const r = await call(`/api/v2/findings?findingId=${encodeURIComponent(findingId)}`);
      const list = r.ok ? r.data?.items || r.data || [] : [];
      const f = list.find((x) => x.id === findingId) || list[0];
      if (!f) return { data: null, missing: `finding ${findingId}` };
      if (f.exposure != null) factMoney(registry, `${f.title} exposure`, money(f.exposure) || f.exposure?.min, { documentIds: f.documentIds });
      for (const step of f.calculation || []) {
        const v = step.value ?? step.result ?? step.output;
        if (v != null) registry.addFact({ label: step.step || step.label || step.description || step.name || "calculation step", value: s(v), unit: step.unit || "COUNT", evidenceIds: step.evidenceIds || [] });
      }
      for (const e of (f.evidence || []).slice(0, 6)) evd(registry, e);
      return { data: slimFinding(f, { full: true }) };
    },
  };

  tools.get_supplier_summary = {
    declaration: {
      name: "get_supplier_summary",
      description: "Supplier 360: open POs, deliveries, invoices, payments, open findings, MSME category and deadlines.",
      parameters: { type: "object", properties: { supplierId: { type: "string" } }, required: ["supplierId"] },
    },
    async run({ supplierId }, { registry }) {
      const r = await call(`/api/v2/suppliers/${encodeURIComponent(supplierId)}/summary`);
      if (!r.ok) return { data: null, missing: `supplier ${supplierId} (${r.error})` };
      const d = r.data || {};
      if (d.openPoAmount != null) factMoney(registry, `${d.name || "supplier"} open PO value`, d.openPoAmount);
      if (d.outstanding != null) factMoney(registry, `${d.name || "supplier"} outstanding`, d.outstanding);
      if (d.msme?.category) registry.addFact({ label: `${d.name || "supplier"} MSME category`, value: s(d.msme.category), unit: null });
      return { data: d };
    },
  };

  tools.list_payments = {
    declaration: {
      name: "list_payments",
      description: "List outgoing payments (UTR, amount, value date, allocations). Filters: entityId, supplierId, documentId, status.",
      parameters: { type: "object", properties: { entityId: { type: "string" }, supplierId: { type: "string" }, documentId: { type: "string" }, status: { type: "string" } } },
    },
    async run(args, { registry }) {
      const params = { type: "PAYMENT_OUT", ...Object.fromEntries(Object.entries(args).filter(([, v]) => v)) };
      const r = await call(`/api/v2/documents?${new URLSearchParams(params)}`);
      if (!r.ok) return { data: null, missing: `payments (${r.error})` };
      const items = (r.data?.items || r.data || []).slice(0, 25);
      for (const p of items) {
        factMoney(registry, `payment ${p.payment?.utr || p.number || p.id}`, p.payment?.amount, { documentIds: [p.id] });
        factDate(registry, `payment ${p.payment?.utr || ""} date`, p.payment?.valueDate || p.date, { documentIds: [p.id] });
      }
      return { data: { items: items.map((p) => slimDoc(p)) } };
    },
  };

  tools.get_compliance_deadlines = {
    declaration: {
      name: "get_compliance_deadlines",
      description: "Compliance deadlines: MSME 45-day, Rule 37 180-day, e-invoice 30-day, PO delivery. Use for 'what's due' questions.",
      parameters: { type: "object", properties: { entityId: { type: "string" }, kinds: { type: "array", items: { type: "string" } } }, required: ["entityId"] },
    },
    async run({ entityId, kinds }, { registry }) {
      const r = await call(`/api/v2/dashboard/today?entityId=${encodeURIComponent(entityId)}`);
      if (!r.ok) return { data: null, missing: `deadlines (${r.error})` };
      let deadlines = r.data?.deadlines || [];
      if (kinds?.length) deadlines = deadlines.filter((d) => kinds.includes(d.kind));
      factMoney(registry, "money at risk today", r.data?.moneyAtRisk);
      factMoney(registry, "ITC at risk", r.data?.itcAtRisk);
      const mapped = deadlines.slice(0, 15).map((d) => {
        const dueDateFactId = factDate(registry, `${d.kind} due date`, d.dueDate, { documentIds: [d.documentId].filter(Boolean) });
        const amountFactId = d.amount ? factMoney(registry, `${d.kind} amount`, d.amount) : null;
        return { ...d, label: deadlineLabel(d), dueDateFactId, amountFactId };
      });
      return { data: { deadlines: mapped } };
    },
  };

  tools.graph_path = {
    declaration: {
      name: "graph_path",
      description: "Shortest evidence path between two documents in the money-trail graph.",
      parameters: { type: "object", properties: { fromId: { type: "string" }, toId: { type: "string" } }, required: ["fromId", "toId"] },
    },
    async run({ fromId, toId }) {
      const r = await call(`/api/v2/graph/path?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`);
      if (!r.ok) return { data: null, missing: `graph path (${r.error})` };
      return { data: r.data };
    },
  };

  tools.graph_neighborhood = {
    declaration: {
      name: "graph_neighborhood",
      description: "Documents linked to one document in the money-trail graph (depth 1-2).",
      parameters: { type: "object", properties: { documentId: { type: "string" }, depth: { type: "number" } }, required: ["documentId"] },
    },
    async run({ documentId, depth = 1 }) {
      const r = await call(`/api/v2/graph/document/${encodeURIComponent(documentId)}/neighborhood?depth=${depth}`);
      if (!r.ok) return { data: null, missing: `graph neighborhood (${r.error})` };
      return { data: r.data };
    },
  };

  tools.search_documents = {
    declaration: {
      name: "search_documents",
      description: "Hybrid full-text + vector search over uploaded document text (not fields — contents).",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    async run({ query }, { registry }) {
      if (!rag) return { data: null, missing: "document text search (index not ready)" };
      const hits = await rag.search(scope.groupId, query, { k: 8 });
      for (const h of hits) {
        evd(registry, { id: h.id, label: `${h.sourceId} p.${h.page ?? "?"}`, documentId: h.documentId || h.sourceId });
      }
      return { data: { hits } };
    },
  };

  tools.search_help = {
    declaration: {
      name: "search_help",
      description: "Search Satya product help and Indian P2P/GST glossary (what is a GRN, IRN, e-way bill, GSTR-2B…).",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    async run({ query }) {
      if (!rag) return { data: null, missing: "help search (index not ready)" };
      const hits = await rag.search("public", query, { k: 6 });
      return { data: { hits: hits.map((h) => ({ title: h.title, text: h.text })) } };
    },
  };

  tools.run_scenario = {
    declaration: {
      name: "run_scenario",
      description: "Read-only what-if on a case (e.g. 'what if the duplicate is confirmed'). Never persists decisions.",
      parameters: { type: "object", properties: { caseId: { type: "string" }, changes: { type: "array", items: { type: "object" } } }, required: ["caseId", "changes"] },
    },
    async run({ caseId, changes }, { registry }) {
      const r = await call(`/api/v2/cases/${encodeURIComponent(caseId)}/scenarios`, { method: "POST", body: { changes } });
      if (!r.ok) return { data: null, missing: `scenario (${r.error})` };
      const ledger = r.data?.snapshot?.ledger || r.data?.ledger || {};
      factMoney(registry, "scenario supportedOutstanding", ledger.supportedOutstanding);
      factMoney(registry, "scenario canonicalOutstanding", ledger.canonicalOutstanding);
      return { data: r.data };
    },
  };

  tools.dashboard_today = {
    declaration: {
      name: "dashboard_today",
      description: "Today's group/entity overview: money at risk, holds, approvals waiting, deadlines, ITC at risk, top findings.",
      parameters: { type: "object", properties: { entityId: { type: "string" } } },
    },
    async run({ entityId }, { registry }) {
      const q = entityId ? `?entityId=${encodeURIComponent(entityId)}` : "";
      const r = await call(`/api/v2/dashboard/today${q}`);
      if (!r.ok) return { data: null, missing: `dashboard (${r.error})` };
      factMoney(registry, "moneyAtRisk", r.data?.moneyAtRisk);
      factMoney(registry, "itcAtRisk", r.data?.itcAtRisk);
      if (r.data?.holds?.amount != null) factMoney(registry, "amount on hold", r.data.holds.amount);
      if (r.data?.holds?.count != null) factQty(registry, "holds count", r.data.holds.count, "COUNT");
      if (r.data?.approvalsWaiting != null) factQty(registry, "approvals waiting", r.data.approvalsWaiting, "COUNT");
      return { data: r.data };
    },
  };

  tools.search_records = {
    declaration: {
      name: "search_records",
      description: "Find a document/supplier by its printed number or name when the id is unknown (PO-1001, INV-041, a supplier name).",
      parameters: { type: "object", properties: { query: { type: "string" }, type: { type: "string", description: "optional DocType filter e.g. PO, INVOICE_IN, GRN" } }, required: ["query"] },
    },
    async run({ query, type }) {
      const params = new URLSearchParams({ q: query });
      if (type) params.set("type", type);
      const [docs, sups] = await Promise.all([
        call(`/api/v2/documents?${params}`),
        call(`/api/v2/suppliers?q=${encodeURIComponent(query)}`),
      ]);
      const items = [
        ...(docs.ok ? (docs.data?.items || docs.data || []).map((d) => ({ kind: "document", id: d.id, number: d.number, type: d.type, supplier: d.seller?.name })) : []),
        ...(sups.ok ? (sups.data?.items || sups.data || []).map((x) => ({ kind: "supplier", id: x.id, name: x.legalName || x.tradeName })) : []),
      ];
      return { data: { items: items.slice(0, 10) } };
    },
  };

  return tools;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] != null).map((k) => [k, obj[k]]));

const slimDoc = (d, full = {}) =>
  pick({ ...d, ...full }, ["id", "type", "number", "date", "status", "seller", "buyer", "totals", "payment", "gst", "lifecycle", "links", "lines"]);

const slimFinding = (f, { full = false } = {}) =>
  pick(f, ["id", "code", "title", "severity", "certainty", "exposure", "explanation", "recommendedAction", "whatResolvesIt", "documentIds", "candidates", "harmlessVariance",
    ...(full ? ["calculation", "evidence", "detector"] : [])]);

const deadlineLabel = (d) =>
  ({ MSME_45: "MSME 45-day", RULE_37_180: "Rule 37 (180-day ITC)", EINVOICE_30: "e-invoice 30-day", PO_DELIVERY: "PO delivery" }[d.kind] || d.kind);
