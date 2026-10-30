// routes/copilot.js — /api/v2/copilot/* (contract 02 §7), behind
// FEATURE_V2_COPILOT_V2. POST /chat streams SSE (status/tool/answer/usage/
// error/done); conversations are scoped to user+group; feedback is stored.

import express from "express";
import { requireJwt } from "../middleware/authV2.js";
import { rateLimit, userKey } from "../middleware/rateLimit.js";
import { featureOn, llmConfigFromEnv } from "../llm/config.js";
import { getGateway, getMeter, initLlm } from "../llm/index.js";
import { runCopilot } from "../copilot/pipeline.js";
import { createServerCall } from "../copilot/tools/serverCall.js";
import { ConversationStore } from "../copilot/memory.js";
import { getRag } from "../rag/index.js";

const router = express.Router();
let convStore = null;

router.use((req, res, next) => {
  if (!featureOn("COPILOT_V2")) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "This feature is not enabled" } });
  }
  return next();
});

const store = async () => {
  if (!convStore) {
    const { db } = await initLlm();
    convStore = new ConversationStore(db);
  }
  return convStore;
};

router.post(
  "/chat",
  requireJwt,
  rateLimit({ max: 30, keyFn: userKey, message: "Copilot is busy — retry in a moment" }),
  async (req, res) => {
    const { message, conversationId, context = {} } = req.body || {};
    if (typeof message !== "string" || !message.trim() || message.length > 2000) {
      return res.status(422).json({
        error: { code: "VALIDATION_FAILED", message: "A question of up to 2000 characters is required", details: { fields: ["message"] }, requestId: req.id },
      });
    }
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (event, data) => {
      if (!controller.signal.aborted) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!controller.signal.aborted) res.write(": heartbeat\n\n");
    }, 8000);
    try {
      // First paint immediately — inits (LLM pool, RAG index, store) can take
      // seconds on a cold start; the client should never sit on "Starting…".
      send("status", { stage: "understanding", detail: "Reading your question" });
      const userToken = (req.headers.authorization || "").replace(/^Bearer /, "");
      const call = createServerCall({ userToken });
      const [llm, convs, rag] = await Promise.all([getGateway(), store(), getRag().catch(() => null)]);
      let conversation = null;
      if (conversationId) {
        conversation = await convs.get(conversationId, { userId: req.auth.userId, groupId: req.auth.groupId });
        if (!conversation) send("error", { code: "NOT_FOUND", message: "Conversation not found — starting a new one" });
      }
      const result = await runCopilot({
        message,
        context,
        auth: req.auth,
        llm,
        call,
        rag,
        store: convs,
        conversation,
        send,
        signal: controller.signal,
      });
      send("answer", result);
      try {
        send("usage", (await getMeter()).abbreviated());
      } catch {
        /* meter optional */
      }
      send("done", { messageId: result.conversationId || null });
    } catch (error) {
      send("error", { code: "AI_UNAVAILABLE", message: "The copilot could not complete this question. Please retry." });
      console.warn(`[copilot] ${error.message}`);
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  },
);

router.get("/conversations", requireJwt, async (req, res) => {
  const convs = await store();
  res.json({ items: await convs.list({ userId: req.auth.userId, groupId: req.auth.groupId }) });
});

router.get("/conversations/:id", requireJwt, async (req, res) => {
  const convs = await store();
  const conv = await convs.get(req.params.id, { userId: req.auth.userId, groupId: req.auth.groupId });
  if (!conv) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  return res.json(conv);
});

router.delete("/conversations/:id", requireJwt, async (req, res) => {
  const convs = await store();
  await convs.remove(req.params.id, { userId: req.auth.userId, groupId: req.auth.groupId });
  return res.status(204).end();
});

router.post("/feedback", requireJwt, async (req, res) => {
  const { messageId, rating, reason } = req.body || {};
  if (!messageId || !["up", "down"].includes(rating)) {
    return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "messageId and rating up|down are required" } });
  }
  // Feedback rides the audit log — forwarded to server with the internal token.
  try {
    const call = createServerCall({});
    await call("/api/audit/internal", {
      method: "POST",
      body: {
        actor: req.auth.userId,
        action: "copilot_feedback",
        target: messageId,
        meta: { rating, reason: String(reason || "").slice(0, 500) },
      },
    });
  } catch {
    /* feedback is best-effort */
  }
  return res.status(202).json({ ok: true });
});

export default router;
