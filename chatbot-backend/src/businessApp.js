import express from "express";
import cors from "cors";
import businessRouter from "./routers/businessRouter.js";

const app = express();
const origins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",");
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes(origin)), allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "64kb" }));
app.use("/api/chat", businessRouter);
app.get("/health", (_req, res) => res.json({ ok: true, service: "satya-business-copilot", retrieval: "authorized_business_tools_and_neo4j", narration: "deterministic_evidence", externalDocumentLLM: false }));
app.get("/", (_req, res) => res.json({ service: "Satya copilot" }));
app.use((error, _req, res, _next) => res.status(error.status || 503).json({ message: error.status && error.status < 500 ? error.message : "Business evidence service unavailable; please retry" }));
export default app;
