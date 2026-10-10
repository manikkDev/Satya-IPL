// helpers/mlSchemaGenerator.js
import fetch from "node-fetch";
import env from "../config/env.js";
import { ML_SCHEMA_SYSTEM_PROMPT } from "../prompts/mlSchemaPrompt.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

/** Pattern hint: P1–P6 or pattern name; optional, helps Groq pick the right schema */
const PATTERN_ALIASES = {
  p1: "P1",
  "round trip": "P1",
  "roundtrip": "P1",
  p2: "P2",
  "loan evergreening": "P2",
  "evergreening": "P2",
  p3: "P3",
  "invoice fraud": "P3",
  "trade-based": "P3",
  "trade based ml": "P3",
  p4: "P4",
  "hawala": "P4",
  "hawala banking": "P4",
  p5: "P5",
  "benami": "P5",
  p6: "P6",
  "pep kickback": "P6",
  "pep": "P6",
};

/**
 * Extract a single JSON object from model output (strip markdown code blocks if present).
 * @param {string} raw
 * @returns {string|null}
 */
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

/**
 * Generate ML-ready JSON in one of the P1–P6 formats by sending the user prompt to Groq.
 * @param {string} userPrompt - User's scenario or description (e.g. "two companies in India and Mauritius doing round trip")
 * @param {{ pattern?: string }} options - Optional pattern hint: "P1".."P6" or alias (e.g. "Round Trip", "Hawala")
 * @returns {Promise<{ payload: object, pattern: string, sample_id: string }>}
 */
export async function generateMlSchema(userPrompt, options = {}) {
  if (!userPrompt || typeof userPrompt !== "string") {
    throw new Error("User prompt is required");
  }

  if (!env.GROQ_KEY) {
    throw new Error("GROQ_KEY is not set; cannot call Groq for ML schema generation");
  }

  const patternHint = (options.pattern || "").trim().toLowerCase();
  const resolvedPattern = patternHint && PATTERN_ALIASES[patternHint];
  const userMessage = resolvedPattern
    ? `Pattern to use: ${resolvedPattern}. User scenario or request:\n${userPrompt}`
    : userPrompt;

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: ML_SCHEMA_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.2,
    max_tokens: 8192,
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
    throw new Error("Empty response from Groq for ML schema generation");
  }

  const jsonStr = extractJsonString(content) || content.trim();
  let payload;
  try {
    payload = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Invalid JSON from Groq: ${e.message}. Raw: ${jsonStr.slice(0, 500)}`);
  }

  const sampleId = payload.sample_id || "unknown";
  const pattern = (payload.sample_id || "").match(/^P(\d)/)
    ? `P${payload.sample_id.match(/^P(\d)/)[1]}`
    : "unknown";

  return {
    payload,
    pattern,
    sample_id: sampleId,
  };
}

export default generateMlSchema;
