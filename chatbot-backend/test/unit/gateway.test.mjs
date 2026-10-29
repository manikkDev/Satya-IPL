import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiKeyPool } from "../../src/llm/keyPool.js";
import { AiGateway } from "../../src/llm/gateway.js";
import { ModelLadders } from "../../src/llm/ladder.js";
import { UsageMeter } from "../../src/llm/usage.js";
import { GeminiHttpError } from "../../src/llm/errors.js";

const ladders = new ModelLadders({
  chat: ["model-a", "model-b"],
  embed: ["embed-1"],
});

/** Scriptable fake client: responses[keyed `${alias}:${model}`] or per-model. */
const fakeClient = (plan) => ({
  calls: [],
  async generateContent(model, key, body) {
    const alias = this.calls.length; // index order only for tracing
    this.calls.push({ model, keyTail: key.slice(-4), body });
    const step = plan.find((p) => p.match?.(model, key, this.calls.length)) || {};
    if (step.error) throw step.error;
    return {
      text: step.text || `ok-${model}`,
      raw: { candidates: [{ content: { parts: [{ text: step.text || `ok-${model}` }] } }] },
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
});

const http429Day = () => new GeminiHttpError(429, { error: { message: "GenerateRequestsPerDayPerProjectPerModel exceeded" } });
const http429Minute = () => new GeminiHttpError(429, { error: { message: "rate limit" } });
const http503 = () => new GeminiHttpError(503, {});
const http404 = () => new GeminiHttpError(404, {});
const http400Key = () => new GeminiHttpError(400, { error: { status: "API_KEY_INVALID" } });

const makeGateway = async (client, { keys = ["k1", "k2", "k3"], maxAttempts = 6, now } = {}) => {
  const pool = new GeminiKeyPool(keys, { models: ["model-a", "model-b", "embed-1"], rpmLimits: { "model-a": 50, "model-b": 50, "embed-1": 50 }, now });
  await pool.init();
  const meter = new UsageMeter(pool, { rpdLimits: { "model-a": 10, "model-b": 10 }, ladders, now });
  const gateway = new AiGateway({ pool, ladders, client, meter, maxAttempts, budgetMs: 25_000, now });
  return { pool, gateway, meter };
};

const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };

test("429-minute rotates to the next key and succeeds", async () => {
  const client = fakeClient([
    { match: (m, k, n) => n === 1, error: http429Minute() },
    { match: (m, k, n) => n === 2, text: "second key works" },
  ]);
  const { gateway } = await makeGateway(client);
  const out = await gateway.generate("chat", body);
  assert.equal(out.ok, true);
  assert.equal(out.text, "second key works");
  assert.equal(out.attempts, 2);
});

test("429-day on all keys for a model falls down the ladder", async () => {
  const client = fakeClient([
    { match: (m) => m === "model-a", error: http429Day() },
    { match: (m) => m === "model-b", text: "backup model" },
  ]);
  const { gateway } = await makeGateway(client);
  const out = await gateway.generate("chat", body);
  assert.equal(out.ok, true);
  assert.equal(out.model, "model-b");
  assert.equal(out.text, "backup model");
});

test("404 removes the model for that key but keeps it for others", async () => {
  const client = fakeClient([
    { match: (m, k, n) => n === 1 && m === "model-a", error: http404() },
    { match: () => true, text: "served" },
  ]);
  const { gateway, pool } = await makeGateway(client);
  const out = await gateway.generate("chat", body);
  assert.equal(out.ok, true);
  assert.equal(out.keyAlias, "key-02"); // first key lost model-a after its 404
  assert.ok(pool.byAlias.get("key-01").state.missingModels.includes("model-a"));
});

test("invalid key is quarantined; failover continues on the next key", async () => {
  const client = fakeClient([
    { match: (m, k, n) => n === 1, error: http400Key() },
    { match: () => true, text: "alive" },
  ]);
  const { gateway, pool } = await makeGateway(client);
  const out = await gateway.generate("chat", body);
  assert.equal(out.ok, true);
  assert.equal(pool.keyCounts().invalid, 1);
});

test("transient 503 retries on a different key after jitter", async () => {
  const client = fakeClient([
    { match: (m, k, n) => n === 1, error: http503() },
    { match: () => true, text: "recovered" },
  ]);
  const { gateway, pool } = await makeGateway(client);
  const out = await gateway.generate("chat", body);
  assert.equal(out.ok, true);
  assert.equal(out.text, "recovered");
  assert.equal(client.calls.length, 2);
});

test("all keys + models exhausted → evidence_only, never throws", async () => {
  const client = fakeClient([{ match: () => true, error: http429Day() }]);
  const { gateway, pool } = await makeGateway(client, { keys: ["k1", "k2"] });
  const out = await gateway.generate("chat", body);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "all_keys_exhausted");
  // keys are day-exhausted on the chat models → nothing can serve chat
  assert.equal(pool.eligibleKeys("model-a").length, 0);
  assert.equal(pool.eligibleKeys("model-b").length, 0);
});

test("retry budget: no key for a model does not burn attempts", async () => {
  const client = fakeClient([{ match: () => true, error: http429Day() }]);
  const { gateway } = await makeGateway(client, { keys: ["only"], maxAttempts: 6 });
  await gateway.generate("chat", body);
  // one key, one attempt per model → model-a 1 attempt, model-b 1 attempt
  assert.equal(client.calls.length, 2);
});

test("Groq secondary provider is used before evidence-only", async () => {
  const client = fakeClient([{ match: () => true, error: http429Day() }]);
  const pool = new GeminiKeyPool(["k1"], { models: ["model-a", "model-b"] });
  await pool.init();
  const groq = {
    enabled: true,
    model: "groq-model",
    async generate() {
      return { text: "groq answer", raw: {}, usage: { inputTokens: 3, outputTokens: 4 } };
    },
  };
  const gateway = new AiGateway({ pool, ladders, client, groq });
  const out = await gateway.generate("chat", body);
  assert.equal(out.ok, true);
  assert.equal(out.provider, "groq");
  assert.equal(out.text, "groq answer");
});

test("semaphore admits at most 4 concurrent LLM calls", async () => {
  let inFlight = 0;
  let maxSeen = 0;
  const client = {
    async generateContent() {
      inFlight += 1;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
      return { text: "ok", raw: {}, usage: {} };
    },
  };
  const { gateway } = await makeGateway(client, { keys: ["a", "b", "c", "d", "e", "f"] });
  await Promise.all(Array.from({ length: 10 }, () => gateway.generate("chat", body)));
  assert.ok(maxSeen <= 4, `saw ${maxSeen}`);
});

test("usage meter records tokens on success", async () => {
  const client = fakeClient([{ match: () => true }]);
  const { gateway, meter } = await makeGateway(client);
  await gateway.generate("chat", body);
  const rows = [...meter.day.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inputTokens, 10);
  assert.equal(rows[0].outputTokens, 5);
});
