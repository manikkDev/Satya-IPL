// routes/aiUsage.js — GET /api/v2/ai/usage (contract 02 §7).
// Behind FEATURE_V2_AI_USAGE_METER. JWT required; currentKeyAlias only for
// platform_admin / group_admin. Payload is cached 5 s inside UsageMeter.

import express from "express";
import { requireJwt, isAdmin } from "../middleware/authV2.js";
import { getMeter } from "../llm/index.js";
import { featureOn } from "../llm/config.js";

const router = express.Router();

router.use((req, res, next) => {
  if (!featureOn("AI_USAGE_METER")) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "This feature is not enabled" } });
  }
  return next();
});

router.get("/", requireJwt, async (_req, res) => {
  try {
    const meter = await getMeter();
    res.set("cache-control", "private, max-age=5");
    return res.json(meter.summary({ isAdmin: isAdmin(_req.auth) }));
  } catch (error) {
    return res.status(503).json({
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "AI usage information is temporarily unavailable",
        details: { service: "gemini" },
        retryAfterMs: 5000,
      },
    });
  }
});

export default router;
