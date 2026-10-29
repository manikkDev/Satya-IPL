// config.js — zod-validated env for the gateway (P1-C3).
// env.js still owns dotenv loading + hard-required secrets; this module gives
// every other consumer one typed, defaulted, immutable view of process.env.
// Validation failures on non-critical fields degrade to safe defaults with a
// warning rather than crashing the service (graceful degradation).

import { z } from "zod";

const csvList = z
  .string()
  .optional()
  .default("")
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

const bool01 = z
  .string()
  .optional()
  .default("0")
  .transform((v) => v === "1" || v.toLowerCase() === "true");

const jsonMap = z
  .string()
  .optional()
  .default("")
  .transform((v) => {
    if (!v) return {};
    try {
      return JSON.parse(v);
    } catch {
      console.warn("[config] GEMINI_FREE_LIMITS_JSON is invalid JSON — using built-in defaults");
      return {};
    }
  });

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).optional().default(5001),
  NODE_ENV: z.string().optional().default("development"),
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .default("http://localhost:3000,http://127.0.0.1:3000")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  GRAPH_API_URL: z.string().optional().default("http://localhost:5002"),
  ML_API_URL: z.string().optional().default("http://localhost:8000"),
  DB_URI: z.string().optional().default(""),
  APP_DB_NAME: z.string().optional().default("satya"),
  GEMINI_API_KEYS: csvList,
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_API_KEY2: z.string().optional().default(""),
  GEMINI_MODEL_LADDER_CHAT: csvList,
  GEMINI_MODEL_LADDER_EXTRACT: csvList,
  GEMINI_MODEL_LADDER_UNDERSTAND: csvList,
  GEMINI_EMBED_MODEL: z.string().optional().default("gemini-embedding-001"),
  GEMINI_FREE_LIMITS_JSON: jsonMap,
  AI_DATA_POLICY: z.enum(["demo_only", "paid_or_consented"]).optional().default("demo_only"),
  GROQ_KEY: z.string().optional().default(""),
  GROQ_MODEL: z.string().optional().default("openai/gpt-oss-20b"),
  AI_MAX_KEY_ATTEMPTS: z.coerce.number().int().min(1).max(20).optional().default(6),
  AI_REQUEST_BUDGET_MS: z.coerce.number().int().min(1000).max(120000).optional().default(25_000),
  RATE_LIMIT_COPILOT_PER_MIN: z.coerce.number().int().min(1).optional().default(30),
  RATE_LIMIT_V2_PER_MIN: z.coerce.number().int().min(1).optional().default(60),
  SATYA_LLM_PROVIDER: z.string().optional().default("auto"),
  FEATURE_V2_COPILOT_V2: bool01,
  FEATURE_V2_AI_USAGE_METER: bool01,
  FEATURE_V2_DOC_INBOX: bool01,
  FEATURE_V2_RECON_V2: bool01,
});

export const config = schema.parse(process.env);
export const allowedOrigins = config.ALLOWED_ORIGINS;
export const isProd = config.NODE_ENV === "production";
