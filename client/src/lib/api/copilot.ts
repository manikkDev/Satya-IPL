// Ask Satya client. Streaming chat over SSE (fetch + ReadableStream, because
// EventSource cannot send an Authorization header), conversations, the daily
// briefing, feedback, and action-card execution.
//
// POST /api/v2/copilot/chat body: {message, conversationId?, context?,
//   options?: {mode, showWorking, includeScreening, confirmedOnly,
//              scope:{supplierId, from, to, entityId}, attachmentDocumentIds},
//   requestId?}  — POST /chat/stop {requestId} stops a running answer.
//
// SSE events:
//   meta {requestId, options} · status {stage, detail} · tool {id,name,label,status,ok,ms,summary}
//   delta {text} (grounding-checked line) · reset {reason} · action {card}
//   answer {...CopilotAnswer} · usage · error {code,message} · done {conversationId,messageId}
//
// Action cards never execute on the gateway: on Confirm the CLIENT calls the
// card's server endpoint (execute.path) with the user's own token, then
// records the outcome on the conversation.

import { SERVER_URL, SERVER_URL_1 } from "../../utils/commonHelper.js";
import { fetchJson, ApiError } from "./client";
import { mocksEnabled } from "../flags";
import { pushAiUsage } from "../ai-usage";

export type Certainty = "CONFIRMED" | "PROBABLE" | "POSSIBLE" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE";

export type Citation = {
  n: number;
  ref: string;
  kind: "document" | "case" | "supplier" | "finding" | "payment" | "compliance" | "report";
  id: string;
  type?: string | null;
  label: string;
  href: string;
};

export type ColumnFormat = "inr" | "date" | "int" | "pct" | "text";
export type TableColumn = { key: string; label: string; format?: ColumnFormat; align?: "left" | "right" };
export type TableRow = Record<string, unknown> & { _ref?: string | null };
export type AnswerTable = { id: string; title: string; columns: TableColumn[]; rows: TableRow[]; total?: Record<string, unknown>; tool?: string };

export type CardField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "date";
  value: string;
  options?: (string | { value: string; label: string })[];
  bind?: string;
  required?: boolean;
};

export type ActionCardData = {
  id: string;
  kind: "payment_run" | "supplier_message" | "ims_actions" | "decision" | "allocation" | "assignment" | "reminder";
  title: string;
  summary: string;
  status: "proposed" | "confirmed" | "cancelled" | "failed";
  facts?: { label: string; value: string | null; format?: ColumnFormat }[];
  table?: { columns: TableColumn[]; rows: TableRow[] } | null;
  excluded?: { invoice: string; supplier: string; amount: string; why: string; _ref?: string }[];
  fields?: CardField[];
  warnings?: string[];
  execute: { method: "POST" | "PATCH"; path: string; body: Record<string, unknown>; successText?: string } | null;
  confirmLabel?: string;
  permission?: string;
  result?: { status: string; detail?: string; reference?: string; at?: string };
};

export type AgentMode = "ask" | "analyse" | "draft" | "plan";
export type AgentScope = { supplierId?: string | null; supplierName?: string | null; from?: string | null; to?: string | null; entityId?: string | null };
export type AgentOptions = {
  mode: AgentMode;
  showWorking: boolean;
  includeScreening: boolean;
  confirmedOnly: boolean;
  scope: AgentScope;
  attachmentDocumentIds?: string[];
};
export const DEFAULT_AGENT_OPTIONS: AgentOptions = { mode: "ask", showWorking: false, includeScreening: false, confirmedOnly: false, scope: {} };

export type ToolStep = { id: string; name: string; label?: string; status: "start" | "done"; ok?: boolean; ms?: number; summary?: string };

export type CopilotAnswer = {
  messageId?: string;
  conversationId?: string;
  content: string;
  answerType?: "answer" | "proposal" | "refusal" | "clarification" | "partial" | string;
  certainty?: Certainty;
  citations?: Citation[];
  sources?: Citation[];
  tables?: AnswerTable[];
  actions?: ActionCardData[];
  followUps?: string[];
  suggestedFollowUps?: string[];
  options?: { id?: string; label: string; action?: string; hint?: string }[];
  grounding?: { checked: boolean; claims: number; grounded: number; ungrounded: string[]; rate: number; citationsValid?: number; citationsInvalid?: number };
  responseMode?: "agent" | "evidence_only";
  mode?: "llm" | "evidence_only";
  llm?: { provider: string | null; model: string | null };
  intent?: string;
  missingEvidence?: string[];
  toolCalls?: ToolStep[];
  graphRef?: { caseId?: string | null; documentId?: string | null; supplierId?: string | null };
  latencyMs?: number;
  agentOptions?: { mode?: AgentMode; showWorking?: boolean; includeScreening?: boolean; confirmedOnly?: boolean; scope?: AgentScope; attachments?: number };
};

