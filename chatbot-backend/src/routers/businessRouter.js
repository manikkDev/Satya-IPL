import express from 'express';
import { retrieveCases } from '../helpers/businessAnswer.js';
import { answerQuestion, compact, resolveRecords } from '../helpers/businessQuestions.js';
import { narrateQuestion } from '../helpers/businessNarrator.js';

const router = express.Router();
const base = () => process.env.GRAPH_API_URL || 'http://localhost:5002';
const asUser = async (req, path, options = {}) => {
  const response = await fetch(`${base()}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '', ...(options.method === 'POST' && path.startsWith('/api/conversations/') ? { 'x-internal-token': process.env.NODE_INTERNAL_TOKEN || '' } : {}) }, signal: AbortSignal.timeout(12000) });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(response.status < 500 ? body.message || 'Business tool request rejected' : 'Business evidence service unavailable'), { status: response.status });
  return body;
};
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.use((req, _res, next) => asUser(req, '/api/auth/profile').then((user) => { req.businessUser = user; next(); }).catch(next));

const answer = async (req, progress = () => {}, signal) => {
  const prompt = req.body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw Object.assign(new Error('A question of up to 4000 characters is required'), { status: 422 });
  let conversationId = req.body.conversationId;
  if (conversationId && (typeof conversationId !== 'string' || !/^[a-f0-9]{24}$/i.test(conversationId))) throw Object.assign(new Error('Invalid conversation reference'), { status: 422 });
  const history = conversationId ? (await asUser(req, `/api/conversations/${conversationId}`)).messages.slice(-8) : [];
  progress('Reading current authorized company records');
  const cases = await asUser(req, '/api/v1/cases');
  let caseId = req.body.caseId;
  if (caseId && (typeof caseId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(caseId))) throw Object.assign(new Error('Invalid case reference'), { status: 422 });
  const named = cases.filter((item) => compact(prompt).includes(compact(item.poId)));
  if (named.length === 1) caseId = named[0].id;
  let unmatchedOrder = false;
  if (/\b(grn|invoice|inv|bank|utr|po)[\s/-]*\d/i.test(prompt)) {
    const records = await asUser(req, '/api/v1/records');
    const matches = resolveRecords(prompt, records);
    const contextual = matches.filter((record) => record.caseId === caseId);
    const candidateCases = [...new Set((contextual.length ? contextual : matches).map((record) => record.caseId))];
    if (!named.length && candidateCases.length === 1) caseId = candidateCases[0];
    unmatchedOrder = /\bpo[\s/-]*\d/i.test(prompt) && !named.length && !matches.length;
  }
  if (!caseId && !unmatchedOrder) {
    const previousCase = [...history].reverse().find((message) => ['model', 'assistant'].includes(message.role))?.sources?.[0]?.caseId;
    if (cases.some((item) => item.id === previousCase)) caseId = previousCase;
    else {
      const retrieved = retrieveCases(prompt, cases);
      if (retrieved.length && (retrieved.length === 1 || retrieved[0].score > retrieved[1].score)) caseId = retrieved[0].item.id;
    }
  }
  let result;
  if (caseId && !unmatchedOrder) {
    progress('Resolving the question against the latest investigation');
    let businessCase = await asUser(req, `/api/v1/cases/${encodeURIComponent(caseId)}`);
    for (let attempt = 0; businessCase.pendingReconciliation && attempt < 6; attempt++) {
      progress('Waiting for the latest reviewer decision to finish reconciliation');
      await new Promise((resolve) => setTimeout(resolve, 250));
      businessCase = await asUser(req, `/api/v1/cases/${encodeURIComponent(caseId)}`);
    }
    if (businessCase.pendingReconciliation) {
      result = { answerType: 'pending', content: 'The latest reviewer decision is still being reconciled. I will not present the previous balance as the updated balance. Please ask again when the record check finishes.', sources: [], caseId, queriedAt: new Date().toISOString(), responseMode: 'evidence_tools' };
    } else {
      result = answerQuestion(businessCase, prompt, history);
      progress('Checking the live evidence relationships');
      try {
        const graph = await asUser(req, `/api/v1/graph/cases/${encodeURIComponent(caseId)}`);
        if (graph.snapshotId === result.snapshotId) result.graph = graph;
        else result.graphUnavailable = true;
      } catch { result.graphUnavailable = true; }
      progress('Preparing a question-specific grounded reply');
      result = await narrateQuestion(businessCase, prompt, result, history, signal);
    }
  } else {
    result = { answerType: 'clarification', content: unmatchedOrder ? 'I could not find that purchase order in your authorized company records. Give its exact source reference or choose an investigation; I will not substitute another order.' : cases.length ? `Please choose an investigation or give a specific PO, invoice or receipt reference. I have ${cases.length} authorized investigations; I will not guess which one you mean.` : 'There are no imported investigations in this company workspace yet.', sources: [], caseOptions: cases.map((item) => ({ id: item.id, title: item.title, poId: item.poId })), responseMode: 'evidence_tools', mode: 'live_evidence_tools', queriedAt: new Date().toISOString() };
  }
  if (signal?.aborted) return null;
  progress('Saving the answer and its evidence citations');
  if (!conversationId) conversationId = (await asUser(req, '/api/conversations', { method: 'POST', body: JSON.stringify({ title: prompt.slice(0, 100) }) })).id;
  await asUser(req, `/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: prompt }, { role: 'assistant', content: result.content, sources: result.sources }] }) });
  return { ...result, conversationId };
};
router.post('/', handle(async (req, res) => res.json(await answer(req))));
router.post('/stream', async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (event, data) => { if (!controller.signal.aborted) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const heartbeat = setInterval(() => { if (!controller.signal.aborted) res.write(': heartbeat\n\n'); }, 8000);
  try {
    const result = await answer(req, (stage) => send('status', { stage }), controller.signal);
    if (result) send('answer', result);
  } catch (error) { send('error', { message: error.status && error.status < 500 ? error.message : 'The evidence service could not complete this question. Please retry.' }); }
  finally { clearInterval(heartbeat); res.end(); }
});
router.get('/conversations', handle(async (req, res) => res.json(await asUser(req, '/api/conversations'))));
router.get('/conversations/:id', handle(async (req, res) => res.json(await asUser(req, `/api/conversations/${encodeURIComponent(req.params.id)}`))));
export default router;
