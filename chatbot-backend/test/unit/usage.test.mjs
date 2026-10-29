import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiKeyPool } from "../../src/llm/keyPool.js";
import { ModelLadders } from "../../src/llm/ladder.js";
import { UsageMeter } from "../../src/llm/usage.js";
import { ptDayKey } from "../../src/llm/ptClock.js";

const ladders = new ModelLadders({ chat: ["model-a", "model-b"], embed: ["embed-1"] });

const make = async ({ keys = ["k1", "k2"], rpd = 20, now = () => Date.parse("2026-10-29T20:00:00Z") } = {}) => {
  const pool = new GeminiKeyPool(keys, {
    models: ["model-a", "model-b", "embed-1"],
    rpmLimits: { "model-a": 5, "model-b": 5, "embed-1": 5 },
    now,
  });
  await pool.init();
  const meter = new UsageMeter(pool, {
    rpdLimits: { "model-a": rpd, "model-b": rpd },
    ladders,
    now,
  });
  return { pool, meter };
};

test("summary matches contract 02 §7 shape", async () => {
  const { meter } = await make();
  const s = meter.summary();
  assert.equal(s.mode, "llm");
  assert.ok(Array.isArray(s.models));
  const chatA = s.models.find((m) => m.model === "model-a" && m.task === "chat");
  assert.equal(chatA.remainingToday, 40); // 20 rpd × 2 keys
  assert.equal(chatA.limitToday, 40);
  assert.equal(chatA.estimate, true);
  assert.deepEqual(s.keys, { total: 2, active: 2, cooling: 0, exhausted: 0, invalid: 0 });
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(s.resetsAt));
  assert.equal(s.currentKeyAlias, undefined); // non-admin
});

test("remainingToday subtracts per-key usage, excludes exhausted/invalid keys", async () => {
  const { pool, meter } = await make();
  pool.noteAttempt("key-01", "model-a");
  pool.noteAttempt("key-01", "model-a");
  pool.noteAttempt("key-01", "model-a"); // 3 used on key-01
  pool.recordError("key-02", "model-a", { kind: "quota_day" }, 429); // model-a dead on key-02
  pool.recordError("key-02", "model-b", { kind: "quota_day" }, 429); // key-02 fully exhausted
  const s = meter.summary();
  const chatA = s.models.find((m) => m.model === "model-a" && m.task === "chat");
  assert.equal(chatA.remainingToday, 17); // key-01: 20−3; key-02 excluded
  assert.equal(chatA.limitToday, 20);     // only eligible keys counted
});

test("cooling keys still count toward remaining capacity", async () => {
  const { pool, meter } = await make();
  pool.recordError("key-01", "model-a", { kind: "quota_minute", retryAfterMs: 60_000 }, 429);
  const s = meter.summary();
  const chatA = s.models.find((m) => m.model === "model-a" && m.task === "chat");
  assert.equal(chatA.remainingToday, 40);
  assert.equal(s.keys.cooling, 1);
});

test("mode is evidence_only when no key can serve the chat ladder", async () => {
  const { pool, meter } = await make({ keys: ["k1"] });
  pool.recordError("key-01", "model-a", { kind: "quota_day" }, 429);
  pool.recordError("key-01", "model-b", { kind: "quota_day" }, 429);
  const s = meter.summary();
  assert.equal(s.mode, "evidence_only");
  // key stays 'active' (embed-1 is still viable) but cannot serve chat
  assert.equal(s.keys.active, 1);
  assert.equal(pool.eligibleKeys("model-a").length, 0);
});

test("currentKeyAlias appears only for admins", async () => {
  const { pool, meter } = await make();
  pool.select("model-a"); // lastUsed = key-01
  const admin = meter.summary({ isAdmin: true });
  const user = meter.summary({ isAdmin: false });
  assert.equal(admin.currentKeyAlias, "key-01");
  assert.equal(user.currentKeyAlias, undefined);
});

test("summary is cached for 5 s and invalidated by new usage", async () => {
  let now = Date.parse("2026-10-29T20:00:00Z");
  const { pool, meter } = await make({ now: () => now });
  const a = meter.summary();
  const b = meter.summary();
  assert.equal(b, a); // same cached object
  pool.noteAttempt("key-01", "model-a");
  const c = meter.summary();
  assert.notEqual(c, a);
  assert.equal(c.models.find((m) => m.model === "model-a").remainingToday, 39);
});

test("daily counters aggregate per (day, model, task)", async () => {
  const { meter } = await make();
  meter.record({ task: "chat", model: "model-a", usage: { inputTokens: 10, outputTokens: 5 } });
  meter.record({ task: "chat", model: "model-a", usage: { inputTokens: 4, outputTokens: 2 } });
  meter.record({ task: "extract", model: "model-a", usage: { inputTokens: 100, outputTokens: 50 } });
  const chatRow = meter.day.get(`${ptDayKey()}|model-a|chat`);
  const extRow = meter.day.get(`${ptDayKey()}|model-a|extract`);
  assert.deepEqual({ in: chatRow.inputTokens, out: chatRow.outputTokens, n: chatRow.requests }, { in: 14, out: 7, n: 2 });
  assert.equal(extRow.requests, 1);
});

test("abbreviated() emits the compact SSE usage event", async () => {
  const { meter } = await make();
  const a = meter.abbreviated();
  assert.deepEqual(Object.keys(a).sort(), ["keys", "mode", "resetsAt"]);
});