export type CopilotEvent =
  | { type: "meta"; requestId?: string | null; options?: Partial<AgentOptions> }
  | { type: "status"; stage: string; detail?: string }
  | ({ type: "tool" } & ToolStep)
  | { type: "delta"; text: string }
  | { type: "reset"; reason?: string }
  | { type: "action"; card: ActionCardData }
  | ({ type: "answer" } & CopilotAnswer)
  | { type: "usage"; usage?: Parameters<typeof pushAiUsage>[0] } & Record<string, unknown>
  | { type: "error"; code?: string; message: string }
  | { type: "done"; conversationId?: string | null; messageId?: string };

export type CopilotContext = { page?: string; caseId?: string; documentId?: string; supplierId?: string; entityId?: string };

export type BriefingItem = { label: string; detail?: string; amount?: string | null; href?: string; ref?: string };
export type BriefingSection = {
  id: string;
  title: string;
  tone: "critical" | "warn" | "ok";
  metric: { value: string | null; format: ColumnFormat; caption?: string };
  items: BriefingItem[];
  ask: string;
};
export type Briefing = {
  asOf: string;
  headline: { text: string; value: string | null; format?: ColumnFormat } | null;
  cash: { overdue: string; dueThisWeek: string; total: string; disputed: string; payable: string } | null;
  sections: BriefingSection[];
  suggestions: string[];
  missing?: string[];
  cached?: boolean;
};

export type StoredMessage = {
  role: "user" | "assistant";
  id?: string;
  content: string;
  at?: string;
} & Partial<CopilotAnswer>;

export type CopilotConversation = {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  messages?: StoredMessage[];
};

const STAGE_TEXT: Record<string, string> = {
  understanding: "Reading your question",
  planning: "Working out what to check",
  retrieving: "Checking your records",
  checking: "Verifying every figure",
  writing: "Writing the answer",
};
export const stageText = (stage: string) => STAGE_TEXT[stage] ?? stage;

function authHeader(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<CopilotEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (!eventLine || !dataLines.length) continue;
      const type = eventLine.slice(6).trim();
      try {
        const data = JSON.parse(dataLines.map((l) => l.slice(5)).join("\n"));
        if (type === "action") yield { type: "action", card: data.card };
        else yield { ...data, type } as CopilotEvent;
      } catch {
        // skip malformed event
      }
    }
  }
}

/* --------------------------------------------------------------- mocks */

async function* mockStream(message: string): AsyncGenerator<CopilotEvent> {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  yield { type: "status", stage: "retrieving", detail: "Checking your records" };
  yield { type: "tool", id: "t1", name: "list_payables", label: "Reading open payables", status: "start" };
  await pause(400);
  yield { type: "tool", id: "t1", name: "list_payables", label: "Reading open payables", status: "done", ok: true, ms: 120, summary: "2 open invoices" };
  const text = `**₹2,47,400 is overdue or due this week across 2 invoices.**\n\n**Why**\n- KAV/26-27/4410 from Kaveri Pumps is 13 days overdue (₹2,07,400) [S1].\n- ₹1,50,000 of it is disputed as a possible duplicate — hold that back [S1].\n\n_Evidence:_ [S1]`;
  for (const line of text.split(/(?<=\n)/)) {
    await pause(60);
    yield { type: "delta", text: line };
  }
  yield {
    type: "answer",
    content: text,
    answerType: "answer",
    certainty: "CONFIRMED",
    citations: [{ n: 1, ref: "S1", kind: "document", id: "doc_inv_4410", label: "Invoice KAV/26-27/4410", href: "/app/investigations/case_k1" }],
    tables: [{ id: "mock", title: "Overdue and due soon", columns: [{ key: "invoice", label: "Invoice" }, { key: "supplier", label: "Supplier" }, { key: "outstanding", label: "Outstanding", format: "inr", align: "right" }], rows: [{ invoice: "KAV/26-27/4410", supplier: "Kaveri Pumps & Motors Ltd", outstanding: "207400.00", _ref: "S1" }, { invoice: "DVI/26-27/0007", supplier: "Deccan Valve Industries", outstanding: "40000.00" }] }],
    followUps: ["What should we pay first?", "Draft a dispute email to Kaveri Pumps"],
    grounding: { checked: true, claims: 4, grounded: 4, ungrounded: [], rate: 1 },
    responseMode: "agent",
    intent: "payables_due",
    toolCalls: [{ id: "t1", name: "list_payables", status: "done", ok: true }],
  };
  void message;
  yield { type: "done", conversationId: null, messageId: "msg_mock" };
}

