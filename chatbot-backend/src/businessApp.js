import express from "express";
import cors from "cors";
import businessRouter from "./routers/businessRouter.js";
import aiUsageRouter from "./routes/aiUsage.js";
import { statusPage } from "./statusPage.js";
import { initLlm, llmHealth } from "./llm/index.js";

const app = express();
const origins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",");
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes(origin)), allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "64kb" }));
app.use("/api/chat", businessRouter);
app.use("/api/v2/ai/usage", aiUsageRouter);
app.get("/health", (_req, res) => res.json({ ok: true, service: "satya-ai-gateway", llm: llmHealth().llm, retrieval: "authorized_business_tools_and_neo4j", narration: "deterministic_evidence", externalDocumentLLM: false }));
app.get("/ready", (_req, res) => {
  const health = llmHealth();
  res.json({ ok: true, service: "satya-ai-gateway", llm: health.llm, keys: health.keys ?? 0 });
});
app.get("/", (req, res) => {
  if (req.accepts("text/html")) return res.type("html").send(statusPage());
  res.json({ service: "Satya copilot" });
});
app.use((error, _req, res, _next) => res.status(error.status || 503).json({ message: error.status && error.status < 500 ? error.message : "Business evidence service unavailable; please retry" }));

// Warm the key pool in the background; never blocks boot or crashes on
// missing keys/Mongo — the gateway degrades to evidence-only instead.
void initLlm().catch((error) => console.warn(`[llm] init deferred: ${error.message}`));

export default app;
