import express from "express";
import neo4j from "neo4j-driver";

import { protect } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();
const analystOnly = [protect, requireRole("analyst", "admin")];

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
);

// ── Helper: safely convert Neo4j Integer / number / null ─────────────────
function toNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  // Neo4j driver Integer object
  if (val && typeof val.toNumber === "function") return val.toNumber();
  return Number(val);
}

// ── Fetch nodes (optionally filtered by search term) ─────────────────────
async function fetchNodes(searchTerm = null) {
  const session = driver.session();
  try {
    let query,
      params = {};

    if (searchTerm) {
      query = `
        MATCH (n)
        WHERE toLower(n.name) CONTAINS toLower($searchTerm)
        RETURN elementId(n) AS id,
               labels(n)[0]  AS group,
               n.name        AS label,
               n.size        AS size
        LIMIT 10000000
      `;
      params = { searchTerm };
    } else {
      query = `
        MATCH (n)
        RETURN elementId(n) AS id,
               labels(n)[0]  AS group,
               n.name        AS label,
               n.size        AS size
        LIMIT 1000000
      `;
    }

    const result = await session.run(query, params);
    return result.records.map((r) => ({
      id: r.get("id"),
      label: r.get("label") || r.get("id"),
      // FIX 1: lowercase group so it matches the GC colour map in the frontend
      group: (r.get("group") || "default").toLowerCase(),
      // FIX 2: Neo4j Integer → JS number
      size: toNumber(r.get("size")) || 18,
    }));
  } finally {
    await session.close();
  }
}

// ── Fetch relationships between a specific set of node IDs ───────────────
// FIX 3: always require nodeIds; use AND so both endpoints are in the set
async function fetchRelationships(nodeIds) {
  if (!nodeIds || nodeIds.length === 0) return [];

  const session = driver.session();
  try {
    // AND ensures both source AND target exist in the returned node list,
    // so D3's validLinks filter never discards them.
    const query = `
      MATCH (a)-[r]->(b)
      WHERE elementId(a) IN $nodeIds
        AND elementId(b) IN $nodeIds
      RETURN elementId(a)  AS source,
             elementId(b)  AS target,
             type(r)        AS label,
             r.strength     AS strength
      LIMIT 50000000
    `;
    const result = await session.run(query, { nodeIds });
    return result.records.map((r) => ({
      source: r.get("source"),
      target: r.get("target"),
      label: r.get("label"),
      // FIX 4: Neo4j Integer → JS number
      strength: toNumber(r.get("strength")) ?? 0.5,
    }));
  } finally {
    await session.close();
  }
}

// ── GET /api/graph — full graph (analyst/admin only; pseudonymous ids) ────
router.get("/graph", ...analystOnly, async (req, res) => {
  try {
    const nodes = await fetchNodes();
    const nodeIds = nodes.map((n) => n.id);
    const links = await fetchRelationships(nodeIds);
    res.json({ nodes, links });
  } catch (err) {
    console.error("Graph fetch error:", err);
    res.status(500).json({ error: "Failed to load graph data" });
  }
});

