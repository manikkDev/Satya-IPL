import { test } from "node:test";
import assert from "node:assert/strict";
import { runCopilot, isSupplierLevelQuestion, pickSupplier } from "../../src/copilot/pipeline.js";
import { understandFallback } from "../../src/copilot/understand.js";
import { createTools } from "../../src/copilot/tools/index.js";
import { FactRegistry } from "../../src/copilot/facts.js";
import { authFromClaims } from "../../src/middleware/authV2.js";
import { ConversationStore } from "../../src/copilot/memory.js";

const auth = { userId: "u1", groupId: "grp_1", roles: new Set(["ap_manager"]) };
const money = (amount) => ({ amount, currency: "INR" });

const summary = {
  id: "sup_kaveri", name: "Kaveri Pumps & Motors Ltd",
  msme: { category: "small", covered: true, overdue: money("207400.00") },
  outstanding: money("279088.00"), invoiced: money("844408.00"), paid: money("651720.00"),
  credited: money("23600.00"), disputed: money("150000.00"), undisputedOutstanding: money("129088.00"),
  unallocatedPayments: money("110000.00"), openPoAmount: money("750480.00"),
  counts: { openInvoices: 2 },
  openInvoices: [
    { id: "doc_inv_4410", number: "KAV/26-27/4410", date: "2026-10-02", outstanding: money("207400.00"), overdueDays: 12 },
    { id: "doc_inv_0456", number: "KPM/27-28/0456", date: "2027-04-20", outstanding: money("71688.00"), overdueDays: 0 },
  ],
  recentPayments: [{ id: "doc_pay_42", number: "PAY/27-28/0042" }],
  openFindings: { count: 3, items: [{ id: "fnd_1", code: "DUP_PAYMENT", severity: "high" }] },
};

// five documents also carry the supplier's name — the old pipeline asked
// "which one do you mean?" instead of answering
const docs = Array.from({ length: 5 }, (_, i) => ({ id: `doc_${i}`, number: `KAV/DOC/${i}`, type: i % 2 ? "INVOICE_IN" : "PO", seller: { name: "Kaveri Pumps & Motors Ltd" } }));
const calls = [];
const call = (path) => {
  calls.push(path);
  if (path.startsWith("/api/v2/documents?")) return Promise.resolve({ ok: true, data: { items: docs } });
  if (path.startsWith("/api/v2/suppliers?")) return Promise.resolve({ ok: true, data: { items: [{ id: "sup_kaveri", legalName: "Kaveri Pumps & Motors Ltd" }] } });
  if (path.startsWith("/api/v2/suppliers/sup_kaveri/summary")) return Promise.resolve({ ok: true, data: summary });
  return Promise.resolve({ ok: false, status: 404, error: "NOT_FOUND", data: null });
};
const deadLlm = { async generate() { return { ok: false, reason: "all_keys_exhausted" } } };

test("'How much do we owe Kaveri Pumps and why?' answers from the supplier summary, no disambiguation", async () => {
  calls.length = 0;
  const out = await runCopilot({ message: "How much do we owe Kaveri Pumps and why?", context: {}, auth, llm: deadLlm, call });
  assert.notEqual(out.answerType, "clarification");
  assert.equal(out.options, undefined);
  assert.ok(calls.some((p) => p.startsWith("/api/v2/suppliers/sup_kaveri/summary")));
  assert.match(out.content, /Kaveri Pumps & Motors Ltd/);
  assert.match(out.content, /₹2,79,088\.00/); // outstanding
  assert.match(out.content, /KAV\/26-27\/4410/); // cited open invoice
  assert.match(out.content, /₹1,50,000\.00/); // disputed, the "why"
  assert.ok(out.citations.some((c) => c.documentId === "doc_inv_4410"));
  assert.equal(out.graphRef?.supplierId, "sup_kaveri");
});

test("LLM-understood supplier mention resolves the same way", async () => {
  const llm = {
    async generate(task) {
      if (task === "understand") return { ok: true, text: JSON.stringify({ intent: "why_amount", entities: { suppliers: ["Kaveri Pumps"] } }), raw: {}, usage: {} };
      return { ok: false };
    },
  };
  const out = await runCopilot({ message: "what's our outstanding with Kaveri Pumps", context: {}, auth, llm, call });
  assert.notEqual(out.answerType, "clarification");
  assert.match(out.content, /₹2,79,088\.00/);
});

test("supplier helpers", () => {
  assert.equal(isSupplierLevelQuestion("How much do we owe Kaveri?"), true);
  assert.equal(isSupplierLevelQuestion("What is a GRN?"), false);
  assert.deepEqual(understandFallback("How much do we owe Kaveri Pumps and why?").entities.suppliers, ["Kaveri Pumps"]);
  assert.equal(pickSupplier([{ kind: "document", id: "d" }, { kind: "supplier", id: "s", name: "Kaveri Pumps & Motors Ltd" }], "Kaveri Pumps").id, "s");
  assert.equal(pickSupplier([{ kind: "supplier", id: "a", name: "Kaveri Pumps" }, { kind: "supplier", id: "b", name: "Kaveri Valves" }], "Kaveri"), null);
});

test("explain_finding never explains a different finding", async () => {
  const tools = createTools({ call: async () => ({ ok: true, data: { items: [{ id: "fnd_other", code: "X", data: { message: "other" } }] } }) });
  const r = await tools.explain_finding.run({ findingId: "fnd_wanted" }, { registry: new FactRegistry() });
  assert.equal(r.data, null);
  assert.match(r.missing, /fnd_wanted/);
  const tools2 = createTools({ call: async (p) => ({ ok: true, data: { items: [{ id: "fnd_wanted", code: "DUP_PAYMENT", severity: "high", data: { message: "paid twice", amount: "118.00", evidence: [{ documentId: "doc_i" }] } }] }, _p: p }) });
  const r2 = await tools2.explain_finding.run({ findingId: "fnd_wanted" }, { registry: new FactRegistry() });
  assert.equal(r2.data.id, "fnd_wanted");
  assert.equal(r2.data.explanation, "paid twice");
  assert.deepEqual(r2.data.documentIds, ["doc_i"]);
});

test("gateway reads server session claims (gid/mem/prole)", () => {
  const a = authFromClaims({ sub: "usr_v2", id: "mongo1", role: "ap_manager", gid: "grp_9", mem: [{ e: "ent_1", r: ["ap_clerk"] }, { e: "*", r: ["group_admin"] }], prole: "platform_admin" });
  assert.equal(a.groupId, "grp_9");
  assert.equal(a.userId, "mongo1");
  assert.deepEqual([...a.roles].sort(), ["ap_clerk", "ap_manager", "group_admin", "platform_admin"]);
  assert.deepEqual(a.entityIds, ["ent_1", "*"]);
  assert.equal(authFromClaims({ id: "x", groupId: "legacy" }).groupId, "legacy");
});

test("in-memory conversation store is bounded", async () => {
  const store = new ConversationStore(null, { maxConversations: 3 });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await store.create({ userId: "u", groupId: "g", title: `t${i}` })).id);
  assert.equal(store.mem.size, 3);
  assert.equal(await store.get(ids[0], { userId: "u", groupId: "g" }), null);
  const conv = await store.appendMessages(ids[4], { userId: "u", groupId: "g" }, Array.from({ length: 80 }, (_, i) => ({ role: "user", content: String(i) })));
  assert.ok(store.mem.get(conv.id).messages.length <= 60);
});
