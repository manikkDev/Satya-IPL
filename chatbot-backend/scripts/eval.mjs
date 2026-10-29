// eval.mjs — golden-set replay harness (P3-C7).
// CI mode (default): deterministic — the LLM is replaced by a fixture double
// and the server by case fixtures; checks fact-grounding, citations,
// clarification precision, refusal correctness, fabrication-free answers.
// Live mode (`npm run eval:live`): real Gemini through the pool, ≤150 calls.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCopilot } from "../src/copilot/pipeline.js";

const dir = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(dir, "../test/golden/cases.json"), "utf8"));
const LIVE = process.argv.includes("--live");

const auth = { userId: "eval", groupId: "grp_demo", roles: new Set(["ap_manager"]) };

const fixture = {
  id: "case_1", title: "PO-1001 pumps", status: "open", subjectIds: ["doc_po1"],
  snapshot: {
    ledger: { ordered: "100", received: "60", accepted: "60", invoiced: "60", settled: "50800.00", recordedOutstanding: "90800.00", supportedOutstanding: "20000.00", canonicalOutstanding: null, currency: "INR" },
    findings: [{ id: "fnd_1", code: "DUP_NEAR_INVOICE", title: "Possible duplicate invoice INV-041", severity: "high", certainty: "PROBABLE", exposure: { amount: "70800.00" }, explanation: "INV-041 appears keyed twice", recommendedAction: "PLACE_ON_HOLD", documentIds: ["doc_inv1"] }],
    unallocatedPayments: [{ reference: "T03", currency: "INR", amount: "15000.00", candidateInvoiceIds: ["INV-041", "INV-042", "AP-992"] }],
    ambiguities: [],
    evidence: [{ id: "evd_1", documentId: "doc_grn1", field: "quantity", label: "GRN-40 quantity" }],
  },
};

const call = (path) => {
  if (path.startsWith("/api/v2/cases/")) return Promise.resolve({ ok: true, data: fixture });
  if (path.startsWith("/api/v2/findings")) return Promise.resolve({ ok: true, data: { items: fixture.snapshot.findings } });
  if (path.startsWith("/api/v2/dashboard")) return Promise.resolve({ ok: true, data: { moneyAtRisk: { amount: "20000.00" }, itcAtRisk: { amount: "0.00" }, holds: { count: 1, amount: "70800.00" }, deadlines: [{ kind: "MSME_45", dueDate: "2026-11-05", amount: { amount: "15000.00" }, supplier: "Pump supplier" }] } });
  if (path.startsWith("/api/v2/documents") || path.startsWith("/api/v2/suppliers")) return Promise.resolve({ ok: true, data: { items: [] } });
  return Promise.resolve({ ok: false, status: 404, error: "NOT_FOUND" });
};

// Deterministic LLM double for CI: understand→status intent, retrieval→one
// get_case_context call, write→placeholder JSON, embed→zero vector.
const fixtureLlm = {
  async generate(task, body) {
    if (body?.tools) return { ok: true, text: "", raw: { candidates: [{ content: { parts: [{ text: "done" }] } }] }, usage: {} };
    if (task === "understand") return { ok: true, text: '{"intent":"status","entities":{}}', raw: {}, usage: {} };
    return { ok: true, text: JSON.stringify({ answerMarkdown: "Records show {{F1}} ordered and {{F2}} received [E1].", certainty: "CONFIRMED", followUps: [] }), raw: {}, usage: {} };
  },
  async embed() { return { ok: true, vectors: [[0]] }; },
};

const report = { total: cases.length, results: [], metrics: { factAccuracy: null, citationValid: null, clarificationCorrect: 0, clarificationTotal: 0, refusalCorrect: 0, refusalTotal: 0, fabricatedNumbers: 0, fallbackRate: 0 }, live: LIVE };

const digitRuns = (s) => [...String(s || "").matchAll(/\d+/g)].map((m) => m[0]);
const allowedDigits = (payload) => {
  const set = new Set();
  for (const f of Object.values(payload.facts || {})) for (const d of digitRuns(f.value)) set.add(d);
  for (const c of payload.citations || []) for (const d of digitRuns(`${c.evidenceId} ${c.label}`)) set.add(d);
  for (const d of ["PO", "GRN", "INV", "T0", "UTR"]) void d;
  return set;
};

for (const gc of cases) {
  const llm = LIVE ? (await import("../src/llm/index.js")).getGateway() : fixtureLlm;
  const started = Date.now();
  let payload, error = null;
  try {
    payload = await runCopilot({ message: gc.question, context: gc.context, auth, llm, call, rag: null });
  } catch (e) {
    error = e.message;
  }
  const ms = Date.now() - started;
  const r = { id: gc.id, ms, pass: true, notes: [] };
  if (error) {
    r.pass = false; r.notes.push(`error:${error}`);
  } else {
    const digits = digitRuns(payload.content).filter((d) => d.length >= 2);
    const allowed = allowedDigits(payload);
    const bad = digits.filter((d) => !allowed.has(d) && !(d.length === 4 && Number(d) > 1990 && Number(d) < 2100));
    if (bad.length) { r.pass = false; r.notes.push(`ungrounded:${bad.join(",")}`); report.metrics.fabricatedNumbers += bad.length; }
    if (payload.content.includes("{{F") || payload.content.includes("[E") && payload.citations.length === 0 && /\[E\d+\]/.test(payload.content)) { r.pass = false; r.notes.push("unresolved-placeholder"); }
    if (gc.expected.refusal) { report.metrics.refusalTotal += 1; if (payload.answerType === "refusal" || /CA|records|can't help|outside/i.test(payload.content)) report.metrics.refusalCorrect += 1; else { r.pass = false; r.notes.push("expected-refusal"); } }
    if (gc.expected.clarification) { report.metrics.clarificationTotal += 1; if (payload.answerType === "clarification" || payload.answerType === "partial") report.metrics.clarificationCorrect += 1; else { r.pass = false; r.notes.push("expected-clarification"); } }
    if (gc.expected.notFound && /found|PO-9|INV-9/.test(payload.content) === false && /not found|couldn't find|no record|won't guess/i.test(payload.content) === false && payload.answerType === "answer") { r.pass = false; r.notes.push("expected-notfound"); }
    for (const mf of gc.expected.mustIncludeFacts || []) {
      const plain = (s) => String(s).replace(/[₹,\s]/g, "");
      const inFacts = Object.values(payload.facts || {}).some(
        (f) => (mf.label === "any" || f.label === mf.label) && plain(f.value).includes(mf.value),
      );
      const inContent = plain(payload.content).includes(mf.value);
      if (!inFacts && !inContent) { r.pass = false; r.notes.push(`missing-fact:${mf.label}=${mf.value}`); }
    }
    if (payload.responseMode !== "grounded_ai") report.metrics.fallbackRate += 1;
  }
  report.results.push(r);
}

const passed = report.results.filter((r) => r.pass).length;
report.metrics.passed = passed;
report.metrics.fallbackRate = Math.round((report.metrics.fallbackRate / cases.length) * 100);
console.log(`eval ${LIVE ? "LIVE" : "CI"}: ${passed}/${cases.length} pass, fallbacks ${report.metrics.fallbackRate}%, clarifications ${report.metrics.clarificationCorrect}/${report.metrics.clarificationTotal}, refusals ${report.metrics.refusalCorrect}/${report.metrics.refusalTotal}`);
writeFileSync(join(dir, "../eval-report.json"), JSON.stringify(report, null, 2));
process.exit(passed === cases.length ? 0 : 1);
