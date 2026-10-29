import express from "express";
import cors from "cors";
import businessRouter from "./routers/businessRouter.js";
import aiUsageRouter from "./routes/aiUsage.js";
import copilotRouter from "./routes/copilot.js";
import internalRouter from "./routes/internal.js";
import { statusPage } from "./statusPage.js";
import { initLlm, llmHealth } from "./llm/index.js";
import { config, allowedOrigins } from "./config.js";
import { requestId } from "./middleware/requestId.js";
import { rateLimit, userKey } from "./middleware/rateLimit.js";

const app = express();
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), allowedHeaders: ["Content-Type", "Authorization", "x-request-id", "x-internal-token"] }));
app.use(requestId);
// /internal mounts first: it carries page images and has its own larger
// body limit, so it must run before the 64 kb parser consumes the stream.
app.use("/internal", internalRouter);
app.use(express.json({ limit: "64kb" }));
app.use("/api/chat", rateLimit({ max: config.RATE_LIMIT_COPILOT_PER_MIN, keyFn: userKey, message: "Copilot is busy — retry in a moment" }), businessRouter);
app.use("/api/v2/copilot", copilotRouter);
app.use("/api/v2/ai/usage", rateLimit({ max: config.RATE_LIMIT_V2_PER_MIN, keyFn: userKey }), aiUsageRouter);
app.get("/health", (_req, res) => res.json({ ok: true, service: "satya-ai-gateway", llm: llmHealth().llm, retrieval: "authorized_business_tools_and_neo4j", narration: "deterministic_evidence", externalDocumentLLM: false }));
app.get("/ready", (_req, res) => {
  const health = llmHealth();
  res.json({ ok: true, service: "satya-ai-gateway", llm: health.llm, keys: health.keys ?? 0 });
});
app.get("/", (req, res) => {
  if (req.accepts("text/html")) return res.type("html").send(statusPage());
  res.json({ service: "Satya copilot" });
});
app.use((error, req, res, _next) => {
  // v2/internal routes answer with the shared contract error shape.
  if (req.path.startsWith("/api/v2") || req.path.startsWith("/internal")) {
    const status = error.status && error.status < 500 ? error.status : 503;
    return res.status(status).json({
      error: {
        code: error.code || (status === 503 ? "UPSTREAM_UNAVAILABLE" : "INTERNAL_ERROR"),
        message: status < 500 ? error.message : "The AI gateway is temporarily unavailable — retry shortly",
        requestId: req.id,
      },
    });
  }
  return res.status(error.status || 503).json({ message: error.status && error.status < 500 ? error.message : "Business evidence service unavailable; please retry" });
});

// Warm the key pool in the background; never blocks boot or crashes on
// missing keys/Mongo — the gateway degrades to evidence-only instead.
void initLlm().catch((error) => console.warn(`[llm] init deferred: ${error.message}`));

export default app;
