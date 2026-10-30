import neo4j from "neo4j-driver";

// v2 Neo4j projection (04 P2-B7): derived, rebuildable graph of engine
// snapshots. Every node key is group-scoped so a query can never leak across
// tenants. Neo4j is optional — callers must degrade to the snapshot's own
// graph payload when the driver is unavailable.
let driver;
const graph = () => {
  if (!driver) driver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || ""),
    { connectionTimeout: 5000, maxTransactionRetryTime: 5000 }
  );
  return driver;
};

const key = (groupId, nodeId) => `${groupId}:${nodeId}`;

export const projectGraph = async (groupId, snapshotId, graphPayload) => {
  const session = graph().session();
  try {
    const nodes = (graphPayload.nodes || []).map((n) => ({ ...n, key: key(groupId, n.id), snapshotId, groupId }));
    const edges = (graphPayload.edges || []).map((e) => ({ ...e, key: `${groupId}:${snapshotId}:${e.id || `${e.source}-${e.target}-${e.type}`}`, snapshotId, groupId }));
    await session.executeWrite(async (tx) => {
      if (nodes.length) await tx.run(
        "UNWIND $rows AS r MERGE (n:V2Node {key:r.key}) SET n += {id:r.id, groupId:r.groupId, snapshotId:r.snapshotId, type:r.type, label:r.label, stage:r.stage, date:r.date, status:r.status}",
        { rows: nodes }
      );
      if (edges.length) await tx.run(
        "UNWIND $rows AS r MATCH (a:V2Node {key:$gk + r.source}), (b:V2Node {key:$gk + r.target}) MERGE (a)-[l:V2LINK {key:r.key}]->(b) SET l += {groupId:r.groupId, snapshotId:r.snapshotId, type:r.type, kind:r.kind, certainty:r.certainty, basis:r.basis}",
        { rows: edges, gk: `${groupId}:` }
      );
    });
  } finally {
    await session.close();
  }
};

// latest graph for a case: reads the newest projected snapshot's nodes/edges
export const caseGraph = async (groupId, snapshotId) => {
  const session = graph().session();
  try {
    const nodes = await session.run(
      `MATCH (n:V2Node {groupId:$g, snapshotId:$s}) RETURN n
       UNION MATCH (a:V2Node {groupId:$g})-[:V2LINK {groupId:$g, snapshotId:$s}]-(n:V2Node {groupId:$g}) RETURN DISTINCT n`,
      { g: groupId, s: snapshotId }
    );
    const rels = await session.run(
      "MATCH (a:V2Node {groupId:$g})-[l:V2LINK {groupId:$g, snapshotId:$s}]->(b:V2Node {groupId:$g}) RETURN l, a.id AS source, b.id AS target",
      { g: groupId, s: snapshotId }
    );
    return {
      nodes: nodes.records.map((r) => r.get("n").properties),
      edges: rels.records.map((r) => ({ ...r.get("l").properties, source: r.get("source"), target: r.get("target") })),
      source: "neo4j", snapshotId,
    };
  } finally {
    await session.close();
  }
};

export const neighborhood = async (groupId, nodeId, depth = 2) => {
  const session = graph().session();
  try {
    const result = await session.run(
      `MATCH (start:V2Node {key:$k})
       OPTIONAL MATCH (start)-[:V2LINK*1..${Math.min(depth, 4)}]-(n:V2Node)
       WITH collect(DISTINCT start) + collect(DISTINCT n) AS ns
       UNWIND ns AS x WITH collect(DISTINCT x) AS nodes
       OPTIONAL MATCH (a:V2Node {groupId:$g})-[r:V2LINK {groupId:$g}]->(b:V2Node {groupId:$g})
       WHERE a IN nodes AND b IN nodes
       RETURN nodes, collect({rel: r, source: a.id, target: b.id}) AS edges`,
      { k: key(groupId, nodeId), g: groupId }
    );
    const rec = result.records[0];
    return {
      nodes: (rec?.get("nodes") || []).map((n) => n.properties),
      edges: (rec?.get("edges") || []).filter((e) => e.rel).map((e) => ({ ...e.rel.properties, source: e.source, target: e.target })),
      source: "neo4j",
    };
  } finally {
    await session.close();
  }
};

export const rebuildGroupGraph = async (groupId) => {
  const session = graph().session();
  try {
    await session.run("MATCH (n:V2Node {groupId:$g}) DETACH DELETE n", { g: groupId });
  } finally {
    await session.close();
  }
  const { default: Snapshot } = await import("../models/Snapshot.js");
  const snaps = await Snapshot.find({ groupId }).lean();
  let projected = 0;
  for (const snap of snaps) {
    if (snap.result?.graph) {
      await projectGraph(groupId, snap.id, snap.result.graph);
      projected += 1;
    }
  }
  return { projected };
};