/* ------------------------------------------------------------ requests */

async function copilotJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL_1}/api/v2/copilot${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeader(), ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Copilot request failed (${response.status})`);
  return response.status === 204 ? (undefined as T) : response.json();
}

export function listConversations(): Promise<{ items: CopilotConversation[] }> {
  if (mocksEnabled()) return Promise.resolve({ items: [] });
  return copilotJson("/conversations");
}

export function getConversation(id: string): Promise<CopilotConversation> {
  return copilotJson(`/conversations/${encodeURIComponent(id)}`);
}

export function deleteConversation(id: string): Promise<void> {
  return copilotJson(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function sendFeedback(messageId: string, rating: "up" | "down", reason?: string): Promise<void> {
  if (mocksEnabled()) return Promise.resolve();
  return copilotJson("/feedback", { method: "POST", body: JSON.stringify({ messageId, rating, reason }) });
}

export function getBriefing(entityId?: string, fresh = false): Promise<Briefing> {
  if (mocksEnabled()) {
    return Promise.resolve({
      asOf: new Date().toISOString().slice(0, 10),
      headline: { text: "Cash needed to clear overdue and this week's dues", value: "247400.00", format: "inr" },
      cash: { overdue: "207400.00", dueThisWeek: "40000.00", total: "247400.00", disputed: "150000.00", payable: "97400.00" },
      sections: [
        { id: "overdue", title: "Overdue", tone: "critical", metric: { value: "207400.00", format: "inr", caption: "1 invoice" }, items: [{ label: "Kaveri Pumps & Motors Ltd", detail: "KAV/26-27/4410 · 13 days overdue · MSME", amount: "207400.00" }], ask: "Which overdue invoices should we pay first?" },
        { id: "due_week", title: "Due this week", tone: "warn", metric: { value: "40000.00", format: "inr", caption: "1 invoice" }, items: [], ask: "What is due this week?" },
      ],
      suggestions: ["What should we pay first?"],
    });
  }
  const q = new URLSearchParams();
  if (entityId) q.set("entityId", entityId);
  if (fresh) q.set("fresh", "1");
  return copilotJson(`/briefing${q.toString() ? `?${q}` : ""}`);
}

export function recordActionResult(conversationId: string, actionId: string, result: { status: "confirmed" | "cancelled" | "failed"; detail?: string; reference?: string }) {
  if (mocksEnabled() || !conversationId) return Promise.resolve(null);
  return copilotJson(`/conversations/${encodeURIComponent(conversationId)}/actions/${encodeURIComponent(actionId)}`, { method: "POST", body: JSON.stringify(result) }).catch(() => null);
}

/** Merge edited fields into the card's request body (field.bind → body key). */
export function buildActionBody(card: ActionCardData, values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(card.execute?.body ?? {}) };
  for (const field of card.fields ?? []) {
    if (!field.bind) continue;
    const value = values[field.key] ?? field.value;
    body[field.bind] = value;
  }
  // email-only field: drop subject when the channel was switched away
  if (body.channel && body.channel !== "email") delete body.subject;
  return body;
}

/** Run a confirmed action with the user's own token against the API server. */
export async function executeAction(card: ActionCardData, values: Record<string, string>): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  if (!card.execute) return { ok: false, message: "This card has nothing to confirm." };
  if (mocksEnabled()) return { ok: true, data: { mock: true } };
  try {
    const data = await fetchJson(card.execute.path, {
      method: card.execute.method,
      body: buildActionBody(card, values),
      idempotencyKey: card.id,
      timeoutMs: 20_000,
    });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      const reason = (error.details as { reason?: string } | undefined)?.reason;
      return { ok: false, message: `${error.message}${reason ? ` (${reason})` : ""}` };
    }
    return { ok: false, message: error instanceof Error ? error.message : "The request failed" };
  }
}

export async function* streamCopilotChat(
  message: string,
  context: CopilotContext = {},
  conversationId?: string,
  signal?: AbortSignal,
  options?: AgentOptions,
  requestId?: string,
): AsyncGenerator<CopilotEvent> {
  if (mocksEnabled()) {
    yield* mockStream(message);
    return;
  }
  const timeout = AbortSignal.timeout(150_000);
  const response = await fetch(`${SERVER_URL_1}/api/v2/copilot/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeader() },
    body: JSON.stringify({ conversationId, message, context, options, requestId }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    yield { type: "error", code: data?.error?.code, message: data?.error?.message || `Assistant unavailable (${response.status})` };
    return;
  }
  if (!response.body) {
    yield { type: "error", message: "Assistant stream unavailable" };
    return;
  }
  yield* parseSse(response.body);
}

