// index.js — process-level wiring for the LLM stack.
// Built lazily so importing modules never performs network I/O (tests stay
// hermetic). Startup does one models.list to filter ladders by availability.

import { GeminiKeyPool } from "./keyPool.js";
import { GeminiClient } from "./gemini.js";
import { ModelLadders } from "./ladder.js";
import { AiGateway } from "./gateway.js";
import { UsageMeter } from "./usage.js";
import { GroqProvider } from "./providers/groq.js";
import { createStores } from "./store.js";
import { llmConfigFromEnv } from "./config.js";

let built = null; // {config, ladders, pool, client, gateway, meter, mongo, db}
let building = null;

export async function initLlm(env = process.env) {
  if (built) return built;
  if (building) return building;
  building = (async () => {
    const config = llmConfigFromEnv(env);
    const ladders = new ModelLadders(config.ladders);
    const { keyStateStore, dailyStore, mongo, db } = await createStores({
      dbUri: config.dbUri,
      dbName: config.dbName,
    });
    const pool = new GeminiKeyPool(config.keys, {
      models: ladders.allModels(),
      rpmLimits: config.rpmLimits,
      store: keyStateStore,
    });
    await pool.init();
    const client = new GeminiClient({});
    const meter = new UsageMeter(pool, { rpdLimits: config.rpdLimits, ladders, dailyStore });
    const groq = config.groqEnabled
      ? new GroqProvider({ apiKey: config.groqKey, model: config.groqModel })
      : null;
    const gateway = new AiGateway({
      pool,
      ladders,
      client,
      groq,
      meter,
      maxAttempts: config.maxKeyAttempts,
      budgetMs: config.requestBudgetMs,
    });
    built = { config, ladders, pool, client, gateway, meter, mongo, db };
    console.log(
      `[llm] gateway ready: ${config.keys.length} key(s), chat ladder: ${config.ladders.chat.join(" → ")}, dataPolicy=${config.dataPolicy}, mongo=${mongo ? "on" : "off"}`,
    );
    // One models.list to filter ladders; failure just keeps the env ladder.
    void refreshModelAvailability().catch(() => {});
    return built;
  })();
  try {
    return await building;
  } finally {
    building = null;
  }
}

/** Re-check which models this project can call; safe to run anytime. */
export async function refreshModelAvailability() {
  if (!built) return;
  const { pool, client, ladders } = built;
  for (const model of ladders.allModels().slice(0, 1)) {
    const pick = pool.select(model);
    if (pick) {
      try {
        const names = await client.listModels(pick.key);
        if (names.length) ladders.applyAvailability(names);
      } catch (error) {
        const classified = error?.classified;
        if (classified) pool.recordError(pick.alias, model, classified, error?.httpStatus ?? null);
        console.warn(`[llm] models.list failed (${error.message}) — keeping configured ladders`);
      }
      return;
    }
  }
}

export function llmHealth() {
  if (!built || !built.config.hasKeys) {
    return { llm: built ? "evidence_only" : "degraded", keys: 0 };
  }
  const { pool, ladders } = built;
  const chatUsable = ladders.forTask("chat").some((m) => pool.eligibleKeys(m).length > 0);
  const counts = pool.keyCounts();
  let llm = "available";
  if (!chatUsable) llm = "evidence_only";
  else if (counts.active <= counts.total / 2 || counts.exhausted > 0) llm = "degraded";
  return { llm, keys: counts.total, ...counts };
}

export const getGateway = async () => (await initLlm()).gateway;
export const getMeter = async () => (await initLlm()).meter;
export const getPool = async () => (await initLlm()).pool;

/** Test hook: reset the singleton (never used by app code). */
export async function _resetLlmForTests() {
  if (built?.pool) await built.pool.close().catch(() => {});
  if (built?.mongo) await built.mongo.close().catch(() => {});
  built = null;
}
