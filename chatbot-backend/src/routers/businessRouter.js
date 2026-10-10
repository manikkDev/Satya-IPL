import express from "express";
import { summarizeCase, retrieveCases } from "../helpers/businessAnswer.js";

const router = express.Router();
const base = () => process.env.GRAPH_API_URL || "http://localhost:5002";
const asUser = async (req, path, options = {}) => {
  const response = await fetch(`${base()}${path}`, { ...options, headers: { "content-type": "application/json", authorization: req.headers.authorization || "", ...(options.method === 'POST' && path.startsWith('/api/conversations/') ? { 'x-internal-token': process.env.NODE_INTERNAL_TOKEN || '' } : {}) }, signal: AbortSignal.timeout(12000) });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(response.status < 500 ? body.message || "Business tool request rejected" : "Business evidence service unavailable"), { status: response.status });
  return body;
};
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.use((req, _res, next) => asUser(req, "/api/auth/profile").then((user) => { req.businessUser = user; next(); }).catch(next));

const answer = async (req) => {
  const prompt = req.body.prompt;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) throw Object.assign(new Error("A question of up to 4000 characters is required"), { status: 422 });
  const cases = await asUser(req, "/api/v1/cases");
  let caseId = req.body.caseId;
  if (caseId && (typeof caseId !== "string" || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(caseId))) throw Object.assign(new Error("Invalid case reference"), { status: 422 });
  if (!caseId) {
    const retrieved = retrieveCases(prompt, cases);
    if (retrieved.length && (retrieved.length === 1 || retrieved[0].score > retrieved[1].score)) caseId = retrieved[0].item.id;
  }
  let result;
  if (caseId) {
    const businessCase = await asUser(req, `/api/v1/cases/${encodeURIComponent(caseId)}`);
    result = summarizeCase(businessCase);
    try { result.graph = await asUser(req, `/api/v1/graph/cases/${encodeURIComponent(caseId)}`); }
    catch { result.graphUnavailable = true; }
  } else {
    result = { content: cases.length ? `I can investigate ${cases.length} authorized cases. Please choose a case or give a PO reference so I do not guess which transaction you mean.\n\n${cases.map((item) => `${item.poId}: ${item.title} — ${item.supplier}`).join("\n")}` : "There are no imported cases in your company workspace yet.", sources: [], caseOptions: cases.map((item) => ({ id: item.id, title: item.title, poId: item.poId })), grounded: true, mode: "deterministic_evidence_rag" };
  }
  let conversationId = req.body.conversationId;
  if (conversationId && (typeof conversationId !== "string" || !/^[a-f0-9]{24}$/i.test(conversationId))) throw Object.assign(new Error("Invalid conversation reference"), { status: 422 });
  if (!conversationId) conversationId = (await asUser(req, "/api/conversations", { method: "POST", body: JSON.stringify({ title: prompt.slice(0, 100) }) })).id;
  await asUser(req, `/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: prompt }, { role: "assistant", content: result.content, sources: result.sources }] }) });
  return { ...result, conversationId };
};
router.post("/", handle(async (req, res) => res.json(await answer(req))));
router.post("/stream", handle(async (req, res) => {
  const result = await answer(req);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`event: answer\ndata: ${JSON.stringify(result)}\n\n`);
  res.end();
}));
router.get("/conversations", handle(async (req, res) => res.json(await asUser(req, "/api/conversations"))));
router.get("/conversations/:id", handle(async (req, res) => res.json(await asUser(req, `/api/conversations/${encodeURIComponent(req.params.id)}`))));
export default router;
