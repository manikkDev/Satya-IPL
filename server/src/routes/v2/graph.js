import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import { neighborhood, rebuildGroupGraph } from "../../services/graphProjection.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle } from "./util.js";

const router = express.Router();

// Mongo fallback over DocumentLinks (the source the Neo4j projection is
// derived from) so graph questions work without Neo4j. Every hop is
// group-scoped and nodes outside the caller's entities are dropped.
const NODE_FIELDS = { id: 1, type: 1, number: 1, externalRef: 1, date: 1, status: 1, entityId: 1, "seller.name": 1 };
const nodeOf = (d) => ({ id: d.id, type: d.type, label: d.number ?? d.externalRef ?? d.id, date: d.date, status: d.status, counterparty: d.seller?.name ?? null });
const edgeOf = (l) => ({ id: l.id, source: l.fromId, target: l.toId, type: l.kind, kind: l.kind, certainty: l.certainty, basis: l.basis, amount: l.amount ?? null });

const linksTouching = (groupId, ids) =>
  DocumentLink.find({ groupId, $or: [{ fromId: { $in: ids } }, { toId: { $in: ids } }] }, { id: 1, fromId: 1, toId: 1, kind: 1, certainty: 1, basis: 1, amount: 1 }).limit(2000).lean();

const scopedDocs = async (req, ids) => {
  const docs = await Document.find({ groupId: req.scope.groupId, id: { $in: [...ids] }, entityId: { $in: req.scope.entityIds } }, NODE_FIELDS).lean();
  return new Map(docs.map((d) => [d.id, d]));
};

const mongoNeighborhood = async (req, nodeId, depth) => {
  const seen = new Set([nodeId]);
  const edges = new Map();
  let frontier = [nodeId];
  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const links = await linksTouching(req.scope.groupId, frontier);
    const next = [];
    for (const l of links) {
      edges.set(`${l.fromId}|${l.toId}|${l.kind}`, l);
      for (const id of [l.fromId, l.toId]) if (!seen.has(id)) { seen.add(id); next.push(id); }
    }
    frontier = next.slice(0, 200);
  }
  const docs = await scopedDocs(req, seen);
  if (!docs.has(nodeId)) throw fail(404, "NOT_FOUND", "Document not found");
  return {
    nodes: [...docs.values()].map(nodeOf),
    edges: [...edges.values()].filter((l) => docs.has(l.fromId) && docs.has(l.toId)).map(edgeOf),
    source: "links",
  };
};

// GET /graph/neighborhood?nodeId=&depth= — Neo4j when configured, else (or
// on failure) the DocumentLink fallback.
router.get("/neighborhood", handle(async (req, res) => {
  const nodeId = req.query.nodeId || req.query.documentId;
  if (!nodeId) throw fail(422, "VALIDATION_FAILED", "nodeId is required");
  const depth = Math.min(Math.max(1, Number(req.query.depth) || 2), 3);
  try {
    const g = await neighborhood(req.scope.groupId, String(nodeId), depth);
    if (g.nodes?.length) return res.json(g);
  } catch { /* fall back to links */ }
  res.json(await mongoNeighborhood(req, String(nodeId), depth));
}));

// GET /graph/document/:id/neighborhood — same, path-style (copilot tool).
router.get("/document/:id/neighborhood", handle(async (req, res) => {
  const depth = Math.min(Math.max(1, Number(req.query.depth) || 1), 3);
  res.json(await mongoNeighborhood(req, req.params.id, depth));
}));

// GET /graph/path?from=&to= — shortest evidence path between two documents
// (undirected BFS over DocumentLinks, max 6 hops).
router.get("/path", handle(async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!from || !to) throw fail(422, "VALIDATION_FAILED", "from and to are required");
  const ends = await scopedDocs(req, [from, to]);
  if (!ends.has(from) || !ends.has(to)) throw fail(404, "NOT_FOUND", "Document not found");
  const parent = new Map([[from, null]]);
  let frontier = [from];
  let found = from === to;
  for (let hop = 0; hop < 6 && frontier.length && !found; hop++) {
    const links = await linksTouching(req.scope.groupId, frontier);
    const next = [];
    for (const l of links) {
      for (const [a, b] of [[l.fromId, l.toId], [l.toId, l.fromId]]) {
        if (frontier.includes(a) && !parent.has(b)) {
          parent.set(b, { via: l, prev: a });
          next.push(b);
          if (b === to) found = true;
        }
      }
    }
    frontier = next.slice(0, 500);
  }
  if (!found) return res.json({ from, to, found: false, nodes: [], edges: [], hops: null, source: "links" });
  const pathIds = [];
  const pathEdges = [];
  for (let cur = to; cur !== null && cur !== undefined;) {
    pathIds.unshift(cur);
    const p = parent.get(cur);
    if (!p) break;
    pathEdges.unshift(p.via);
    cur = p.prev;
  }
  const docs = await scopedDocs(req, pathIds);
  if (pathIds.some((id) => !docs.has(id))) return res.json({ from, to, found: false, nodes: [], edges: [], hops: null, source: "links" });
  res.json({ from, to, found: true, hops: pathEdges.length, nodes: pathIds.map((id) => nodeOf(docs.get(id))), edges: pathEdges.map(edgeOf), source: "links" });
}));

// POST /admin/graph/rebuild — wipe + re-project every snapshot (group_admin).
export const adminRouter = express.Router();
adminRouter.post("/graph/rebuild", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "group.manage")) throw fail(403, "FORBIDDEN", "Only group admins can rebuild the graph");
  try {
    res.json(await rebuildGroupGraph(req.scope.groupId));
  } catch {
    throw fail(503, "UPSTREAM_UNAVAILABLE", "Graph store unavailable", { service: "neo4j" });
  }
}));

export default router;
