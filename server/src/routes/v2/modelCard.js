import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { engineGet } from "../../services/engine.js";

// PUBLIC, read-only: GET /api/v2/meta/model-card
// Proxies the engine's aggregate of committed evaluation artifacts
// (ml-fl-service/models/*/{model_card,evaluation}.json — no retraining) and
// adds the copilot evaluation report when the server can read it.
// Shape is documented in ml-fl-service/models/README.md and kept stable for
// the UI. Cached in-process for 10 minutes; an engine outage returns the last
// good payload (stale: true) or 503 with a retry hint.
const router = express.Router();
const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, body: null };

const here = dirname(fileURLToPath(import.meta.url));
const COPILOT_REPORT = process.env.COPILOT_EVAL_REPORT_PATH || join(here, "../../../../chatbot-backend/eval-report.json");

const readCopilot = async () => {
  try {
    return JSON.parse(await readFile(COPILOT_REPORT, "utf8"));
  } catch {
    return null;
  }
};

export const buildModelCard = async () => {
  const card = await engineGet("/v2/models/card", { timeoutMs: 15000 });
  const copilot = card.copilot ?? (await readCopilot());
  return {
    generatedAt: card.generatedAt,
    honesty: card.honesty,
    models: card.models || [],
    allocation: card.allocation ?? null,
    extraction: card.extraction ?? null,
    anomaly: card.anomaly ?? null,
    supplierDedupe: card.supplierDedupe ?? null,
    copilot: copilot ?? null,
    references: card.references || [],
  };
};

router.get("/", async (req, res) => {
  const fresh = cache.body && Date.now() - cache.at < TTL_MS;
  if (fresh && req.query.refresh !== "1") return res.set("cache-control", "public, max-age=300").json(cache.body);
  try {
    const body = await buildModelCard();
    cache = { at: Date.now(), body };
    res.set("cache-control", "public, max-age=300").json(body);
  } catch (error) {
    if (cache.body) return res.json({ ...cache.body, stale: true });
    res.status(503).json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Model card unavailable — the engine may be waking up", details: { service: "engine", retryAfterMs: 15000 }, requestId: req.id } });
  }
});

export default router;
