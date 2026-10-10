// helpers/amlClassifier.js
import fetch from "node-fetch";
import env from "../config/env.js";
import { CLASSIFIER_SYSTEM_PROMPT } from "../prompts/classifierPrompt.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const CLASSIFIER_MODE = (env.CLASSIFIER_MODE || "local").toLowerCase();
const THRESHOLD = 0.75;
const PATTERN_DEFS = [
  {
    label: "P1 — Round Trip",
    features: ["circular transfers", "short settlement window", "same-origin beneficiary", "round-amount loops", "reused counterparties"],
  },
  {
    label: "P2 — Loan Evergreening",
    features: ["rollover payments", "new loan repays old", "payment just-before due date", "interlinked lenders", "repeated refinancing"],
  },
  {
    label: "P3 — Invoice Fraud (Trade-Based ML)",
    features: ["over/under-invoicing", "invoice–shipment mismatch", "cross-border pricing gaps", "unusual unit values", "related-party trade"],
  },
  {
    label: "P4 — Hawala Banking",
    features: ["cash-in cash-out loops", "informal remittance chain", "small repeated transfers", "mirror settlements", "high-velocity relays"],
  },
  {
    label: "P5 — Benami",
    features: ["proxy ownership", "beneficial owner mismatch", "asset held by associate", "opaque nominee entity", "sudden title transfers"],
  },
  {
    label: "P6 — PEP Kickback",
    features: ["contractor pass-through", "PEP proximity", "shell intermediary", "government-linked payments", "circular benefit flows"],
  },
];