// ── POST /api/graph/search — search + 1-hop neighbours ───────────────────
router.post("/graph/search", ...analystOnly, async (req, res) => {
  try {
    const { term } = req.body;

    // Empty search → return full graph
    if (!term || !term.trim()) {
      const nodes = await fetchNodes();
      const nodeIds = nodes.map((n) => n.id);
      const links = await fetchRelationships(nodeIds);
      return res.json({ nodes, links });
    }

    // 1. Find nodes whose name matches the search term
    const matchedNodes = await fetchNodes(term);
    if (matchedNodes.length === 0) {
      return res.json({ nodes: [], links: [] });
    }

    const matchedIds = matchedNodes.map((n) => n.id);
    const matchedSet = new Set(matchedIds);

    // 2. Walk 1 hop from matched nodes; collect neighbours + edges
    const session = driver.session();
    const neighbourMap = new Map(); // id → node object
    const linkMap = new Map(); // "src-tgt-type" → link object

    try {
      // FIX 6: use elementId(startNode(r)) / elementId(endNode(r)) in Cypher
      //        instead of fetching the startNode object and calling .elementId in JS
      const result = await session.run(
        `
        MATCH (n)-[r]-(m)
        WHERE elementId(n) IN $ids
        RETURN elementId(startNode(r)) AS source,
               elementId(endNode(r))   AS target,
               type(r)                  AS relType,
               r.strength               AS strength,
               elementId(m)             AS neighbourId,
               labels(m)[0]             AS neighbourGroup,
               m.name                   AS neighbourLabel,
               m.size                   AS neighbourSize
        LIMIT 300
        `,
        { ids: matchedIds },
      );

      result.records.forEach((r) => {

        const neighbourId = r.get("neighbourId");

        // Collect neighbour node (if not already a matched node)
        if (!matchedSet.has(neighbourId) && !neighbourMap.has(neighbourId)) {
          neighbourMap.set(neighbourId, {
            id: neighbourId,
            label: r.get("neighbourLabel") || neighbourId,
            group: (r.get("neighbourGroup") || "default").toLowerCase(),
            size: toNumber(r.get("neighbourSize")) || 18,
          });
        }

        // Deduplicate edges by src-tgt-type key
        const src = r.get("source");
        const tgt = r.get("target");
        const type = r.get("relType");
        const key = `${src}||${tgt}||${type}`;

        if (!linkMap.has(key)) {
          linkMap.set(key, {
            source: src,
            target: tgt,
            label: type,
            strength: toNumber(r.get("strength")) ?? 0.5,
          });
        }
      });
    } finally {
      await session.close();
    }

    const allNodes = [...matchedNodes, ...neighbourMap.values()];
    const allLinks = [...linkMap.values()];
    res.json({ nodes: allNodes, links: allLinks });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// ── GET /api/graph/stream — SSE streaming (analyst/admin) ────────────────
router.get("/graph/stream", ...analystOnly, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");

  const sendData = async () => {
    try {
      res.write(`event: status\ndata: "🔍 Querying Neo4j..."\n\n`);

      const nodes = await fetchNodes();
      res.write(`event: status\ndata: "📦 Found ${nodes.length} nodes"\n\n`);
      await new Promise((r) => setTimeout(r, 300));

      res.write(`event: status\ndata: "🔗 Fetching relationships..."\n\n`);
      const nodeIds = nodes.map((n) => n.id);
      const links = await fetchRelationships(nodeIds);
      res.write(
        `event: status\ndata: "✅ Built ${links.length} relationships"\n\n`,
      );
      await new Promise((r) => setTimeout(r, 300));

      res.write(
        `data: ${JSON.stringify({ timestamp: Date.now(), nodes, links })}\n\n`,
      );
    } catch (err) {
      res.write(`event: error\ndata: "${err.message}"\n\n`);
    }
  };

  sendData();
});

// Latest ingested snapshot's provenance (run id, counts, source split).
router.get("/risk-graph/meta", ...analystOnly, async (_req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:GraphSnapshot) RETURN s.id AS id, s.run_id AS run_id, s.created_at AS created_at,
              s.account_count AS accounts, s.edge_count AS edges, s.campaign_count AS campaigns,
              s.source_split AS source_split
       ORDER BY s.created_at DESC LIMIT 1`,
    );
    if (!result.records.length) return res.status(404).json({ error: "No graph snapshot ingested yet" });
    const r = result.records[0];
    res.json({ snapshot_id: r.get("id"), run_id: r.get("run_id"), created_at: r.get("created_at")?.toString?.() ?? null,
               accounts: toNumber(r.get("accounts")), edges: toNumber(r.get("edges")),
               campaigns: toNumber(r.get("campaigns")), source_split: r.get("source_split") });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

router.get("/risk-graph/overview", ...analystOnly, async (req, res) => {
  const session = driver.session();
  try {
    const minScore = Number(req.query.minScore ?? 0.3);
    const limit = Math.min(Math.max(Number(req.query.limit) || 400, 1), 400);
    const isAdmin = req.user.role === "admin";
    const institutionId = req.user.institutionId ?? -2;
    const result = await session.run(
      `MATCH (source:Account)-[edge:TRANSFERRED_TO]->(target:Account)
       WHERE (source.risk_score >= $minScore OR target.risk_score >= $minScore)
         AND ($isAdmin OR source.institution_id = $institutionId OR target.institution_id = $institutionId
              OR source.institution_id = -1 OR target.institution_id = -1)
       RETURN source.pid AS source_id, source.risk_score AS source_score, source.risk_band AS source_band,
              source.cluster_id AS source_cluster, source.institution_id AS source_institution, source.pagerank AS source_pagerank,
              target.pid AS target_id, target.risk_score AS target_score, target.risk_band AS target_band,
              target.cluster_id AS target_cluster, target.institution_id AS target_institution, target.pagerank AS target_pagerank,
              edge.n_tx AS n_tx, edge.total_amt AS total_amt, edge.avg_risk AS avg_risk
       ORDER BY edge.avg_risk DESC LIMIT $limit`,
      { minScore, limit: neo4j.int(limit), isAdmin, institutionId },
    );
    const nodes = new Map();
    const edges = result.records.map((record) => {
      const source = record.get("source_id");
      const target = record.get("target_id");
      nodes.set(source, { id: source, score: record.get("source_score"), band: record.get("source_band"), cluster: toNumber(record.get("source_cluster")), institution: toNumber(record.get("source_institution")), pagerank: record.get("source_pagerank") });
      nodes.set(target, { id: target, score: record.get("target_score"), band: record.get("target_band"), cluster: toNumber(record.get("target_cluster")), institution: toNumber(record.get("target_institution")), pagerank: record.get("target_pagerank") });
      return { source, target, n_tx: toNumber(record.get("n_tx")), total_amt: record.get("total_amt"), avg_risk: record.get("avg_risk") };
    });
    res.json({ nodes: [...nodes.values()], edges });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

router.get("/risk-graph/campaigns", ...analystOnly, async (req, res) => {
  const session = driver.session();
  try {
    const isAdmin = req.user.role === "admin";
    const institutionId = req.user.institutionId ?? -2;
    // Non-admin analysts only see rings that touch their own institution
    // (or pseudonymous external counterparties).
    const result = await session.run(
      `MATCH (campaign:Campaign)
       WHERE $isAdmin OR EXISTS {
         MATCH (member:Account)-[:MEMBER_OF]->(campaign)
         WHERE member.institution_id = $institutionId OR member.institution_id = -1
       }
       RETURN campaign.id AS id, campaign.label AS label, campaign.size AS size, campaign.avg_score AS avg_score, campaign.n_high AS n_high ORDER BY campaign.n_high DESC, campaign.avg_score DESC LIMIT 25`,
      { isAdmin, institutionId },
    );
    res.json(result.records.map((record) => ({ id: toNumber(record.get("id")), label: record.get("label"), size: toNumber(record.get("size")), avg_score: record.get("avg_score"), n_high: toNumber(record.get("n_high")) })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

router.get("/risk-graph/campaign/:id", ...analystOnly, async (req, res) => {
  const session = driver.session();
  try {
    const isAdmin = req.user.role === "admin";
    const institutionId = req.user.institutionId ?? -2;
    const result = await session.run(
      `MATCH (account:Account)-[:MEMBER_OF]->(campaign:Campaign {id:$id})
       WHERE $isAdmin OR account.institution_id IN [$institutionId, -1]
       OPTIONAL MATCH (account)-[edge:TRANSFERRED_TO]->(target:Account)-[:MEMBER_OF]->(campaign)
       WHERE $isAdmin OR target.institution_id IN [$institutionId, -1]
       RETURN account.pid AS id, account.risk_score AS score, account.risk_band AS band,
              account.institution_id AS institution, target.pid AS target, edge.n_tx AS n_tx, edge.total_amt AS total_amt`,
      { id: neo4j.int(Number(req.params.id)), isAdmin, institutionId },
    );
    const nodes = new Map();
    const edges = [];
    for (const record of result.records) {
      const id = record.get("id");
      nodes.set(id, { id, score: record.get("score"), band: record.get("band"), institution: toNumber(record.get("institution")) });
      if (record.get("target")) edges.push({ source: id, target: record.get("target"), n_tx: toNumber(record.get("n_tx")), total_amt: record.get("total_amt") });
    }
    res.json({ nodes: [...nodes.values()], edges });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

router.get("/risk-graph/account/:pid/neighbors", ...analystOnly, async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run("MATCH (account:Account {pid:$pid})-[edge:TRANSFERRED_TO]-(neighbor:Account) WHERE $isAdmin OR account.institution_id = $institutionId RETURN neighbor.pid AS id, neighbor.risk_score AS score, neighbor.risk_band AS band, edge.n_tx AS n_tx, edge.total_amt AS total_amt LIMIT 50", {
      pid: req.params.pid,
      isAdmin: req.user.role === "admin",
      institutionId: req.user.institutionId,
    });
    res.json({ center: req.params.pid, neighbors: result.records.map((record) => ({ id: record.get("id"), score: record.get("score"), band: record.get("band"), n_tx: toNumber(record.get("n_tx")), total_amt: record.get("total_amt") })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

export default router;
