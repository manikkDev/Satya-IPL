"use client";

// Money-trail graph (docs/plan/06 §6). Left→right swim lanes by stage so a
// non-technical owner reads the order's story in seconds. Node x-positions are
// fixed per lane (deterministic), y stacked by date — the engine already
// ordered the evidence, so layout never reshuffles the story.
// Certainty is word + line style + colour (never colour alone).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import cytoscape from "cytoscape";
import {
  ZoomIn, ZoomOut, Maximize, Camera, List, GitBranch, Play, RotateCcw,
  Sparkles, X, type LucideIcon,
} from "lucide-react";
import type { GraphPayload, GraphNode, GraphEdge, Certainty } from "@/lib/api/types";
import { Money, Qty, DateText, CertaintyBadge } from "@/components/ui/v2";
import { CERTAINTY_LABEL } from "@/content/copy/vocabulary";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const LANES: { id: string; label: string }[] = [
  { id: "party", label: "Parties" },
  { id: "order", label: "Order" },
  { id: "dispatch", label: "Dispatch" },
  { id: "receipt", label: "Goods received" },
  { id: "inspection", label: "Quality check" },
  { id: "invoice", label: "Invoices" },
  { id: "payment", label: "Payments" },
  { id: "tax", label: "GST" },
  { id: "finding", label: "Issues" },
];

const LANE_X: Record<string, number> = Object.fromEntries(LANES.map((lane, i) => [lane.id, 90 + i * 195]));

const EDGE_STYLE: Record<Certainty | "DUPLICATE", { width: number; style: string; color: string; arrow: string }> = {
  CONFIRMED: { width: 2.5, style: "solid", color: "#0f766e", arrow: "triangle" },
  PROBABLE: { width: 1.5, style: "solid", color: "#0e7490", arrow: "triangle" },
  POSSIBLE: { width: 1.5, style: "dashed", color: "#a16207", arrow: "triangle" },
  AMBIGUOUS: { width: 1.5, style: "dotted", color: "#7c3aed", arrow: "diamond" },
  INSUFFICIENT_EVIDENCE: { width: 1, style: "dotted", color: "#64748b", arrow: "diamond" },
  DUPLICATE: { width: 2, style: "dashed", color: "#b91c1c", arrow: "triangle" },
};

const TYPE_TAG: Record<string, string> = {
  PO: "PO", PO_AMENDMENT: "PO rev", PO_ACK: "Ack", RELEASE_ORDER: "Release",
  PI_IN: "PI", PI_OUT: "PI", INVOICE_IN: "Invoice", INVOICE_OUT: "Invoice",
  CREDIT_NOTE_IN: "Credit note", DEBIT_NOTE_OUT: "Debit note",
  DELIVERY_CHALLAN: "Challan", EWAY_BILL: "E-way", GRN: "GRN", QC: "QC",
  PAYMENT_OUT: "Payment", PAYMENT_IN: "Payment", ADVANCE_OUT: "Advance",
  SUPPLIER: "Supplier", ENTITY: "Entity", ITEM: "Item", FINDING: "Issue",
  GSTR2B_ENTRY: "GSTR-2B", TDS_ENTRY: "TDS", BANK_LINE: "Bank",
};


function nodeKeyValue(node: GraphNode): string {
  if (node.amount) return formatMoney(node.amount);
  if (node.qty) return `${node.qty} units`;
  return node.subtitle ?? "";
}

function edgeCertainty(edge: GraphEdge): Certainty | "DUPLICATE" {
  return edge.kind === "DUPLICATE_OF" ? "DUPLICATE" : edge.certainty;
}

/* ---------------- list view (accessibility alternative) ---------------- */

