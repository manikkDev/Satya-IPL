import express from "express";
import { neighborhood, rebuildGroupGraph } from "../../services/graphProjection.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle } from "./util.js";

const router = express.Router();

// GET /graph/neighborhood?nodeId=&depth= — multi-hop traversal (Neo4j only;
// 503 when the derived store is down — UI falls back to snapshot.graph).
router.get("/neighborhood", handle(async (req, res) => {
  if (!req.query.nodeId) throw fail(422, "VALIDATION_FAILED", "nodeId is required");
  try {
    res.json(await neighborhood(req.scope.groupId, req.query.nodeId, Number(req.query.depth) || 2));
  } catch {
    throw fail(503, "UPSTREAM_UNAVAILABLE", "Graph store unavailable", { service: "neo4j", retryAfterMs: 15000 });
  }
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
