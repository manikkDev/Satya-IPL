// tools/index.js — the copilot toolkit: read tools, the exact calculator and
// proposal tools behind one runner. The runner
//   * scopes every call to the user (their JWT is already bound in `call`),
//   * feeds STRUCTURED results into the NumberBank (grounding),
//   * keeps tool results whole for the model (bounded, not blindly cut),
//   * collects mini-tables and action cards for the answer,
//   * logs each call for the SSE `tool` events and the eval harness.

import { readTools } from "./read.js";
import { proposalTools } from "./proposals.js";
import { trustedIntent } from "./proposals.js";
import { sumMoney, evaluate } from "../exact.js";

export const VIEW_LIMIT = 9000; // chars of JSON per tool result shown to the model

export const ALL_TOOL_NAMES = () => [...Object.keys(readTools()), ...Object.keys(proposalTools())];

/**
 * @param {object} deps
 * @param {Function} deps.call serverCall bound to the user's JWT
 * @param {object} [deps.rag]
 * @param {object} deps.scope {groupId, entityId?, userId}
 * @param {import("../sources.js").SourceRegistry} deps.sources
 * @param {import("../grounding.js").NumberBank} deps.bank
 * @param {string} deps.userMessage the user's own words (trusted intent)
 * @param {string} [deps.today] YYYY-MM-DD (IST)
 * @param {Function} [deps.onEvent] (event, data) → SSE
 */
export function createToolkit({ call, rag = null, scope = {}, sources, bank, userMessage = "", today, onEvent = () => {}, buyerName = null }) {
  const defs = { ...readTools(), ...proposalTools() };
  const ctx = {
    call, rag, scope, sources, bank, userMessage, buyerName,
    today: today || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10),
    trusted: trustedIntent(userMessage),
    // exact derivations, logged so the evaluator can recompute every figure
    sum: (values) => bank.addDerived(sumMoney(values), { op: "sum", inputs: values.map((v) => String(v ?? "0")) }),
    expr: (expression) => {
      const out = evaluate(expression);
      bank.addDerived(out.rounded, { op: "expr", expr: expression });
      bank.addNumber(out.value);
      return out;
    },
    count: (items, idOf = (x) => x?.documentId || x?.id) => bank.addDerived(items.length, { op: "count", items: items.map(idOf).filter(Boolean).slice(0, 100) }),
    dateAdd: (from, days) => bank.addDerived(new Date(Date.parse(`${from}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10), { op: "date", from, days }),
  };
  const log = [];
  const tables = [];
  const cards = [];
  const results = []; // {id, name, args, data, missing}
  let seq = 0;

  async function run(name, rawArgs = {}) {
    const def = defs[name];
    const id = `t${++seq}`;
    const args = sanitizeArgs(rawArgs);
    if (!def) {
      const entry = { id, name, args, ok: false, ms: 0, summary: "unknown tool" };
      log.push(entry);
      return { id, name, error: `unknown tool ${name}`, view: { error: `unknown tool ${name}` } };
    }
    onEvent("tool", { id, name, label: def.label, args, status: "start" });
    const started = Date.now();
    let out;
    try {
      out = (await def.run(args, ctx)) || {};
    } catch (error) {
      out = { missing: `${name} failed (${error.message})` };
    }
    const ms = Date.now() - started;
    if (out.data) bank.addData(out.data);
    // system window parameters (e.g. "due within 7 days") are not data but
    // are legitimately quoted back; LLM-chosen amounts are never added
    for (const key of ["dueWithinDays", "withinDays"]) if (Number.isFinite(Number(args[key]))) bank.addNumber(args[key]);
    if (out.table) tables.push({ ...out.table, tool: name });
    if (out.card) cards.push(out.card);
    const ok = !out.missing;
    const entry = { id, name, args, ok, ms, summary: out.summary || out.missing || "", kind: def.kind || "read" };
    log.push(entry);
    results.push({ id, name, args, data: out.data ?? null, missing: out.missing || null, hasCard: Boolean(out.card), hasTable: Boolean(out.table) });
    onEvent("tool", { id, name, label: def.label, args, status: "done", ok, ms, summary: entry.summary });
    if (out.card) onEvent("action", { card: out.card });
    return { id, name, ok, data: out.data, view: out.missing ? { missing: out.missing } : out.view ?? out.data, missing: out.missing, card: out.card };
  }

  return {
    defs,
    ctx,
    run,
    log,
    tables,
    cards,
    results,
    declarations: (names) => Object.entries(defs).filter(([n]) => !names || names.includes(n)).map(([, d]) => d.declaration),
    called: () => log.map((l) => l.name),
  };
}

/** Bounded JSON for the model; keeps structure (no mid-string cuts). */
export function viewJson(view, limit = VIEW_LIMIT) {
  let text = JSON.stringify(view);
  if (text.length <= limit) return text;
  // shrink the longest arrays until it fits, saying so
  const clone = JSON.parse(text);
  const shrink = (obj) => {
    let best = null;
    const walk = (o, path) => {
      if (Array.isArray(o)) { if (!best || o.length > best.arr.length) best = { arr: o, path }; o.forEach((x, i) => walk(x, `${path}[${i}]`)); }
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(obj, "");
    if (!best || best.arr.length <= 3) return false;
    const keep = Math.max(3, Math.floor(best.arr.length / 2));
    const dropped = best.arr.length - keep;
    best.arr.splice(keep, best.arr.length - keep, { more: `${dropped} more row(s) not shown — ask a narrower question or use filters` });
    return true;
  };
  for (let i = 0; i < 12 && text.length > limit; i++) {
    if (!shrink(clone)) break;
    text = JSON.stringify(clone);
  }
  return text.length > limit ? `${text.slice(0, limit)}…(truncated)` : text;
}

const sanitizeArgs = (args) => {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => (typeof x === "string" ? x.slice(0, 120) : x));
    else if (v && typeof v === "object") {
      const text = JSON.stringify(v);
      out[k] = text.length <= 2000 ? JSON.parse(text) : {};
    }
  }
  return out;
};

export { trustedIntent };
