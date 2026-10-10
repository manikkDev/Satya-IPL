"use client";

import { useId, useMemo, useState } from "react";
import { ArrowRight, Database, FileSearch, Minus, Plus, RotateCcw, Search } from "lucide-react";
import { money, type Graph } from "@/lib/business-api";

const groups = ["PO", "GRN", "INVOICE", "PAYMENT", "CREDIT_NOTE", "RETURN", "PROFORMA"];
const labels: Record<string, string> = { PO: "Purchase orders", GRN: "Delivery receipts", INVOICE: "Invoices", PAYMENT: "Payments", CREDIT_NOTE: "Credit notes", RETURN: "Returns", PROFORMA: "Proforma invoices" };
const colors: Record<string, string> = { PO: "#7b8fdb", GRN: "#45aa94", INVOICE: "#b087d1", PAYMENT: "#d69b48", CREDIT_NOTE: "#5aa6c5", RETURN: "#d48282", PROFORMA: "#94a3b8" };
const readable = (value: string) => value.toLowerCase().replaceAll("_", " ");
const wrapLabel = (value: string) => value.match(/.{1,22}(?:\s|$)|.{1,22}/g)?.map((line) => line.trim()) || [value];

export default function BusinessGraph({ graph, onSelect }: { graph: Graph; onSelect?: (id: string) => void }) {
  const markerId = useId().replaceAll(":", "");
  const searchId = useId();
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { columns, positions, width, height } = useMemo(() => {
    const types = [...new Set(graph.nodes.map((node) => node.type))];
    const columns = [...groups.filter((type) => types.includes(type)), ...types.filter((type) => !groups.includes(type)).sort()];
    const rows = new Map<string, number>();
    const positions = new Map(graph.nodes.map((node) => {
      const row = rows.get(node.type) || 0;
      rows.set(node.type, row + 1);
      return [node.id, { x: 32 + columns.indexOf(node.type) * 264, y: 84 + row * 126 }];
    }));
    return { columns, positions, width: Math.max(540, columns.length * 264 + 32), height: Math.max(300, ...[...positions.values()].map((position) => position.y + 130)) };
  }, [graph.nodes]);
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const neighbors = new Set(graph.edges.filter((edge) => edge.source === selectedId || edge.target === selectedId).flatMap((edge) => [edge.source, edge.target]));
  const nodeLabel = (id: string) => graph.nodes.find((node) => node.id === id)?.label || id;
  const links = selected ? graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : graph.edges;
  const term = query.trim().toLowerCase();
  const hits = graph.nodes.filter((node) => `${node.id} ${node.label} ${labels[node.type] || node.type}`.toLowerCase().includes(term)).length;

  if (!graph.nodes.length) return <div className="satya-empty-state"><Database size={30} /><h2>No connected records yet</h2><p>The graph will appear when linked records are available. No connections have been inferred.</p></div>;

  return <div className="satya-graph">
    <div className="satya-graph-toolbar"><span className="satya-tag"><Database size={14} className="mr-2" />{graph.source?.toLowerCase().includes("neo4j") && !graph.degraded ? "Neo4j evidence graph" : "Stored record relationships"}</span><div className="satya-graph-tools"><button className="satya-button secondary" aria-label="Zoom out graph" disabled={zoom <= .75} onClick={() => setZoom((value) => Math.max(.75, value - .25))}><Minus size={17} /></button><span className="text-sm" aria-live="polite">{Math.round(zoom * 100)}%</span><button className="satya-button secondary" aria-label="Zoom in graph" disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, value + .25))}><Plus size={17} /></button><button className="satya-button secondary" onClick={() => { setZoom(1); setSelectedId(null); setQuery(""); }}><RotateCcw size={15} />Reset</button></div></div>
    {graph.degraded && <div className="satya-notice warning">The graph service is unavailable. These connections come from stored records instead.</div>}
    <div className="satya-search-input mb-3"><label htmlFor={searchId} className="sr-only">Find a graph record</label><Search size={18} aria-hidden="true" /><input id={searchId} className="satya-input" placeholder="Find an order, invoice or payment in the graph" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <p className="text-sm text-muted-foreground mb-4" role="status">{term ? `${hits} matching records. ` : `${graph.nodes.length} records · ${graph.edges.length} connections. `}Select a record to explore its links. Scroll inside the graph to see more.</p>
    <div className="satya-graph-canvas" tabIndex={0} role="region" aria-label="Scrollable record graph">
      <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Connections between orders, deliveries, invoices and payments">
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" /></marker></defs>
        {columns.map((type, index) => <g key={type}><rect x={24 + index * 264} y="20" width="216" height={height - 40} rx="12" fill="var(--card)" opacity=".55" /><text x={36 + index * 264} y="49" fontSize="14" fontWeight="600" fill="var(--foreground)">{labels[type] || readable(type)}</text></g>)}
        {graph.edges.map((edge) => {
          const a = positions.get(edge.source), b = positions.get(edge.target);
          if (!a || !b) return null;
          const y1 = a.y + 42, y2 = b.y + 42;
          const sameColumn = a.x === b.x;
          const forward = a.x < b.x;
          const x1 = a.x + (sameColumn || forward ? 200 : 0), x2 = b.x + (forward ? 0 : 200);
          const bend = sameColumn ? x1 + 40 : (x1 + x2) / 2;
          const candidate = edge.status === "candidate";
          const active = !selectedId || edge.source === selectedId || edge.target === selectedId;
          const path = edge.source === edge.target ? `M${x1},${y1 - 10} C${x1 + 46},${y1 - 56} ${x1 + 46},${y1 + 56} ${x1},${y1 + 10}` : `M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2}`;
          return <g key={edge.id} opacity={active ? .85 : .15}><path d={path} stroke={candidate ? "#c5913d" : "var(--muted-foreground)"} strokeWidth={selectedId && active ? 2.5 : 1.6} strokeDasharray={candidate ? "6 5" : undefined} fill="none" markerEnd={`url(#${markerId})`} /><title>{nodeLabel(edge.source)} → {nodeLabel(edge.target)}: {readable(edge.type)} ({readable(edge.status)}){edge.amount ? ` · ${edge.amount}` : ""}</title></g>;
        })}
        {graph.nodes.map((node) => {
          const { x, y } = positions.get(node.id)!;
          const match = !term || `${node.id} ${node.label} ${labels[node.type] || node.type}`.toLowerCase().includes(term);
          const active = (!selectedId || selectedId === node.id || neighbors.has(node.id)) && match;
          const lines = wrapLabel(node.label);
          return <g key={node.id} className="satya-graph-node" transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={`Explore ${node.label}, ${labels[node.type] || readable(node.type)}`} aria-pressed={selectedId === node.id} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); } }} style={{ cursor:"pointer", opacity:active ? 1 : .25 }}><rect width="200" height="86" rx="9" fill="var(--card)" stroke={selectedId === node.id ? "var(--primary)" : "var(--border)"} strokeWidth={selectedId === node.id ? 3 : 1.5} /><rect x="0" y="12" width="4" height="62" rx="2" fill={colors[node.type] || "#94a3b8"} /><text x="14" y="24" fontSize="11" fill="var(--muted-foreground)">{labels[node.type] || readable(node.type)}</text><text x="14" y="46" fontSize="14" fontWeight="600" fill="var(--foreground)">{lines.slice(0, 2).map((line, index) => <tspan x="14" dy={index === 0 ? 0 : 18} key={index}>{line}{index === 1 && lines.length > 2 ? "…" : ""}</tspan>)}</text><title>{node.label}{node.amount ? ` · ${money(node.amount, node.currency)}` : ""}</title></g>;
        })}
      </svg>
    </div>
    <div className="satya-graph-legend">{columns.map((type) => <span key={type}><i style={{ background:colors[type] || "#94a3b8" }} />{labels[type] || readable(type)}</span>)}<span>Solid line: recorded link</span><span>Dashed line: possible link, not confirmed</span></div>
    {selected && <div className="satya-graph-selection"><h3>{selected.label}</h3><p>{labels[selected.type] || readable(selected.type)} · {selected.id}{selected.amount ? ` · ${money(selected.amount, selected.currency)}` : ""}</p><div className="satya-case-card-actions">{onSelect && <button className="satya-button secondary" onClick={() => onSelect(selected.id)}><FileSearch size={16} />View source evidence</button>}<button className="satya-button secondary" onClick={() => setSelectedId(null)}>Show all connections</button></div><ul className="satya-relationship-list">{links.map((edge) => <li key={edge.id}><strong>{nodeLabel(edge.source)}</strong><ArrowRight size={15} /><strong>{nodeLabel(edge.target)}</strong><small>{readable(edge.type)} · {edge.status === "candidate" ? "Not confirmed" : readable(edge.status)}{edge.amount ? ` · ${edge.amount}` : ""}</small></li>)}</ul>{!links.length && <p>No connections are recorded for this item.</p>}</div>}
    <details className="satya-chat-section"><summary>{selected ? "All graph connections" : "Read the graph as a list"} ({graph.edges.length})</summary><ul className="satya-relationship-list">{graph.edges.map((edge) => <li key={edge.id}><strong>{nodeLabel(edge.source)}</strong><ArrowRight size={15} /><strong>{nodeLabel(edge.target)}</strong><small>{readable(edge.type)} · {edge.status === "candidate" ? "Not confirmed" : readable(edge.status)}{edge.amount ? ` · ${edge.amount}` : ""}</small></li>)}</ul></details>
  </div>;
}
