// routes/copilot.js — /api/v2/copilot/* (behind FEATURE_V2_COPILOT_V2).
//
// POST /chat            body {message, conversationId?, context?, options?, requestId?}
//   options {mode: ask|analyse|draft|plan, showWorking, includeScreening,
//            confirmedOnly, scope:{supplierId, from, to, entityId},
//            attachmentDocumentIds:[extraction draft or document ids]}
//   SSE stream:
//   meta    {requestId, options}       the options as applied
//   status  {stage, detail}            understanding|planning|retrieving|checking|writing
//   tool    {id, name, label, args, status:"start"|"done", ok?, ms?, summary?}
//   delta   {text}                     answer tokens (each line grounding-checked)
//   reset   {reason}                   discard streamed text; final answer follows
//   action  {card}                     proposal card (confirm happens client-side)
//   answer  {...payload}               final, verified answer (replaces deltas)
//   usage   {...}                      AI capacity meter
//   error   {code, message}
//   done    {conversationId, messageId}
// GET  /briefing                       daily briefing (tools only, no LLM)
// GET  /conversations, GET|DELETE /conversations/:id
// POST /conversations/:id/actions/:actionId   record confirm/cancel outcome
// POST /chat/stop {requestId}          stop a running answer (it also stops on disconnect)
// POST /feedback

import express from "express";
import { requireJwt } from "../middleware/authV2.js";
import { rateLimit, userKey } from "../middleware/rateLimit.js";
import { featureOn } from "../llm/config.js";
import { getGateway, getMeter, initLlm } from "../llm/index.js";
import { runCopilot } from "../copilot/pipeline.js";
import { buildBriefing } from "../copilot/briefing.js";
import { createServerCall } from "../copilot/tools/serverCall.js";
import { ConversationStore } from "../copilot/memory.js";
import { getRag } from "../rag/index.js";
import { normalizeOptions } from "../copilot/options.js";

const router = express.Router();
let convStore = null;
const briefingCache = new Map(); // `${userId}|${groupId}|${entityId}` -> {at, data}
const BRIEFING_TTL_MS = 3 * 60_000;
const running = new Map(); // requestId -> {controller, userId}

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
const userToken = (req) => (req.headers.authorization || "").replace(/^Bearer /, "");
const owner = (req) => ({ userId: req.auth.userId, groupId: req.auth.groupId });

router.post(
  "/chat",
  requireJwt,
  rateLimit({ max: 30, keyFn: userKey, message: "Copilot is busy — retry in a moment" }),
  async (req, res) => {
    const { message, conversationId, context = {}, options = {}, requestId: rawRequestId } = req.body || {};
    if (typeof message !== "string" || !message.trim() || message.length > 2000) {
      return res.status(422).json({
        error: { code: "VALIDATION_FAILED", message: "A question of up to 2000 characters is required", details: { fields: ["message"] }, requestId: req.id },
      });
    }
    const controller = new AbortController();
    const requestId = typeof rawRequestId === "string" && /^[\w-]{6,64}$/.test(rawRequestId) ? rawRequestId : null;
    if (requestId) running.set(requestId, { controller, userId: req.auth.userId });
    res.on("close", () => {
      controller.abort();
      if (requestId) running.delete(requestId);
    });
    const opts = normalizeOptions(options);
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
      send("meta", { requestId, options: { ...opts, attachmentDocumentIds: opts.attachmentIds } });
      send("status", { stage: "understanding", detail: "Reading your question" });
      const call = createServerCall({ userToken: userToken(req) });
      const [llm, convs, rag] = await Promise.all([getGateway().catch(() => null), store(), getRag().catch(() => null)]);
      let conversation = null;
      if (conversationId) {
        conversation = await convs.get(String(conversationId), owner(req));
        if (!conversation) send("error", { code: "NOT_FOUND", message: "Conversation not found — starting a new one" });
      }
      const safeContext = pickContext(context);
      const result = await runCopilot({
        message, context: safeContext, auth: req.auth, llm, call, rag, store: convs, conversation, send, signal: controller.signal, options: opts,
      });
      if (controller.signal.aborted) return;
      send("answer", result);
      try {
        send("usage", (await getMeter()).abbreviated());
      } catch {
        /* meter optional */
      }
      send("done", { conversationId: result.conversationId || null, messageId: result.messageId });
    } catch (error) {
      send("error", { code: "AI_UNAVAILABLE", message: "The assistant could not complete this question. Please retry." });
      console.warn(`[copilot] ${error.stack || error.message}`);
    } finally {
      clearInterval(heartbeat);
      if (requestId) running.delete(requestId);
      res.end();
    }
  },
);

