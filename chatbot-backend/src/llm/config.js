// config.js — LLM-related env parsing for the gateway.
// Full zod-validated app config lands with task P1-C3; this module is the
// source of truth for key pool, ladders, free-tier limits and data policy.

import { laddersFromEnv } from "./ladder.js";

// Free-tier per-model limits used ONLY for the usage-meter estimate.
// Estimates — verify in AI Studio; Google changes free limits over time.
const DEFAULT_FREE_LIMITS = {
  "gemini-2.5-flash": { rpm: 10, rpd: 250 },
  "gemini-2.5-flash-lite": { rpm: 15, rpd: 1000 },
  "gemini-3.1-flash-lite": { rpm: 15, rpd: 1000 },
  "gemini-3-flash-preview": { rpm: 10, rpd: 250 },
  "gemini-flash-latest": { rpm: 10, rpd: 250 },
  "gemini-flash-lite-latest": { rpm: 15, rpd: 1000 },
  "gemini-embedding-001": { rpm: 100, rpd: 1000 },
};

const csv = (value) =>
  String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Gemini keys: GEMINI_API_KEYS (comma-separated), else legacy single vars. */
export function geminiKeysFromEnv(env = process.env) {
  const pooled = csv(env.GEMINI_API_KEYS);
  if (pooled.length) return [...new Set(pooled)];
  return [env.GEMINI_API_KEY, env.GEMINI_API_KEY2].filter(Boolean);
}

/** {model: {rpm, rpd}} merged over defaults. */
export function freeLimitsFromEnv(env = process.env) {
  let overrides = {};
  try {
    overrides = env.GEMINI_FREE_LIMITS_JSON ? JSON.parse(env.GEMINI_FREE_LIMITS_JSON) : {};
  } catch {
    console.warn("[llm] GEMINI_FREE_LIMITS_JSON is not valid JSON — using defaults");
  }
  return { ...DEFAULT_FREE_LIMITS, ...overrides };
}

export function llmConfigFromEnv(env = process.env) {
  const keys = geminiKeysFromEnv(env);
  const ladders = laddersFromEnv(env);
  const limits = freeLimitsFromEnv(env);
  const rpmLimits = Object.fromEntries(
    Object.entries(limits).map(([model, l]) => [model, l.rpm ?? Infinity]),
  );
  const rpdLimits = Object.fromEntries(
    Object.entries(limits).map(([model, l]) => [model, l.rpd ?? null]),
  );
  return {
    keys,
    ladders,
    rpmLimits,
    rpdLimits,
    // demo_only = free tier may only see sandbox data; paid_or_consented =
    // real customer documents require consent or a paid key (00 §4.8).
    dataPolicy: env.AI_DATA_POLICY === "paid_or_consented" ? "paid_or_consented" : "demo_only",
    groqKey: env.GROQ_KEY || env.GROQ_API_KEY || "",
    groqModel: env.GROQ_MODEL || "openai/gpt-oss-20b",
    groqEnabled: Boolean(env.GROQ_KEY || env.GROQ_API_KEY) && env.SATYA_LLM_PROVIDER !== "off",
    maxKeyAttempts: Number(env.AI_MAX_KEY_ATTEMPTS) || 6,
    requestBudgetMs: Number(env.AI_REQUEST_BUDGET_MS) || 25_000,
    dbUri: env.DB_URI || "",
    dbName: env.APP_DB_NAME || "satya",
    hasKeys: keys.length > 0,
  };
}

/** FEATURE_V2_<NAME> flag — off unless env is exactly "1" or "true". */
export const featureOn = (name, env = process.env) => {
  const v = String(env[`FEATURE_V2_${name}`] || "").toLowerCase();
  return v === "1" || v === "true";
};