/** "Stop generating": tells the gateway too (the aborted fetch also stops it). */
export function stopCopilotChat(requestId: string): Promise<void> {
  if (mocksEnabled() || !requestId) return Promise.resolve();
  return fetch(`${SERVER_URL_1}/api/v2/copilot/chat/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ requestId }),
    keepalive: true,
  }).then(() => undefined, () => undefined);
}

/* ------------------------------------------------------- attachments */

export type AttachmentSummary = { type?: string | null; number?: string | null; total?: string | null; supplier?: string | null; date?: string | null };
export type AttachmentResult = { fileId: string; draftId: string | null; status: string; summary: AttachmentSummary; message?: string };

const fieldValue = (fields: Record<string, unknown> | undefined, name: string): unknown => {
  const v = fields?.[name];
  return v && typeof v === "object" && "value" in (v as Record<string, unknown>) ? (v as { value: unknown }).value : v;
};

/**
 * Attach a document for the assistant: upload to the API's file store, then
 * run extraction (the engine reads it into a draft in Imports — nothing is
 * posted to the books). The gateway reads the draft with the user's token.
 */
export async function uploadAttachment(file: File, entityId: string | undefined, onPhase: (phase: "uploading" | "reading") => void): Promise<AttachmentResult> {
  if (mocksEnabled()) {
    onPhase("reading");
    await new Promise((r) => setTimeout(r, 700));
    return { fileId: "file_mock", draftId: "drf_mock", status: "needs_review", summary: { type: "INVOICE_IN", number: "KAV/26-27/4410", total: "207400.00", supplier: "Kaveri Pumps & Motors Ltd" } };
  }
  onPhase("uploading");
  const form = new FormData();
  form.append("file", file);
  if (entityId) form.append("entityId", entityId);
  const up = await fetch(`${SERVER_URL}/api/v2/files`, { method: "POST", headers: authHeader(), body: form, signal: AbortSignal.timeout(60_000) });
  const upData = await up.json().catch(() => null);
  if (!up.ok) throw new Error(upData?.error?.message || `Upload failed (${up.status})`);
  const fileId: string | undefined = upData?.fileId ?? upData?.id;
  if (!fileId) throw new Error("Upload finished but no file id came back");
  onPhase("reading");
  const ex = await fetch(`${SERVER_URL}/api/v2/ingest/files/${encodeURIComponent(fileId)}/extract`, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeader() },
    signal: AbortSignal.timeout(150_000),
  });
  const exData = await ex.json().catch(() => null);
  const draft = exData?.draft as { fields?: Record<string, unknown>; detectedType?: string; issues?: { message?: string }[] } | undefined;
  const seller = fieldValue(draft?.fields, "seller") as { name?: string } | undefined;
  const totals = fieldValue(draft?.fields, "totals") as { grand?: unknown } | undefined;
  const grand = totals?.grand && typeof totals.grand === "object" ? (totals.grand as { amount?: string }).amount : totals?.grand;
  const summary: AttachmentSummary = {
    type: draft?.detectedType ?? (fieldValue(draft?.fields, "type") as string | undefined) ?? null,
    number: (fieldValue(draft?.fields, "number") as string | undefined) ?? null,
    date: (fieldValue(draft?.fields, "date") as string | undefined) ?? null,
    supplier: seller?.name ?? (fieldValue(draft?.fields, "sellerName") as string | undefined) ?? null,
    total: grand != null ? String(grand) : null,
  };
  if (!exData?.draftId) throw new Error(exData?.error?.message || `Couldn't read the document (${ex.status})`);
  return { fileId, draftId: exData.draftId, status: exData.status ?? (ex.ok ? "needs_review" : "failed"), summary, message: ex.ok ? undefined : draft?.issues?.[0]?.message };
}

/* ----------------------------------------------------- scope pickers */

export type SupplierOption = { id: string; name: string; gstin?: string | null };

export async function searchSuppliers(q: string): Promise<SupplierOption[]> {
  if (mocksEnabled()) return [{ id: "sup_kaveri", name: "Kaveri Pumps & Motors Ltd", gstin: "27AAACK1234F1Z5" }].filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  const response = await fetch(`${SERVER_URL}/api/v2/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { headers: { Accept: "application/json", ...authHeader() }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  return ((data?.items ?? []) as { id: string; legalName?: string; tradeName?: string; name?: string; gstin?: string }[])
    .slice(0, 8)
    .map((x) => ({ id: x.id, name: x.legalName || x.tradeName || x.name || x.id, gstin: x.gstin ?? null }));
}

/* ------------------------------------------------- citation previews */

export type CitationPreview = { title: string; kindLabel: string; number?: string | null; party?: string | null; amount?: string | null; date?: string | null; status?: string | null };

const KIND_LABEL: Record<string, string> = {
  PO: "Purchase order", INVOICE_IN: "Invoice", GRN: "Goods receipt", QC: "Quality check", PAYMENT_OUT: "Payment", ADVANCE_OUT: "Advance",
  CREDIT_NOTE_IN: "Credit note", DEBIT_NOTE_IN: "Debit note", GSTR2B_ENTRY: "GSTR-2B row",
};
export const docKindLabel = (type?: string | null) => (type ? KIND_LABEL[type] ?? "Document" : "Document");

const money = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "object" && v && "amount" in v) return String((v as { amount: unknown }).amount);
  return String(v);
};

/** Details for a citation's hover card, read with the user's own token. */
export async function getCitationPreview(c: Citation): Promise<CitationPreview> {
  const base: CitationPreview = { title: c.label, kindLabel: c.kind === "document" || c.kind === "payment" ? docKindLabel(c.type) : c.kind[0].toUpperCase() + c.kind.slice(1) };
  if (mocksEnabled()) return base;
  const get = async (path: string) => {
    const r = await fetch(`${SERVER_URL}${path}`, { headers: { Accept: "application/json", ...authHeader() }, signal: AbortSignal.timeout(8_000) });
    return r.ok ? r.json() : null;
  };
  try {
    if ((c.kind === "document" || c.kind === "payment") && /^doc_/.test(c.id)) {
      const data = await get(`/api/v2/documents/${encodeURIComponent(c.id)}`);
      const d = data?.document ?? data;
      if (d) return { ...base, kindLabel: docKindLabel(d.type), number: d.number ?? d.payment?.utr ?? null, party: d.seller?.name ?? null, amount: money(d.totals?.grand ?? d.payment?.amount), date: d.date ?? null, status: d.status ?? null };
    }
    if (c.kind === "document" && /^drf_/.test(c.id)) return { ...base, kindLabel: "Attached document", status: "Draft in Imports — not in your books" };
    if (c.kind === "supplier") {
      const d = await get(`/api/v2/suppliers/${encodeURIComponent(c.id)}`);
      const sup = d?.supplier ?? d;
      if (sup) return { ...base, kindLabel: "Supplier", party: sup.legalName ?? sup.name ?? c.label, number: sup.gstin ?? null, status: sup.udyam?.category ? `MSME · ${sup.udyam.category}` : null };
    }
    if (c.kind === "case") {
      const d = await get(`/api/v2/cases/${encodeURIComponent(c.id)}`);
      if (d) return { ...base, kindLabel: "Investigation", title: d.title ?? c.label, status: d.status ?? null };
    }
  } catch {
    /* preview is best-effort */
  }
  return base;
}

/* ------------------------------------------------------------ helpers */

/** CSV for a table (formula-safe cells, Excel-friendly BOM). */
export function tableToCsv(table: { columns: TableColumn[]; rows: TableRow[] }): string {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [table.columns.map((c) => cell(c.label)).join(",")];
  for (const row of table.rows) lines.push(table.columns.map((c) => cell(row[c.key])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
