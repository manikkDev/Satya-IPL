import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiKeyPool, InMemoryStore, Semaphore } from "../../src/llm/keyPool.js";
import { ptDayKey } from "../../src/llm/ptClock.js";

const MODELS = ["model-a", "model-b"];
const makePool = (nKeys, opts = {}) =>
  new GeminiKeyPool(
    Array.from({ length: nKeys }, (_, i) => `fake-key-${i}`),
    { models: MODELS, rpmLimits: { "model-a": 2, "model-b": 2 }, ...opts },
  );

test("LRU selection rotates across active keys", async () => {
  let t = 1_000_000;
  const pool = makePool(3, { now: () => ++t });
  await pool.init();
  const picks = [pool.select("model-a").alias, pool.select("model-a").alias, pool.select("model-a").alias];
  assert.deepEqual(new Set(picks), new Set(["key-01", "key-02", "key-03"]));
  // next pick wraps to the least-recently-used again
  assert.equal(pool.select("model-a").alias, "key-01");
});

test("per-minute 429 cools only that key; others keep serving", async () => {
  const pool = makePool(2, { now: () => 1_000_000 });
  await pool.init();
  const first = pool.select("model-a");
  pool.recordError(first.alias, "model-a", { kind: "quota_minute", retryAfterMs: 60_000 }, 429);
  const next = pool.select("model-a");
  assert.notEqual(next.alias, first.alias);
  // cooled key is skipped while within cooldown
  assert.equal(pool.select("model-a").alias, next.alias);
});

test("cooling key rejoins after cooldownUntil", async () => {
  let now = 1_000_000;
  const pool = makePool(1, { now: () => now });
  await pool.init();
  pool.select("model-a");
  pool.recordError("key-01", "model-a", { kind: "quota_minute", retryAfterMs: 60_000 }, 429);
  assert.equal(pool.select("model-a"), null);
  now += 61_000;
  assert.equal(pool.select("model-a").alias, "key-01");
});

test("per-day 429 exhausts the model only; key still serves other models", async () => {
  const pool = makePool(1, { now: () => 1_000_000 });
  await pool.init();
  pool.recordError("key-01", "model-a", { kind: "quota_day" }, 429);
  assert.equal(pool.select("model-a"), null);
  assert.equal(pool.select("model-b").alias, "key-01");
  assert.equal(pool.byAlias.get("key-01").state.status, "active");
});

test("key marked exhausted only when every model is day-exhausted", async () => {
  const pool = makePool(1, { now: () => 1_000_000 });
  await pool.init();
  pool.recordError("key-01", "model-a", { kind: "quota_day" }, 429);
  assert.notEqual(pool.byAlias.get("key-01").state.status, "exhausted");
  pool.recordError("key-01", "model-b", { kind: "quota_day" }, 429);
  const st = pool.byAlias.get("key-01").state;
  assert.equal(st.status, "exhausted");
  assert.equal(st.exhaustedDay, ptDayKey(1_000_000));
  assert.equal(pool.select("model-b"), null);
});

test("exhausted key auto-resets on the next Pacific day", async () => {
  // 2026-10-29T20:00:00Z = PT 2026-10-29 13:00 PDT
  let now = Date.parse("2026-10-29T20:00:00Z");
  const pool = makePool(1, { now: () => now });
  await pool.init();
  pool.recordError("key-01", "model-a", { kind: "quota_day" }, 429);
  pool.recordError("key-01", "model-b", { kind: "quota_day" }, 429);
  assert.equal(pool.select("model-a"), null);
  // next PT day starts 2026-10-30T07:00:00Z
  now = Date.parse("2026-10-30T08:00:00Z");
  assert.equal(pool.select("model-a").alias, "key-01");
  assert.equal(pool.byAlias.get("key-01").state.status, "active");
});

test("invalid key is quarantined permanently for the process", async () => {
  const pool = makePool(2, { now: () => 1_000_000 });
  await pool.init();
  pool.recordError("key-01", "model-a", { kind: "invalid_key" }, 400);
  for (let i = 0; i < 5; i++) assert.equal(pool.select("model-a").alias, "key-02");
  assert.equal(pool.keyCounts().invalid, 1);
});

test("local RPM guard skips a key at its per-model limit", async () => {
  const pool = makePool(1, { now: () => 1_000_000 });
  await pool.init();
  pool.noteAttempt("key-01", "model-a");
  pool.noteAttempt("key-01", "model-a"); // rpm=2 reached
  assert.equal(pool.select("model-a"), null);
  assert.equal(pool.select("model-b").alias, "key-01"); // per-model guard
});

test("≥3 keys hitting per-day 429 for one model parks it pool-wide for 10 min", async () => {
  let now = 1_000_000;
  const pool = makePool(4, { now: () => now });
  await pool.init();
  for (const alias of ["key-01", "key-02", "key-03"]) {
    pool.recordError(alias, "model-a", { kind: "quota_day" }, 429);
  }
  assert.ok(pool.isModelParked("model-a"));
  assert.equal(pool.select("model-a"), null); // even key-04 can't serve it
  now += 600_001;
  assert.ok(!pool.isModelParked("model-a"));
});

test("model_missing removes the model for that key only", async () => {
  const pool = makePool(2, { now: () => 1_000_000 });
  await pool.init();
  pool.recordError("key-01", "model-a", { kind: "model_missing" }, 404);
  assert.equal(pool.select("model-a").alias, "key-02");
  assert.equal(pool.select("model-b").alias, "key-01");
});

test("persistence round-trip restores state via the store", async () => {
  const store = new InMemoryStore();
  const pool = makePool(2, { now: () => 1_000_000, store });
  await pool.init();
  pool.recordError("key-01", "model-a", { kind: "quota_day" }, 429);
  pool.recordSuccess("key-02", "model-a", { inputTokens: 5, outputTokens: 7 });
  await pool.flush();
  await pool.close();

  const pool2 = makePool(2, { now: () => 1_000_000, store });
  await pool2.init();
  assert.equal(pool2.select("model-a").alias, "key-02"); // key-01 day-exhausted restored
  const s2 = pool2.byAlias.get("key-02").state;
  assert.equal(s2.perModel["model-a"].inputTokens, 5);
  assert.equal(s2.perModel["model-a"].outputTokens, 7);
});

test("semaphore caps in-flight work and queues the rest", async () => {
  const sem = new Semaphore(2);
  let inFlight = 0;
  let maxSeen = 0;
  const work = async () => {
    await sem.acquire();
    inFlight += 1;
    maxSeen = Math.max(maxSeen, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight -= 1;
    sem.release();
  };
  await Promise.all(Array.from({ length: 8 }, work));
  assert.ok(maxSeen <= 2);
});
