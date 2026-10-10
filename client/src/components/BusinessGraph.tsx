"use client";

import type { Graph } from "@/lib/business-api";

const groups = ["PO", "GRN", "INVOICE", "PAYMENT", "CREDIT_NOTE", "RETURN", "PROFORMA"];
const colors: Record<string, string> = { PO: "#a7afff", GRN: "#77d3b6", INVOICE: "#e4b5ff", PAYMENT: "#f2b76c", CREDIT_NOTE: "#8dd4f2", RETURN: "#ee8992", PROFORMA: "#9ca3af" };
export default function BusinessGraph({ graph, onSelect }: { graph: Graph; onSelect?: (id: string) => void }) {
  const nodes = graph.nodes.slice(0, 30);
  const positions = new Map(nodes.map((node, index) => {
    const group = groups.indexOf(node.type);
    const row = nodes.slice(0, index).filter((other) => other.type === node.type).length;
    return [node.id, { x: 80 + Math.min(group < 0 ? 0 : group, 4) * 210, y: 80 + row * 100 }];
  }));
  const height = Math.max(360, ...[...positions.values()].map((position) => position.y + 70));
  return <div className="satya-graph"><div className="satya-graph-legend">{groups.filter((type) => nodes.some((node) => node.type === type)).map((type) => <span key={type}><i style={{ background: colors[type] }} />{type.replaceAll("_", " ")}</span>)}<span>Dashed = unresolved alternative</span></div><svg viewBox={`0 0 1060 ${height}`} role="img" aria-label="Source-backed order, receipt, invoice and payment relationships">{graph.edges.map((edge) => {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b) return null;
    const candidate = edge.status === "candidate";
    return <g key={edge.id}><path d={`M${a.x + 70},${a.y} C${(a.x + b.x) / 2 + 70},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`} stroke={candidate ? "#f2b76c" : "#747991"} strokeWidth="1.6" strokeDasharray={candidate ? "5 5" : undefined} fill="none" opacity="0.65" /><title>{edge.type} · {edge.status}{edge.amount ? ` · ${edge.amount}` : ""}</title></g>;
  })}{nodes.map((node) => {
    const { x, y } = positions.get(node.id)!;
    return <g key={node.id} transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={`Open ${node.label}`} onClick={() => onSelect?.(node.id)} onKeyDown={(event) => { if (event.key === "Enter") onSelect?.(node.id); }} style={{ cursor: "pointer" }}><rect x="-20" y="-25" width="155" height="55" rx="12" fill="var(--card)" stroke={colors[node.type] || "#9ca3af"} /><text x="-7" y="-3" fontSize="10" fill={colors[node.type] || "#9ca3af"}>{node.type.replaceAll("_", " ")}</text><text x="-7" y="15" fontSize="12" fill="var(--foreground)">{node.label.slice(0, 20)}</text><title>{node.label}</title></g>;
  })}</svg><details><summary className="text-sm text-muted-foreground">Accessible relationship list</summary><ul className="mt-3 space-y-2 text-xs">{graph.edges.map((edge) => <li key={edge.id}>{edge.source} → {edge.target}: {edge.type} ({edge.status})</li>)}</ul></details></div>;
}
