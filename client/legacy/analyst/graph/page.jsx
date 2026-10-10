"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import RiskShell, { ErrorPanel, LoadingPanel, MetricCard } from "@/components/risk/RiskShell";
import { api } from "@/lib/api";

const BAND_COLORS = { high: "#fb7185", medium: "#fbbf24", low: "#34d399" };
const pct = (value) => `${(value * 100).toFixed(0)}%`;

/** Deterministic campaign-anchored layout: each community gets a ring, nodes sit on it. */
function layoutNodes(nodes) {
  const byCluster = new Map();
  nodes.forEach((node, index) => {
    const key = node.cluster ?? `solo-${index}`;
    if (!byCluster.has(key)) byCluster.set(key, []);
    byCluster.get(key).push(node);
  });
  const clusters = [...byCluster.values()].sort((a, b) => b.length - a.length).slice(0, 18);
  const positions = new Map();
  clusters.forEach((members, clusterIndex) => {
    const cols = Math.ceil(Math.sqrt(clusters.length));
    const cx = 110 + (clusterIndex % cols) * (780 / cols);
    const cy = 100 + Math.floor(clusterIndex / cols) * (460 / Math.ceil(clusters.length / cols));
    const radius = Math.min(70, 16 + members.length * 4);
    members.slice(0, 40).forEach((node, i) => {
      const angle = (i / members.slice(0, 40).length) * Math.PI * 2;
      positions.set(node.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  });
  return positions;
}

function GraphView() {
  const [graph, setGraph] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [meta, setMeta] = useState(null);
  const [selected, setSelected] = useState(null); // campaign detail
  const [neighbors, setNeighbors] = useState(null); // {center, neighbors[]}
  const [focusNode, setFocusNode] = useState(null);
  const [error, setError] = useState("");

  const load = () =>
    Promise.all([
      api.graph.overview(0.3, 400),
      api.graph.campaigns(),
      api.graph.meta().catch(() => null),
    ])
      .then(([network, rings, snapshot]) => {
        setGraph(network);
        setCampaigns(rings);
        setMeta(snapshot);
      })
      .catch((reason) => setError(reason.message));
  useEffect(() => {
    load();
  }, []);

  const positions = useMemo(() => (graph ? layoutNodes(graph.nodes) : new Map()), [graph]);
  const visible = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    if (!selected) return { nodes: graph.nodes.slice(0, 200), edges: graph.edges.slice(0, 300) };
    const ids = new Set(selected.nodes.map((n) => n.id));
    return { nodes: selected.nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [graph, selected]);

  const seed = async () => {
    setError("");
    try {
      await api.fl.seedGraph(meta?.run_id);
      await load();
    } catch (reason) {
      setError(reason.message);
    }
  };

  const openCampaign = async (id) => {
    try {
      setSelected(await api.graph.campaign(id));
      setFocusNode(null);
      setNeighbors(null);
    } catch (reason) {
      setError(reason.message);
    }
  };

  const openNode = async (pid) => {
    setFocusNode(pid);
    try {
      setNeighbors(await api.graph.neighbors(pid));
    } catch {
      setNeighbors({ neighbors: [] });
    }
  };

  return (
    <RiskShell
      title="Derived research risk graph"
      subtitle="Only pseudonymous accounts, model scores and aggregated transfer statistics enter Neo4j. Raw identifiers and balances are excluded."
    >
      {error && <ErrorPanel message={error} />}
      <div className="flex justify-end gap-2">
        {selected && (
          <button onClick={() => setSelected(null)} className="rounded-xl border px-4 py-2 text-sm">
            Show full graph
          </button>
        )}
        <button onClick={seed} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
          Rebuild derived graph
        </button>
      </div>
      {!graph ? (
        <LoadingPanel />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Visible accounts" value={visible.nodes.length} />
            <MetricCard label="Derived transfer edges" value={visible.edges.length} tone="emerald" />
            <MetricCard label="Detected campaigns" value={campaigns.length} tone="rose" />
            <MetricCard
              label="Graph snapshot"
              value={meta ? meta.snapshot_id.split(":")[0].slice(0, 12) : "—"}
              tone="slate"
            />
          </section>
          {meta && (
            <p className="text-xs text-muted-foreground">
              Snapshot <code className="font-mono">{meta.snapshot_id}</code> · scored by run{" "}
              <code className="font-mono">{meta.run_id}</code> · {meta.accounts} accounts ·{" "}
              {meta.edges} edges · source: {meta.source_split}. Institution-scoped view.
            </p>
          )}
          <section className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="relative min-h-[560px] overflow-hidden rounded-2xl border bg-slate-950 p-4">
              <svg viewBox="0 0 800 560" className="h-full min-h-[540px] w-full">
                {visible.edges.map((edge, index) => {
                  const s = positions.get(edge.source) || positions.get(edge.source === undefined ? "" : edge.source);
                  const t = positions.get(edge.target);
                  const sp = positions.get(edge.source);
                  const tp = positions.get(edge.target);
                  if (!sp || !tp) return null;
                  return (
                    <line
                      key={index}
                      x1={sp.x}
                      y1={sp.y}
                      x2={tp.x}
                      y2={tp.y}
                      stroke={edge.frac_flagged > 0.5 ? "#fb7185" : "#64748b"}
                      strokeOpacity={edge.frac_flagged > 0.5 ? 0.5 : 0.2}
                      strokeWidth={edge.frac_flagged > 0.5 ? 1.6 : 1}
                    />
                  );
                })}
                {visible.nodes.map((node) => {
                  const p = positions.get(node.id);
                  if (!p) return null;
                  return (
                    <g key={node.id} onClick={() => openNode(node.id)} className="cursor-pointer">
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={node.band === "high" ? 9 : node.band === "medium" ? 6.5 : 5}
                        fill={BAND_COLORS[node.band] || BAND_COLORS.low}
                        stroke={focusNode === node.id ? "#fff" : "none"}
                        strokeWidth={focusNode === node.id ? 2.5 : 0}
                        opacity={focusNode && focusNode !== node.id ? 0.35 : 1}
                      >
                        <title>{`${node.id.slice(0, 16)}… · ${pct(node.score)} · ${node.band}`}</title>
                      </circle>
                    </g>
                  );
                })}
              </svg>
              <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-3 py-2 text-xs text-white">
                {selected ? "Isolated campaign subgraph · click a node for neighbors" : "Clustered by detected community · click a node"}
              </div>
            </div>
            <div className="space-y-5">
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="text-xl font-semibold">Fraud-ring campaigns</h2>
                <div className="mt-4 max-h-72 space-y-2 overflow-auto">
                  {campaigns.map((campaign) => (
                    <button
                      key={campaign.id}
                      onClick={() => openCampaign(campaign.id)}
                      className={`w-full rounded-xl border p-3 text-left text-sm hover:border-indigo-500 ${selected?.id === campaign.id || selected?.label === campaign.label ? "border-indigo-500 bg-indigo-500/5" : ""}`}
                    >
                      <div className="flex justify-between">
                        <span className="font-medium">{campaign.label}</span>
                        <span className="text-rose-600">{campaign.n_high} high-risk</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {campaign.size} accounts · avg risk {pct(campaign.avg_score)} percentile
                      </p>
                    </button>
                  ))}
                </div>
                <Link href="/chat?mode=risk_analyst" className="mt-4 block rounded-xl border px-4 py-2.5 text-center text-sm">
                  Explain these rings in the copilot →
                </Link>
              </div>
              {neighbors && (
                <div className="rounded-2xl border bg-card p-6">
                  <h3 className="font-semibold">Neighbors of {String(focusNode).slice(0, 14)}…</h3>
                  <ul className="mt-3 max-h-44 space-y-2 overflow-auto font-mono text-xs">
                    {(neighbors.neighbors || []).slice(0, 10).map((n) => (
                      <li key={n.id} className="flex justify-between rounded-lg border p-2">
                        <span>{n.id.slice(0, 14)}…</span>
                        <span>{pct(n.score)} · {n.n_tx} tx</span>
                      </li>
                    ))}
                    {!(neighbors.neighbors || []).length && <li className="text-muted-foreground">No derived neighbors.</li>}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </RiskShell>
  );
}

export default function RiskGraphPage() {
  return (
    <ProtectedRoute allowedRoles={["analyst", "admin"]}>
      <GraphView />
    </ProtectedRoute>
  );
}