// "Stop generating": the client aborts its fetch (which closes the stream and
// aborts the run); this endpoint also stops it when a proxy keeps the
// connection open. Only the user who started a run can stop it.
router.post("/chat/stop", requireJwt, (req, res) => {
  const id = String(req.body?.requestId || "");
  const run = running.get(id);
  if (run && run.userId === req.auth.userId) {
    run.controller.abort();
    running.delete(id);
    return res.json({ ok: true, stopped: true });
  }
  return res.json({ ok: true, stopped: false });
});

router.get("/briefing", requireJwt, rateLimit({ max: 20, keyFn: userKey }), async (req, res) => {
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId.slice(0, 64) : null;
  const key = `${req.auth.userId}|${req.auth.groupId}|${entityId || ""}`;
  const hit = briefingCache.get(key);
  if (hit && Date.now() - hit.at < BRIEFING_TTL_MS && req.query.fresh !== "1") return res.json({ ...hit.data, cached: true });
  try {
    const data = await buildBriefing({ call: createServerCall({ userToken: userToken(req) }), scope: { groupId: req.auth.groupId, entityId, userId: req.auth.userId } });
    briefingCache.set(key, { at: Date.now(), data });
    if (briefingCache.size > 500) briefingCache.delete(briefingCache.keys().next().value);
    return res.json(data);
  } catch (error) {
    console.warn(`[copilot] briefing failed: ${error.message}`);
    return res.status(503).json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Briefing unavailable — retry shortly", requestId: req.id } });
  }
});

router.get("/conversations", requireJwt, async (req, res) => {
  const convs = await store();
  res.json({ items: await convs.list(owner(req)) });
});

router.get("/conversations/:id", requireJwt, async (req, res) => {
  const convs = await store();
  const conv = await convs.get(req.params.id, owner(req));
  if (!conv) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  const { _id, ...rest } = conv;
  return res.json(rest);
});

router.delete("/conversations/:id", requireJwt, async (req, res) => {
  const convs = await store();
  await convs.remove(req.params.id, owner(req));
  return res.status(204).end();
});

router.post("/conversations/:id/actions/:actionId", requireJwt, async (req, res) => {
  const { status, detail, reference } = req.body || {};
  if (!["confirmed", "cancelled", "failed"].includes(status)) {
    return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "status must be confirmed, cancelled or failed" } });
  }
  const convs = await store();
  const saved = await convs.setActionResult(req.params.id, owner(req), req.params.actionId, {
    status, detail: String(detail || "").slice(0, 300), reference: String(reference || "").slice(0, 120), at: new Date().toISOString(), by: req.auth.userId,
  });
  if (!saved) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Action not found in this conversation" } });
  return res.json(saved);
});

router.post("/feedback", requireJwt, async (req, res) => {
  const { messageId, rating, reason } = req.body || {};
  if (!messageId || !["up", "down"].includes(rating)) {
    return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "messageId and rating up|down are required" } });
  }
  // Feedback rides the server's hash-chained audit log via the internal
  // endpoint (POST /api/internal/audit, x-internal-token). Best-effort.
  let recorded = false;
  if (req.auth.groupId) {
    try {
      const call = createServerCall({});
      const r = await call("/api/internal/audit", {
        method: "POST",
        body: { groupId: req.auth.groupId, actor: req.auth.userId, action: "copilot_feedback", target: String(messageId).slice(0, 120), meta: { rating, reason: String(reason || "").slice(0, 500) } },
      });
      recorded = Boolean(r.ok);
    } catch {
      /* feedback is best-effort */
    }
  }
  return res.status(202).json({ ok: true, recorded });
});

/** Only known context keys, short strings (deep links send ?case= / ?about=). */
function pickContext(context) {
  const out = {};
  for (const key of ["page", "caseId", "documentId", "supplierId", "entityId", "paymentId"]) {
    if (typeof context?.[key] === "string" && context[key].length <= 120) out[key] = context[key];
  }
  return out;
}

export default router;
