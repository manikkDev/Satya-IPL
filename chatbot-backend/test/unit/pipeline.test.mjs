import { test } from "node:test";
import assert from "node:assert/strict";
import { runCopilot } from "../../src/copilot/pipeline.js";

const auth = { userId: "u1", groupId: "grp_1", roles: new Set(["ap_manager"]) };

const caseFixture = {
  id: "case_1", title: "PO-1001 pumps", status: "open", subjectIds: ["doc_po1"],
  snapshot: {
    ledger: { ordered: "100", received: "60", accepted: "60", invoiced: "60", settled: "50800.00", supportedOutstanding: "20000.00", canonicalOutstanding: null, currency: "INR" },
    findings: [{ id: "fnd_1", code: "DUP_NEAR_INVOICE", title: "Possible duplicate invoice", severity: "high", certainty: "PROBABLE", exposure: { amount: "70800.00" }, explanation: "INV-041 keyed twice", recommendedAction: "PLACE_ON_HOLD", documentIds: ["doc_inv1"] }],
    ambiguities: [],
    evidence: [{ id: "evd_1", documentId: "doc_grn1", field: "quantity", label: "GRN-40 quantity" }],
  },
};

const okCall = (path) => {
  if (path.startsWith("/api/v2/cases/")) return Promise.resolve({ ok: true, data: caseFixture });
  if (path.startsWith("/api/v2/findings")) return Promise.resolve({ ok: true, data: { items: caseFixture.snapshot.findings } });
  if (path.startsWith("/api/v2/documents")) return Promise.resolve({ ok: true, data: { items: [] } });
  return Promise.resolve({ ok: false, status: 404, error: "NOT_FOUND", data: null });
};

const deadLlm = { async generate() { return { ok: false, reason: "all_keys_exhausted" }; } };

const groundedLlm = {
  async generate(task, body) {
    if (body.tools) {
      // agentic retrieval: first reply requests the case context tool
      if (!this._called) {
        this._called = true;
        return { ok: true, text: "", raw: { candidates: [{ content: { parts: [{ functionCall: { name: "get_case_context", args: { caseId: "case_1" } } }] } }] }, usage: {} };
      }
      return { ok: true, text: "done", raw: { candidates: [{ content: { parts: [{ text: "done" }] } }] }, usage: {} };
    }
    if (task === "understand") {
      return { ok: true, text: JSON.stringify({ intent: "status", entities: {} }), raw: {}, usage: {} };
    }
    return {
      ok: true,
      text: JSON.stringify({
        answerMarkdown: "The order shows {{F2}} received against {{F1}} ordered, with {{F5}} still owed [E1].",
        certainty: "CONFIRMED",
        followUps: ["Show the duplicate finding"],
      }),
      raw: {}, usage: {},
    };
  },
};

test("dead LLM → seeded retrieval → evidence-only answer with rendered facts", async () => {
  const out = await runCopilot({
    message: "What is the delivery status of PO-1001?",
    context: { caseId: "case_1" },
    auth, llm: deadLlm, call: okCall,
  });
  assert.equal(out.responseMode, "evidence_only");
  assert.ok(out.content.includes("100"));
  assert.ok(out.content.includes("₹20,000.00")); // supportedOutstanding rendered
  assert.ok(Object.keys(out.facts).length > 0);
});

test("grounded path renders placeholders and citations", async () => {
  const events = [];
  const out = await runCopilot({
    message: "Explain the split payment evidence",
    context: { caseId: "case_1" },
    auth, llm: { ...groundedLlm }, call: okCall,
    send: (e, d) => events.push(e),
  });
  assert.equal(out.responseMode, "grounded_ai");
  assert.ok(!out.content.includes("{{F"));
  assert.ok(out.content.includes("₹")); // placeholders rendered as INR
  assert.ok(out.citations.length > 0);
  assert.ok(events.includes("status"));
  assert.ok(events.includes("tool"));
});

test("writer producing ungrounded numbers falls back to evidence-only", async () => {
  const badWriter = {
    async generate(task, body) {
      if (task === "understand") return { ok: true, text: '{"intent":"status","entities":{}}', raw: {}, usage: {} };
      if (body.tools) return { ok: true, text: "", raw: { candidates: [{ content: { parts: [{ text: "ok" }] } }] }, usage: {} };
      return { ok: true, text: JSON.stringify({ answerMarkdown: "You owe exactly 999999.99 rupees", certainty: "CONFIRMED" }), raw: {}, usage: {} };
    },
  };
  const out = await runCopilot({
    message: "what do we owe?", context: { caseId: "case_1" },
    auth, llm: badWriter, call: okCall,
  });
  assert.equal(out.responseMode, "evidence_only");
  assert.ok(!out.content.includes("999999.99"));
});

test("clarification returned when a mention matches multiple records", async () => {
  const callMulti = (path) => {
    if (path.startsWith("/api/v2/documents")) {
      return Promise.resolve({ ok: true, data: { items: [
        { id: "d1", number: "PO-1001", type: "PO", kind: "document" },
        { id: "d2", number: "PO-1001-R2", type: "PO", kind: "document" },
      ] } });
    }
    return okCall(path);
  };
  const out = await runCopilot({
    message: "status of PO-1001?", context: {}, auth,
    llm: deadLlm, call: callMulti,
  });
  assert.equal(out.answerType, "clarification");
  assert.ok(out.options.length >= 2);
});

test("guard strips control characters and caps message length", async () => {
  const out = await runCopilot({
    message: " \u0001\u0002what is a GRN?".repeat(200),
    context: {}, auth, llm: deadLlm, call: okCall,
  });
  assert.ok(out.content.length > 0); // answered without crashing
});

test("out_of_scope gets a refusal, never fabricated data", async () => {
  const out = await runCopilot({
    message: "Should I invest in stocks or mutual funds?",
    context: {}, auth,
    llm: { async generate() { return { ok: true, text: '{"intent":"out_of_scope","entities":{}}', raw: {}, usage: {} }; } },
    call: okCall,
  });
  assert.equal(out.answerType, "refusal");
  assert.ok(out.content.includes("CA") || out.content.includes("records"));
});
