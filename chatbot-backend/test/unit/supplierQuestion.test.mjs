import { test } from "node:test";
import assert from "node:assert/strict";
import { runCopilot } from "../../src/copilot/pipeline.js";
import { readTools } from "../../src/copilot/tools/read.js";
import { SourceRegistry } from "../../src/copilot/sources.js";
import { authFromClaims } from "../../src/middleware/authV2.js";
import { ConversationStore } from "../../src/copilot/memory.js";
import { fakeApi, kaveriSummary } from "../fixtures/fakeApi.mjs";

const auth = { userId: "u1", groupId: "grp_1", roles: new Set(["ap_manager"]) };

test("a supplier name that also appears on many documents resolves to the supplier", async () => {
  // 25 documents carry the supplier's name — must not trigger "which one?"
  const docs = Array.from({ length: 25 }, (_, i) => ({ id: `doc_${i}`, number: `KAV/DOC/${i}`, type: i % 2 ? "INVOICE_IN" : "PO", seller: { name: "Kaveri Pumps & Motors Ltd" } }));
  const { call } = fakeApi({ "/api/v2/documents?": { ok: true, data: { items: docs } } });
  const out = await runCopilot({ message: "How much do we owe Kaveri Pumps and why?", auth, llm: null, call, today: "2026-11-14" });
  assert.notEqual(out.answerType, "clarification");
  assert.match(out.content, /₹2,79,088/);
  assert.match(out.content, /KAV\/26-27\/4410/);
});

test("two suppliers matching one name → a clarification with clickable options", async () => {
  const { call } = fakeApi({
    "/api/v2/suppliers?": { ok: true, data: { items: [{ id: "a", legalName: "Kaveri Pumps" }, { id: "b", legalName: "Kaveri Valves" }] } },
  });
  const out = await runCopilot({ message: "How much do we owe Kaveri?", auth, llm: null, call, today: "2026-11-14" });
  assert.equal(out.answerType, "clarification");
  assert.deepEqual(out.options.map((o) => o.label), ["Kaveri Pumps", "Kaveri Valves"]);
  assert.match(out.options[0].action, /Kaveri Pumps/);
});

test("explain_finding never explains a different finding", async () => {
  const tools = readTools();
  const ctx = (data) => ({ call: async () => ({ ok: true, data }), sources: new SourceRegistry(), scope: {} });
  const r = await tools.explain_finding.run({ findingId: "fnd_wanted" }, ctx({ items: [{ id: "fnd_other", code: "X", data: { message: "other" } }] }));
  assert.match(r.missing, /fnd_wanted/);
  const r2 = await tools.explain_finding.run({ findingId: "fnd_wanted" }, ctx({ items: [{ id: "fnd_wanted", code: "DUP_EXACT_INVOICE", severity: "high", data: { message: "paid twice", amount: "118.00", evidence: [{ documentId: "doc_i" }] } }] }));
  assert.equal(r2.data.id, "fnd_wanted");
  assert.equal(r2.data.detail, "paid twice");
  assert.equal(r2.data.meaning, "exact duplicate invoice");
});

test("supplier summary tool keeps contacts out of the model view", async () => {
  const tools = readTools();
  const r = await tools.get_supplier_summary.run({ supplierId: "sup_kaveri" }, { call: async () => ({ ok: true, data: kaveriSummary }), sources: new SourceRegistry(), scope: {} });
  assert.equal(r.view.hasEmail, true);
  assert.equal(JSON.stringify(r.view).includes("accounts@kaveri.example"), false);
  assert.equal(r.data.contacts.length, 1);
});

test("gateway reads server session claims (gid/mem/prole)", () => {
  const a = authFromClaims({ sub: "usr_v2", id: "mongo1", role: "ap_manager", gid: "grp_9", mem: [{ e: "ent_1", r: ["ap_clerk"] }, { e: "*", r: ["group_admin"] }], prole: "platform_admin" });
  assert.equal(a.groupId, "grp_9");
  assert.equal(a.userId, "mongo1");
  assert.deepEqual([...a.roles].sort(), ["ap_clerk", "ap_manager", "group_admin", "platform_admin"]);
  assert.deepEqual(a.entityIds, ["ent_1", "*"]);
  assert.equal(authFromClaims({ id: "x", groupId: "legacy" }).groupId, "legacy");
});

test("in-memory conversation store is bounded and records action outcomes", async () => {
  const store = new ConversationStore(null, { maxConversations: 3 });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await store.create({ userId: "u", groupId: "g", title: `t${i}` })).id);
  assert.equal(store.mem.size, 3);
  assert.equal(await store.get(ids[0], { userId: "u", groupId: "g" }), null);
  const conv = await store.appendMessages(ids[4], { userId: "u", groupId: "g" }, Array.from({ length: 80 }, (_, i) => ({ role: "user", content: String(i) })));
  assert.ok(store.mem.get(conv.id).messages.length <= 60);
  await store.appendMessages(ids[4], { userId: "u", groupId: "g" }, [{ role: "assistant", content: "x", actions: [{ id: "act_1", status: "proposed" }] }]);
  assert.ok(await store.setActionResult(ids[4], { userId: "u", groupId: "g" }, "act_1", { status: "confirmed" }));
  assert.equal(await store.setActionResult(ids[4], { userId: "other", groupId: "g" }, "act_1", { status: "confirmed" }), null);
  const list = await store.list({ userId: "u", groupId: "g" });
  assert.ok(list.every((c) => c.id && c.messageCount !== undefined && !c.messages));
});
