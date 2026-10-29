// routes/internal.js — service-to-service endpoints (contract 02 §7):
//   POST /internal/llm/extract  document extraction (data-policy gated)
//   POST /internal/llm/embed    embeddings for callers (taskType, dims 768)
//   POST /internal/rag/index    chunk+embed+store a source's text
// Auth: x-internal-token only (requireInternalToken). Extraction is
// rate-limited per contract (20/min/service).

import express from "express";
import { requireInternalToken } from "../middleware/internalToken.js";
import { rateLimit, serviceKey } from "../middleware/rateLimit.js";
import { getGateway, initLlm } from "../llm/index.js";
import { llmConfigFromEnv } from "../llm/config.js";
import { extractDocument, classifyDocumentType } from "../extract/extract.js";
import { getRag } from "../rag/index.js";
import { embedOne, EMBED_DIMS } from "../rag/embed.js";

const router = express.Router();
router.use(requireInternalToken);
router.use(express.json({ limit: "6mb" })); // page images ride this body

router.post(
  "/llm/extract",
  rateLimit({ max: 20, keyFn: serviceKey, message: "Extraction rate limit reached — retry shortly" }),
  async (req, res) => {
    const { task = "generic", pageImages = [], text, schemaVersion = "v1", dataPolicy = "demo" } = req.body || {};
    if (!text && !pageImages?.length) {
      return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "Provide text or up to 3 page images", requestId: req.id } });
    }
    if (Array.isArray(pageImages) && pageImages.length > 3) {
      return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "At most 3 page images", details: { fields: ["pageImages"] }, requestId: req.id } });
    }
    try {
      const llm = await getGateway();
      const envPolicy = llmConfigFromEnv().dataPolicy;
      const resolvedTask = task === "generic" && text ? classifyDocumentType(text) : task;
      const result = await extractDocument({
        llm, task: resolvedTask, text, pageImages, dataPolicy, envPolicy, schemaVersion,
      });
      return res.json({
        extracted: result.extracted,
        fieldConfidence: result.fieldConfidence,
        quotes: result.quotes,
        model: result.model,
        usage: result.usage,
      });
    } catch (error) {
      const status = error.status || 503;
      return res.status(status).json({
        error: { code: error.code || "AI_UNAVAILABLE", message: status < 500 ? error.message : "AI extraction is temporarily unavailable", requestId: req.id },
      });
    }
  },
);

router.post("/llm/embed", async (req, res) => {
  const { texts, taskType = "RETRIEVAL_DOCUMENT" } = req.body || {};
  if (!Array.isArray(texts) || !texts.length || texts.length > 100) {
    return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "texts must be a non-empty array (max 100)", requestId: req.id } });
  }
  try {
    const llm = await getGateway();
    const vectors = [];
    for (const t of texts) {
      const r = await embedOne(llm, String(t).slice(0, 20_000), taskType);
      if (!r.ok) return res.status(503).json({ error: { code: "AI_UNAVAILABLE", message: "Embeddings temporarily unavailable", requestId: req.id } });
      vectors.push(r.vector);
    }
    return res.json({ vectors, model: "gemini-embedding-001", dims: EMBED_DIMS });
  } catch (error) {
    return res.status(503).json({ error: { code: "AI_UNAVAILABLE", message: "Embeddings temporarily unavailable", requestId: req.id } });
  }
});

router.post("/rag/index", async (req, res) => {
  const { groupId, sourceType, sourceId, text, pages, title } = req.body || {};
  if (!groupId || !sourceType || !sourceId || (typeof text !== "string" && !Array.isArray(pages))) {
    return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "groupId, sourceType, sourceId and text|pages are required", requestId: req.id } });
  }
  const rag = await getRag();
  if (!rag) return res.status(503).json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Indexing is temporarily unavailable", details: { service: "rag" }, requestId: req.id } });
  try {
    const result = await rag.index({ groupId, sourceType, sourceId, text: text || "", pages, title });
    return res.json(result);
  } catch (error) {
    return res.status(503).json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Indexing failed — retry later", requestId: req.id } });
  }
});

export default router;