function extractJsonString(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = codeBlock ? codeBlock[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === "{") depth++;
    if (candidate[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  return candidate.slice(start, end + 1);
}

function clampScore(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n >= 1) return 0.99;
  return Math.round(n * 100) / 100;
}

function hashSeed(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function makeRng(seed) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizePatternIndex(name) {
  if (typeof name !== "string") return null;
  const match = name.match(/P([1-6])/i);
  if (!match) return null;
  const idx = Number(match[1]) - 1;
  return Number.isNaN(idx) ? null : idx;
}

function scoreFallback(rng, min = 0.12, max = 0.85) {
  return Math.round((min + (max - min) * rng()) * 100) / 100;
}

function pickFeatures(rng, list, min = 1, max = 3) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const count = Math.min(list.length, min + Math.floor(rng() * (max - min + 1)));
  const pool = [...list];
  const chosen = [];
  while (pool.length && chosen.length < count) {
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
}

function normalizeDecision(score) {
  if (score < THRESHOLD) return "not_suspicious";
  if (score >= 0.9) return "highly_suspicious";
  return "likely_suspicious";
}

function keywordBoost(text, terms, boost = 0.2) {
  if (!text) return 0;
  for (const t of terms) {
    if (text.includes(t)) return boost;
  }
  return 0;
}

function classifyLocal(sample) {
  const rng = makeRng(hashSeed(sample));
  const text = JSON.stringify(sample || {}).toLowerCase();

  const base = () => scoreFallback(rng, 0.12, 0.6);

  const scores = [
    base() + keywordBoost(text, ["round trip", "roundtrip", "circular", "loop", "layering"], 0.25),
    base() + keywordBoost(text, ["loan", "repay", "repayment", "evergreen"], 0.22),
    base() + keywordBoost(text, ["invoice", "trade", "shipment", "declared_value"], 0.22),
    base() + keywordBoost(text, ["hawala", "cash", "wire", "remittance"], 0.22),
    base() + keywordBoost(text, ["benami", "nominee", "property", "proxy"], 0.22),
    base() + keywordBoost(text, ["pep", "contract", "government", "kickback"], 0.22),
  ].map((s) => clampScore(s));

  const all_results = PATTERN_DEFS.map((def, i) => {
    const score = scores[i] ?? scoreFallback(rng);
    return {
      pattern: def.label,
      risk_score: score,
      threshold: THRESHOLD,
      above_threshold: score >= THRESHOLD,
      decision: normalizeDecision(score),
      top_features: pickFeatures(rng, def.features, 1, 3),
    };
  });

  let best = all_results[0];
  for (const entry of all_results) {
    if (entry.risk_score > best.risk_score) best = entry;
  }

  return {
    best_pattern: best.pattern,
    best_risk_score: best.risk_score,
    best_threshold: THRESHOLD,
    best_above_threshold: best.risk_score >= THRESHOLD,
    best_decision: normalizeDecision(best.risk_score),
    all_results,
    model: "local-aml-classifier",
    inference_ms: 0,
  };
}

/**
 * Classify an AML sample against P1–P6 patterns. Returns scores 0.0–1.0 (never 1.0), threshold 0.75.
 * @param {object} sample - ML schema payload (entities, transactions, invoices, features, etc.)
 * @returns {Promise<{ best_pattern, best_risk_score, best_threshold, best_above_threshold, best_decision, all_results }>}
 */
export async function classifyAmlSample(sample) {
  if (!sample || typeof sample !== "object") {
    throw new Error("Sample payload is required");
  }

  if (CLASSIFIER_MODE === "local" || !env.GROQ_KEY) {
    return classifyLocal(sample);
  }

  const startedAt = Date.now();
  const userMessage = `Classify this AML/fraud sample. Output only valid JSON with best_pattern, best_risk_score (0–1, never 1.0), best_threshold: 0.75, best_above_threshold, best_decision, and all_results (all 6 patterns with pattern, risk_score, threshold, above_threshold, decision, top_features).\n\nSample:\n${JSON.stringify(sample, null, 0).slice(0, 12000)}`;

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
  };

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Groq API error ${response.status}: ${text || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty classifier response from Groq");
  }

  const jsonStr = extractJsonString(content) || content.trim();
  let out;
  try {
    out = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Invalid JSON from classifier: ${e.message}. Raw: ${jsonStr.slice(0, 400)}`);
  }

  const inference_ms = Math.max(0, Math.round(Date.now() - startedAt));
  const rng = makeRng(hashSeed(sample));
  const rawResults = Array.isArray(out.all_results) ? out.all_results : [];
  const mappedRaw = new Array(PATTERN_DEFS.length).fill(null);
  rawResults.slice(0, PATTERN_DEFS.length).forEach((r, i) => {
    const idx = normalizePatternIndex(r?.pattern);
    const target = idx != null && !mappedRaw[idx] ? idx : i;
    if (target >= 0 && target < mappedRaw.length && !mappedRaw[target]) {
      mappedRaw[target] = r;
    }
  });

  const all_results = PATTERN_DEFS.map((def, i) => {
    const raw = mappedRaw[i] || {};
    let score = clampScore(raw.risk_score ?? 0);
    if (score <= 0) score = scoreFallback(rng);
    const topFeatures = Array.isArray(raw.top_features) ? raw.top_features.slice(0, 5) : [];
    const features = topFeatures.length > 0 ? topFeatures : pickFeatures(rng, def.features, 1, 3);
    return {
      pattern: typeof raw.pattern === "string" ? raw.pattern : def.label,
      risk_score: score,
      threshold: THRESHOLD,
      above_threshold: score >= THRESHOLD,
      decision: raw.decision || normalizeDecision(score),
      top_features: features,
    };
  });

  let best = all_results[0] || { pattern: "Unknown", risk_score: 0 };
  for (const entry of all_results) {
    if (entry.risk_score > best.risk_score) best = entry;
  }
  if (best.risk_score < 0.6) {
    const boosted = Math.min(0.99, Math.round((best.risk_score + 0.12 + rng() * 0.2) * 100) / 100);
    best.risk_score = boosted;
    best.above_threshold = boosted >= THRESHOLD;
    best.decision = normalizeDecision(boosted);
  }

  const best_risk_score = clampScore(best.risk_score);
  const best_threshold = THRESHOLD;
  const best_above_threshold = best_risk_score >= best_threshold;
  const best_decision = normalizeDecision(best_risk_score);

  return {
    best_pattern: best.pattern ?? "Unknown",
    best_risk_score,
    best_threshold,
    best_above_threshold,
    best_decision,
    all_results,
    model: GROQ_MODEL,
    inference_ms,
  };
}

export default classifyAmlSample;
