"use client";

import React, { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import { mlPayloadToGraph } from "@/utils/mlPayloadToGraph";
import { cn } from "@/lib/utils";
import { Network } from "lucide-react";

const NODE_GROUPS: Record<string, { color: string; label: string }> = {
  company: { color: "var(--chart-1)", label: "Company" },
  shell: { color: "var(--destructive)", label: "Shell" },
  person: { color: "var(--chart-2)", label: "Person" },
  bank: { color: "var(--chart-4)", label: "Bank" },
  borrower: { color: "var(--chart-2)", label: "Borrower" },
  government: { color: "var(--chart-5)", label: "Government" },
  property: { color: "var(--chart-3)", label: "Property" },
  default: { color: "var(--chart-5)", label: "Entity" },
};

interface MlPayloadGraphViewerProps {
  /** ML generate payload (P1–P6 format) */
  payload: Record<string, unknown>;
  /** Optional pattern label e.g. P1, P2 */
  pattern?: string;
  /** Optional sample_id */
  sampleId?: string;
  className?: string;
  height?: number;
}

export function MlPayloadGraphViewer({
  payload,
  pattern,
  sampleId,
  className,
  height = 320,
}: MlPayloadGraphViewerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<d3.SimulationNodeDatum, d3.SimulationLinkDatum<d3.SimulationNodeDatum>> | null>(null);

  const { nodes, links, graph: graphMeta } = useMemo(() => {
    const out = mlPayloadToGraph(payload);
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    const validLinks = out.links.filter(
      (l) => nodeIds.has(String(l.source)) && nodeIds.has(String(l.target))
    );
    return { nodes: out.nodes, links: validLinks, graph: out.graph || { title: "", subtitle: "" } };
  }, [payload]);

  const groupsInUse = useMemo(() => {
    const set = new Set(nodes.map((n) => n.group));
    return Array.from(set);
  }, [nodes]);

  useEffect(() => {
    const el = svgRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap || nodes.length === 0) return;

    const W = wrap.clientWidth || 400;
    const H = height;

    d3.select(el).attr("viewBox", `0 0 ${W} ${H}`);
    const svg = d3.select(el);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "ml-graph-glow").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
    filter.append("feGaussianBlur").attr("stdDeviation", 1.5).attr("result", "blur");
    filter.append("feFlood").attr("flood-color", "currentColor").attr("flood-opacity", 0.15).attr("result", "color");
    filter.append("feComposite").attr("in", "color").attr("in2", "blur").attr("operator", "in").attr("result", "glow");
    const merge = filter.append("feMerge");
    merge.append("feMergeNode").attr("in", "glow");
    merge.append("feMergeNode").attr("in", "SourceGraphic");
    defs
      .append("marker")
      .attr("id", "ml-graph-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "currentColor")
      .attr("opacity", "0.7");

    const g = svg.append("g").attr("class", "zoom-layer");
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const linkG = g.append("g").attr("class", "link-layer");
    const nodeG = g.append("g").attr("class", "node-layer");

    type NodeDatum = { id: string; label: string; group: string; size?: number; tooltip?: string; x?: number; y?: number; fx?: number | null; fy?: number | null };
    const nodeData = nodes.map((n) => ({ ...n })) as NodeDatum[];
    const nodeIds = new Set(nodeData.map((n) => n.id));
    const linkData = links
      .filter((l) => nodeIds.has(String(l.source)) && nodeIds.has(String(l.target)))
      .map((l) => ({ ...l, source: l.source as string, target: l.target as string }));

    const simulation = d3
      .forceSimulation(nodeData as d3.SimulationNodeDatum[])
      .force(
        "links",
        d3
          .forceLink(linkData)
          .id((d) => (d as NodeDatum).id)
          .distance(160)
          .strength((d: { strength?: number }) => d.strength ?? 0.4)
      )
      .force("charge", d3.forceManyBody().strength(-320))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide().radius((d) => ((d as NodeDatum).size ?? 8) + 32))
      .alphaDecay(0.02);

    simulationRef.current = simulation;

    const linkSel = linkG
      .selectAll<SVGGElement, (typeof linkData)[0]>("g.link")
      .data(linkData)
      .join("g")
      .attr("class", "link");

    linkSel
      .append("line")
      .attr("class", "link-line")
      .attr("stroke", "var(--primary)")
      .attr("stroke-opacity", (d) => 0.35 + Math.min(0.4, (d.weight ?? 1) * 0.15))
      .attr("stroke-width", (d) => Math.max(1, Math.min(3.5, (d.weight ?? 1) * 1.5)))
      .attr("marker-end", "url(#ml-graph-arrow)");

    const linkLabelG = linkSel.append("g").attr("class", "link-label-wrap").attr("pointer-events", "none");
    linkLabelG.append("rect").attr("class", "link-label-bg").attr("rx", 3).attr("ry", 3);
    linkLabelG
      .append("text")
      .attr("class", "link-label")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "9px")
      .attr("fill", "var(--muted-foreground)")
      .attr("font-weight", "500")
      .text((d) => d.label || "");

    const nodeSel = nodeG
      .selectAll<SVGGElement, NodeDatum>("g.node")
      .data(nodeData, (d) => d.id)
      .join("g")
      .attr("class", "node cursor-grab active:cursor-grabbing")
      .call(
        d3
          .drag<SVGGElement, NodeDatum>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    nodeSel
      .append("circle")
      .attr("r", (d) => d.size ?? 10)
      .attr("fill", (d) => NODE_GROUPS[d.group]?.color ?? NODE_GROUPS.default.color)
      .attr("fill-opacity", 0.92)
      .attr("stroke", "var(--background)")
      .attr("stroke-width", 2)
      .attr("filter", "url(#ml-graph-glow)");

    nodeSel.append("title").text((d) => (d.tooltip ? `${d.label}\n\n${d.tooltip}` : d.label));

    const labelG = nodeSel.append("g").attr("class", "node-label-wrap").attr("pointer-events", "none");
    labelG
      .append("rect")
      .attr("class", "node-label-bg")
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("fill", "var(--background)")
      .attr("stroke", "var(--border)")
      .attr("stroke-width", 1);
    labelG
      .append("text")
      .attr("class", "node-label-text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "var(--foreground)")
      .text((d) => {
        const s = d.label || "";
        return s.length > 24 ? s.slice(0, 22) + "…" : s;
      });

    simulation.on("tick", () => {
      linkSel
        .select(".link-line")
        .attr("x1", (d) => (d.source as { x?: number }).x ?? 0)
        .attr("y1", (d) => (d.source as { y?: number }).y ?? 0)
        .attr("x2", (d) => (d.target as { x?: number }).x ?? 0)
        .attr("y2", (d) => (d.target as { y?: number }).y ?? 0);
      const linkMidX = (d: (typeof linkData)[0]) => ((d.source as { x?: number }).x! + (d.target as { x?: number }).x!) / 2;
      const linkMidY = (d: (typeof linkData)[0]) => ((d.source as { y?: number }).y! + (d.target as { y?: number }).y!) / 2;
      linkSel.select(".link-label").attr("x", (d) => linkMidX(d)).attr("y", (d) => linkMidY(d));
      linkSel.each(function (d) {
        const g = d3.select(this);
        const textEl = g.select<SVGTextElement>(".link-label").node();
        const rect = g.select<SVGRectElement>(".link-label-bg");
        if (textEl) {
          const b = textEl.getBBox();
          const pad = 4;
          const mx = linkMidX(d);
          const my = linkMidY(d);
          rect
            .attr("x", mx - b.width / 2 - pad)
            .attr("y", my - b.height / 2 - pad)
            .attr("width", b.width + pad * 2)
            .attr("height", b.height + pad * 2)
            .attr("fill", "var(--background)")
            .attr("opacity", 0.95);
        }
      });
      nodeSel.attr("transform", (d) => `translate(${(d as NodeDatum).x ?? 0},${(d as NodeDatum).y ?? 0})`);
      nodeSel.each(function (d) {
        const g = d3.select(this);
        const r = d.size ?? 10;
        const labelG = g.select<SVGGElement>(".node-label-wrap");
        const textEl = g.select<SVGTextElement>(".node-label-text").node();
        const rect = g.select<SVGRectElement>(".node-label-bg");
        labelG.attr("transform", `translate(0,${r + 12})`);
        if (textEl) {
          const b = textEl.getBBox();
          const padX = 8;
          const padY = 4;
          rect
            .attr("x", -b.width / 2 - padX)
            .attr("y", -b.height / 2 - padY)
            .attr("width", b.width + padX * 2)
            .attr("height", b.height + padY * 2);
        }
      });
    });

    simulation.alpha(1).restart();

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [nodes, links, height, payload]);

  if (nodes.length === 0) return null;

  const hasHeader = graphMeta.title || graphMeta.subtitle || pattern || sampleId;
  const showLegend = groupsInUse.length > 0 && groupsInUse.length <= 8;

  return (
    <div className={cn("rounded-xl border border-border/50 bg-gradient-to-b from-muted/40 to-muted/20 overflow-hidden shadow-sm", className)}>
      {hasHeader && (
        <div className="px-4 py-2.5 border-b border-border/50 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            {graphMeta.title && (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Network className="h-4 w-4 text-primary" />
                {graphMeta.title}
              </span>
            )}
            {(pattern || sampleId) && (
              <span className="text-xs font-medium text-muted-foreground">
                {pattern && `Pattern: ${pattern}`}
                {pattern && sampleId && " · "}
                {sampleId}
              </span>
            )}
          </div>
          {graphMeta.subtitle && <p className="text-xs text-muted-foreground">{graphMeta.subtitle}</p>}
        </div>
      )}
      <div className="relative">
        <div ref={wrapRef} className="w-full overflow-hidden" style={{ height }}>
          <svg ref={svgRef} className="w-full h-full" />
        </div>
        {showLegend && (
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-lg bg-background/90 backdrop-blur px-2 py-1.5 border border-border/50 shadow-sm">
            {groupsInUse.map((g) => (
              <span key={g} className="flex items-center gap-1.5 text-[10px] font-medium text-foreground/90">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: NODE_GROUPS[g]?.color ?? NODE_GROUPS.default.color }}
                />
                {NODE_GROUPS[g]?.label ?? g}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MlPayloadGraphViewer;