function ListView({ graph, onSelect }: { graph: GraphPayload; onSelect: (node: GraphNode) => void }) {
  return (
    <div className="space-y-5 p-4">
      {LANES.map((lane) => {
        const nodes = graph.nodes.filter((node) => node.stage === lane.id);
        if (!nodes.length) return null;
        return (
          <section key={lane.id}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{lane.label}</h3>
            <ul className="mt-2 space-y-1.5">
              {nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(node)}
                    className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-left text-sm hover:border-[var(--accent)]"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-[var(--ink)]">{node.label}</span>
                      {node.subtitle ? <span className="ml-2 text-xs text-[var(--muted)]">{node.subtitle}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {node.amount ? formatMoney(node.amount) : node.qty ? `${node.qty} units` : ""}
                      {node.date ? ` · ${node.date}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------- side panel ---------------- */

function SelectionPanel({
  node, edge, graph, onClose, onAsk,
}: {
  node?: GraphNode; edge?: GraphEdge; graph: GraphPayload; onClose: () => void; onAsk?: (about: string) => void;
}) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] p-4" aria-label="Selection details">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-[var(--ink)]">{node ? node.label : edge?.label}</h3>
        <button type="button" onClick={onClose} aria-label="Close details" className="text-[var(--muted)] hover:text-[var(--ink)]">
          <X size={16} />
        </button>
      </div>
      {node && (
        <div className="mt-3 space-y-2 text-sm text-[var(--ink-2)]">
          <p><span className="text-[var(--muted)]">Type:</span> {TYPE_TAG[node.type] ?? node.type}</p>
          {node.subtitle ? <p><span className="text-[var(--muted)]">Detail:</span> {node.subtitle}</p> : null}
          {node.amount ? <p><span className="text-[var(--muted)]">Amount:</span> <Money value={node.amount} /></p> : null}
          {node.qty ? <p><span className="text-[var(--muted)]">Quantity:</span> <Qty value={node.qty} /></p> : null}
          {node.date ? <p><span className="text-[var(--muted)]">Date:</span> <DateText value={node.date} /></p> : null}
          {node.severity ? <p><span className="text-[var(--muted)]">Issue severity:</span> {node.severity}</p> : null}
          {node.documentId && onAsk ? (
            <button type="button" onClick={() => onAsk(node.label)} className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]">
              <Sparkles size={13} aria-hidden="true" /> Ask Satya about this
            </button>
          ) : null}
        </div>
      )}
      {edge && (
        <div className="mt-3 space-y-2 text-sm text-[var(--ink-2)]">
          <p><CertaintyBadge certainty={edge.certainty} /></p>
          <p className="leading-relaxed">{edge.explanation}</p>
          {edge.amount ? <p><span className="text-[var(--muted)]">Amount:</span> <Money value={edge.amount} /></p> : null}
          {edge.qty ? <p><span className="text-[var(--muted)]">Quantity:</span> <Qty value={edge.qty} /></p> : null}
          <p className="text-xs text-[var(--muted)]">
            {graph.nodes.find((n) => n.id === edge.source)?.label} → {graph.nodes.find((n) => n.id === edge.target)?.label}
          </p>
          {edge.certainty === "AMBIGUOUS" || edge.certainty === "POSSIBLE" ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium text-[var(--muted)]">Your call (recorded as a decision):</p>
              <div className="flex gap-2">
                <button type="button" className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white">Confirm link</button>
                <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)]">Reject link</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

/* ---------------- main component ---------------- */

type Filter = "all" | "payments" | "issues";

export function MoneyTrail({ graph, onAskAbout }: { graph: GraphPayload; onAskAbout?: (about: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selection, setSelection] = useState<{ node?: GraphNode; edge?: GraphEdge }>({});
  const [listView, setListView] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [replay, setReplay] = useState<number | null>(null); // null = everything known
  const [search, setSearch] = useState("");
  const [live, setLive] = useState("");
  const router = useRouter();

  // B's neo4j projection carries no replay timeline — only snapshot graphs do.
  const timeline = useMemo(() => graph.timeline ?? [], [graph.timeline]);

  const visibleIds = useMemo(() => {
    if (replay === null) return null;
    const nodes = new Set<string>();
    const edges = new Set<string>();
    timeline.slice(0, replay + 1).forEach((step) => {
      step.nodeIds.forEach((id) => nodes.add(id));
      step.edgeIds.forEach((id) => edges.add(id));
    });
    return { nodes, edges };
  }, [replay, timeline]);

  const filtered = useMemo(() => {
    const nodeOk = (node: GraphNode) => {
      if (visibleIds && !visibleIds.nodes.has(node.id)) return false;
      if (filter === "payments" && node.stage !== "payment" && node.stage !== "party") return false;
      if (filter === "issues" && !(node.type === "FINDING" || node.severity)) return false;
      return true;
    };
    const nodes = graph.nodes.filter(nodeOk);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target) && (!visibleIds || visibleIds.edges.has(edge.id)),
    );
    return { nodes, edges };
  }, [graph, visibleIds, filter]);

  const select = useCallback((sel: { node?: GraphNode; edge?: GraphEdge }, announce: string) => {
    setSelection(sel);
    setLive(announce);
  }, []);

  /* --- cytoscape lifecycle --- */
  useEffect(() => {
    if (!container.current || listView) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const byStage = new Map<string, GraphNode[]>();
    for (const node of filtered.nodes) {
      const list = byStage.get(node.stage) ?? [];
      list.push(node);
      byStage.set(node.stage, list);
    }
    const positions = new Map<string, { x: number; y: number }>();
    for (const [stage, nodes] of byStage) {
      nodes.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      nodes.forEach((node, i) => positions.set(node.id, { x: LANE_X[stage] ?? 90, y: 70 + i * 96 }));
    }

    const cy = cytoscape({
      container: container.current,
      elements: [
        ...filtered.nodes.map((node) => ({
          data: {
            id: node.id,
            label: `${TYPE_TAG[node.type] ?? node.type} · ${node.label}\n${nodeKeyValue(node)}${node.date ? ` · ${node.date}` : ""}`,
            severity: node.severity ?? "",
            stage: node.stage,
          },
          position: positions.get(node.id),
          classes: `n-${node.type === "FINDING" ? "finding" : "doc"} s-${node.stage}${node.severity ? " sev" : ""}${search && node.label.toLowerCase().includes(search.toLowerCase()) ? " searched" : ""}`,
        })),
        ...filtered.edges.map((edge) => ({
          data: { id: edge.id, source: edge.source, target: edge.target, edge },
          classes: `e-${edgeCertainty(edge).toLowerCase()}`,
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            shape: "round-rectangle",
            width: 168,
            height: 52,
            "background-color": "#ffffff",
            "border-width": 1.5,
            "border-color": "#e3e0d8",
            label: "data(label)",
            "font-size": 10,
            "font-family": "Inter, sans-serif",
            color: "#14213d",
            "text-wrap": "wrap",
            "text-max-width": "150px",
            "text-valign": "center",
            "text-halign": "center",
            "line-height": 1.35,
          },
        },
        // stage accents — the v1 look: tinted cards, each step reads its own colour
        { selector: "node.s-order", style: { "background-color": "#eef2ff", "border-color": "#7d8fb4", "border-width": 2 } },
        { selector: "node.s-receipt", style: { "background-color": "#e6f9f2", "border-color": "#2dd4a8", "border-width": 2 } },
        { selector: "node.s-inspection", style: { "background-color": "#fef3e2", "border-color": "#f0b95c", "border-width": 2 } },
        { selector: "node.s-invoice", style: { "background-color": "#f1ebfe", "border-color": "#a78bfa", "border-width": 2 } },
        { selector: "node.s-payment", style: { "background-color": "#fff1e6", "border-color": "#fb923c", "border-width": 2 } },
        { selector: "node.s-adjustment", style: { "background-color": "#fdeaf4", "border-color": "#f472b6", "border-width": 2 } },
        { selector: "node.s-party", style: { "background-color": "#eef2f7", "border-color": "#94a3b8", "border-width": 2 } },
        { selector: "node.s-tax", style: { "background-color": "#e8f6fd", "border-color": "#38bdf8", "border-width": 2 } },
        { selector: "node.s-dispatch", style: { "background-color": "#eef2f7", "border-color": "#94a3b8", "border-width": 2 } },
        {
          selector: "node.sev",
          style: { "border-width": 2.5, "border-color": "#c2410c" },
        },
        {
          selector: "node.n-finding",
          style: { width: 140, height: 44, "background-color": "#f6e7dc", "border-color": "#c2410c", shape: "round-rectangle" },
        },
        {
          selector: "node.searched",
          style: { "border-color": "#0f766e", "border-width": 3 },
        },
        {
          selector: "node.highlight",
          style: { "border-color": "#0f766e", "border-width": 3, "background-color": "#e6f3f1" },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "arrow-scale": 1.1,
            label: "",
          },
        },
        ...Object.entries(EDGE_STYLE).map(([key, style]) => ({
          selector: `edge.e-${key.toLowerCase()}`,
          style: {
            width: style.width,
            "line-style": style.style,
            "line-color": style.color,
            "target-arrow-color": style.color,
            "target-arrow-shape": style.arrow === "diamond" ? ("diamond" as const) : ("triangle" as const),
          },
        })),
        {
          selector: "edge.highlight",
          style: { "line-color": "#0f766e", "target-arrow-color": "#0f766e", width: 3 },
        },
        {
          selector: "edge.dim",
          style: { opacity: 0.15 },
        },
        {
          selector: "node.dim",
          style: { opacity: 0.25 },
        },
      ],
      layout: { name: "preset" },
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      autoungrabify: false,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (event) => {
      const node = graph.nodes.find((n) => n.id === event.target.id());
      if (node) select({ node }, `${node.label} selected`);
      cy.elements().removeClass("highlight dim");
      event.target.closedNeighborhood().addClass("highlight");
    });
    cy.on("tap", "edge", (event) => {
      const data = event.target.data("edge") as GraphEdge;
      select({ edge: data }, `Link ${data.label} selected — ${CERTAINTY_LABEL[data.certainty]}`);
      cy.elements().removeClass("highlight dim");
      event.target.addClass("highlight");
    });
    cy.on("tap", (event) => {
      if (event.target === cy) {
        cy.elements().removeClass("highlight dim");
        setSelection({});
      }
    });
    cy.on("mouseover", "node", (event) => {
      if (reduced) return;
      const poNode = cy.nodes('[stage = "order"]').first();
      const node = event.target;
      cy.elements().addClass("dim");
      node.removeClass("dim");
      if (poNode.length && node.id() !== poNode.id()) {
        const path = cy.elements().aStar({ root: node, goal: poNode, directed: false });
        path.path.removeClass("dim").addClass("highlight");
      }
    });
    cy.on("mouseout", () => cy.elements().removeClass("dim highlight"));

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [filtered, graph, listView, search, select]);

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };
  const fit = () => cyRef.current?.fit(undefined, 40);
  const exportPng = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const link = document.createElement("a");
    link.href = cy.png({ full: true, scale: 2, bg: "#f7f6f2" });
    link.download = "money-trail.png";
    link.click();
  };

  const ask = onAskAbout ?? ((about: string) => router.push(`/app/ask?about=${encodeURIComponent(about)}`));
  const ToolButton = ({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--accent)]",
        active && "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]",
      )}
    >
      <Icon size={15} />
    </button>
  );

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Find a document — ${filtered.nodes.length} records · ${filtered.edges.length} connections`}
          aria-label="Find a document in the graph"
          className="h-8 w-44 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-2.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex gap-1" role="group" aria-label="Filters">
          {([["all", "Everything"], ["payments", "Payments only"], ["issues", "Issues only"]] as [Filter, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                filter === key ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <ToolButton icon={ZoomOut} label="Zoom out" onClick={() => zoom(1 / 1.25)} />
          <ToolButton icon={ZoomIn} label="Zoom in" onClick={() => zoom(1.25)} />
          <ToolButton icon={Maximize} label="Fit graph" onClick={fit} />
          <ToolButton icon={Camera} label="Download as image" onClick={exportPng} />
          <ToolButton icon={List} label="View as list" onClick={() => setListView((v) => !v)} active={listView} />
          <button
            type="button"
            onClick={() => ask("Explain this money trail")}
            className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
          >
            <Sparkles size={13} aria-hidden="true" /> Explain this graph
          </button>
        </div>
      </div>

      {graph.source === "snapshot" && (
        <p className="border-b border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--muted)]">
          Showing a saved graph — the live graph service is unavailable right now.
        </p>
      )}

      <div className="flex">
        <div className="min-w-0 flex-1">
          {listView ? (
            <ListView graph={{ ...graph, nodes: filtered.nodes, edges: filtered.edges }} onSelect={(node) => select({ node }, `${node.label} selected`)} />
          ) : (
            <div className="relative">
              {/* lane headers */}
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                {LANES.filter((lane) => filtered.nodes.some((n) => n.stage === lane.id)).map((lane) => (
                  <div key={lane.id} className="absolute top-0 bottom-0 border-l border-dashed border-[var(--line)]" style={{ left: LANE_X[lane.id] - 96 }}>
                    <span className="absolute left-2 top-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{lane.label}</span>
                  </div>
                ))}
              </div>
              <div ref={container} className="h-[420px] w-full" role="application" aria-label="Money trail graph" />
            </div>
          )}

          {/* replay */}
          {timeline.length > 1 && !listView && (
            <div className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-2.5">
              <Play size={14} className="text-[var(--muted)]" aria-hidden="true" />
              <label htmlFor="replay" className="text-xs font-medium text-[var(--ink-2)]">What did we know…</label>
              <input
                id="replay"
                type="range"
                min={0}
                max={timeline.length - 1}
                value={replay ?? timeline.length - 1}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setReplay(value >= timeline.length - 1 ? null : value);
                }}
                className="w-48 accent-[var(--accent)]"
                aria-valuetext={replay === null ? "Everything we know now" : `As of ${timeline[replay].at}`}
              />
              <span className="text-xs text-[var(--muted)]">
                {replay === null ? "Everything we know now" : `As of ${timeline[replay].at}`}
              </span>
              {replay !== null && (
                <button type="button" onClick={() => setReplay(null)} className="inline-flex items-center gap-1 text-xs text-[var(--accent)]">
                  <RotateCcw size={12} /> Back to now
                </button>
              )}
            </div>
          )}
        </div>

        {(selection.node || selection.edge) && (
          <SelectionPanel node={selection.node} edge={selection.edge} graph={graph} onClose={() => setSelection({})} onAsk={ask} />
        )}
      </div>

      {/* legend */}
      <details className="border-t border-[var(--line)] px-3 py-2" open>
        <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">How to read this</summary>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 pb-1 text-xs text-[var(--ink-2)]">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-7 border-t-2" style={{ borderColor: "#0f766e" }} /> Confirmed link</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-7 border-t-2" style={{ borderColor: "#0e7490" }} /> Likely</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-7 border-t-2 border-dashed" style={{ borderColor: "#a16207" }} /> Possible</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-7 border-t-2 border-dotted" style={{ borderColor: "#7c3aed" }} /> Unclear — needs your decision</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-7 border-t-2 border-dashed" style={{ borderColor: "#b91c1c" }} /> Suspected duplicate</span>
        </div>
      </details>

      <span className="sr-only" aria-live="polite">{live}</span>
      <span className="sr-only"><GitBranch size={0} aria-hidden="true" /></span>
    </div>
  );
}
