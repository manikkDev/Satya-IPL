"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";

const DEFAULT_THEME = {
  background: "#11181c",
  card: "#151d22",
  border: "#223037",
  muted: "#1a2328",
  mutedFg: "#b9c2c9",
  foreground: "#f8f9fa",
  primary: "#34b27b",
  destructive: "#e54b4f",
  chart1: "#34b27b",
  chart2: "#6aa9ff",
  chart3: "#ff9f6b",
  chart4: "#8c5cff",
  chart5: "#94a3b8",
  fontMono: "IBM Plex Mono, monospace",
  fontSans: "Plus Jakarta Sans, sans-serif",
  fontSerif: "Lora, serif",
};

function readTheme() {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const styles = getComputedStyle(document.documentElement);
  const v = (name, fallback) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--background", DEFAULT_THEME.background),
    card: v("--card", DEFAULT_THEME.card),
    border: v("--border", DEFAULT_THEME.border),
    muted: v("--muted", DEFAULT_THEME.muted),
    mutedFg: v("--muted-foreground", DEFAULT_THEME.mutedFg),
    foreground: v("--foreground", DEFAULT_THEME.foreground),
    primary: v("--primary", DEFAULT_THEME.primary),
    destructive: v("--destructive", DEFAULT_THEME.destructive),
    chart1: v("--chart-1", DEFAULT_THEME.chart1),
    chart2: v("--chart-2", DEFAULT_THEME.chart2),
    chart3: v("--chart-3", DEFAULT_THEME.chart3),
    chart4: v("--chart-4", DEFAULT_THEME.chart4),
    chart5: v("--chart-5", DEFAULT_THEME.chart5),
    fontMono: v("--font-mono", DEFAULT_THEME.fontMono),
    fontSans: v("--font-sans", DEFAULT_THEME.fontSans),
    fontSerif: v("--font-serif", DEFAULT_THEME.fontSerif),
  };
}

export default function NetworkGraph({
  apiUrl = "http://localhost:5002/api/graph",
  useStreaming = false,
  height = 680,
}) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const sceneRef = useRef(null);
  const nodeMap = useRef(new Map());
  const linkMap = useRef(new Map());
  const logRef = useRef(null);

  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [thinkingStatus, setThinkingStatus] = useState(null);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [scanPct, setScanPct] = useState(0);

  const theme = useMemo(() => readTheme(), []);

  const GC = useMemo(
    () => ({
      person: theme.chart2,
      database: theme.chart3,
      service: theme.chart1,
      app: theme.chart4,
      bank: theme.destructive,
      customer: theme.chart1,
      transaction: theme.chart4,
      default: theme.chart5,
    }),
    [theme],
  );

  const PHASE_COLOR = useMemo(
    () => ({
      idle: theme.muted,
      scanning: theme.chart2,
      matching: theme.chart3,
      routing: theme.chart4,
      zooming: theme.chart5,
      complete: theme.primary,
      notfound: theme.destructive,
    }),
    [theme],
  );

  const pushLog = useCallback((t) => setLogs((p) => [...p.slice(-18), t]), []);

  const authHeaders = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // Initial load — fetch-based SSE so the Authorization header can be sent.
  useEffect(() => {
    if (useStreaming) {
      const streamUrl = apiUrl.replace(/\/graph$/, "/graph/stream");
      const controller = new AbortController();
      setLoading(true);
      setError(null);

      (async () => {
        try {
          const res = await fetch(streamUrl, {
            headers: authHeaders(),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let currentEvent = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                const payload = line.slice(6);
                if (currentEvent === "status") {
                  const msg = payload.replace(/^"|"$/g, "");
                  setThinkingStatus(msg);
                  pushLog(`... ${msg}`);
                } else if (currentEvent === "error") {
                  setError(payload.replace(/^"|"$/g, ""));
                } else {
                  try {
                    const data = JSON.parse(payload);
                    if (data && Array.isArray(data.nodes)) {
                      setGraphData(data);
                      setLastUpdate(new Date(data.timestamp).toLocaleTimeString());
                      setLoading(false);
                      setThinkingStatus(null);
                    }
                  } catch {
                    /* keep-alive / partial frame */
                  }
                }
              } else if (!line.trim()) {
                currentEvent = "";
              }
            }
          }
        } catch (err) {
          if (err.name !== "AbortError") {
            setError(err.message);
            setLoading(false);
          }
        }
      })();

      return () => controller.abort();
    } else {
      setLoading(true);
      fetch(apiUrl, { headers: authHeaders() })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          setGraphData(data);
          setLastUpdate(new Date().toLocaleTimeString());
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [apiUrl, useStreaming, pushLog, authHeaders]);

  // D3 initialization
  useEffect(() => {
    const el = svgRef.current;
    const wrap = wrapRef.current;
    const W = wrap.clientWidth || 800;
    const H = typeof height === "number" ? height : 680;

    const svg = d3.select(el).attr("viewBox", `0 0 ${W} ${H}`);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "gsv-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 22)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", theme.border);

    // Grid
    const gridG = svg.append("g");
    for (let x = 0; x < W; x += 42)
      gridG
        .append("line")
        .attr("x1", x)
        .attr("y1", 0)
        .attr("x2", x)
        .attr("y2", H)
        .attr("stroke", theme.muted)
        .attr("stroke-width", 0.5)
        .attr("stroke-opacity", 0.7);
    for (let y = 0; y < H; y += 42)
      gridG
        .append("line")
        .attr("x1", 0)
        .attr("y1", y)
        .attr("x2", W)
        .attr("y2", y)
        .attr("stroke", theme.muted)
        .attr("stroke-width", 0.5)
        .attr("stroke-opacity", 0.7);

    // Corner brackets
    [
      [0, 0, 1, 1],
      [W, 0, -1, 1],
      [0, H, 1, -1],
      [W, H, -1, -1],
    ].forEach(([cx, cy, dx, dy]) => {
      const bLen = 20;
      svg
        .append("path")
        .attr(
          "d",
          `M${cx + dx * bLen},${cy} L${cx},${cy} L${cx},${cy + dy * bLen}`,
        )
        .attr("fill", "none")
        .attr("stroke", theme.border)
        .attr("stroke-width", 1.2)
        .attr("stroke-opacity", 0.8);
    });

    const g = svg.append("g").attr("class", "zoom-layer");
    const zoom = d3
      .zoom()
      .scaleExtent([0.05, 10])
      .on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);

    const linkG = g.append("g").attr("class", "link-layer");
    const nodeG = g.append("g").attr("class", "node-layer");

    sceneRef.current = { svg, g, linkG, nodeG, zoom, W, H, simulation: null };

    return () => {
      if (sceneRef.current?.simulation) sceneRef.current.simulation.stop();
    };
  }, [height, theme]);

  // Render graph data with D3
  useEffect(() => {
    if (!graphData || !sceneRef.current) return;

    const scene = sceneRef.current;
    const { linkG, nodeG, W, H } = scene;

    if (scene.simulation) scene.simulation.stop();

    const nodes = graphData.nodes.map((n) => ({ ...n }));
    const links = graphData.links.map((l) => ({
      source: l.source,
      target: l.target,
      label: l.label,
      strength: l.strength,
    }));

    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    const validLinks = links.filter((l) => byId[l.source] && byId[l.target]);
    if (validLinks.length < links.length) {
      console.warn(`Filtered ${links.length - validLinks.length} invalid links`);
    }

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "links",
        d3
          .forceLink(validLinks)
          .id((d) => d.id)
          .distance(130)
          .strength((d) => d.strength || 0.5),
      )
      .force("charge", d3.forceManyBody().strength(-380))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide().radius((d) => d.size + 18))
      .alphaDecay(0.025);

    scene.simulation = simulation;

    linkG.selectAll("*").remove();
    nodeG.selectAll("*").remove();

    const linkSel = linkG
      .selectAll("g.lgrp")
      .data(validLinks)
      .join("g")
      .attr("class", "lgrp");

    linkSel
      .append("line")
      .attr("class", "link-line")
      .attr("stroke", theme.border)
      .attr("stroke-opacity", 0.85)
      .attr("stroke-width", (d) => Math.max(0.8, (d.strength || 0.5) * 2.4))
      .attr("marker-end", "url(#gsv-arrow)");

    linkSel
      .append("text")
      .attr("class", "link-lbl")
      .attr("text-anchor", "middle")
      .attr("font-size", "8px")
      .attr("font-family", theme.fontMono)
      .attr("fill", theme.mutedFg)
      .attr("pointer-events", "none")
      .text((d) => d.label);

    linkMap.current.clear();
    linkSel.each(function (d) {
      const s = d.source?.id ?? d.source;
      const t = d.target?.id ?? d.target;
      linkMap.current.set(`${s}-${t}`, d3.select(this));
    });

    const nodeSel = nodeG
      .selectAll("g.ngrp")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "ngrp")
      .style("cursor", "pointer")
      .call(
        d3
          .drag()
          .on("start", (e, d) => {
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (e, d) => {
            d.fx = e.x;
            d.fy = e.y;
          })
          .on("end", (e, d) => {
            if (!e.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    nodeSel
      .append("circle")
      .attr("class", "n-halo")
      .attr("r", (d) => d.size + 9)
      .attr("fill", (d) => GC[d.group] || GC.default)
      .attr("fill-opacity", 0.09)
      .attr("stroke", (d) => GC[d.group] || GC.default)
      .attr("stroke-opacity", 0.2)
      .attr("stroke-width", 0.8);

    nodeSel
      .append("circle")
      .attr("class", "n-body")
      .attr("r", (d) => d.size)
      .attr("fill", (d) => GC[d.group] || GC.default)
      .attr("fill-opacity", 0.92)
      .attr("stroke", theme.background)
      .attr("stroke-width", 2);

    nodeSel
      .append("text")
      .attr("class", "n-lbl")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.size + 14)
      .attr("font-size", "10px")
      .attr("font-family", theme.fontMono)
      .attr("fill", theme.foreground)
      .attr("pointer-events", "none")
      .text((d) => d.label);

    nodeMap.current.clear();
    nodeSel.each(function (d) {
      nodeMap.current.set(d.id, d3.select(this));
    });

    simulation.on("tick", () => {
      linkSel
        .select(".link-line")
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      linkSel
        .select(".link-lbl")
        .attr("x", (d) => (d.source.x + d.target.x) / 2)
        .attr("y", (d) => (d.source.y + d.target.y) / 2 - 5);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(1).restart();
    setPhase("idle");
    setScanPct(0);
  }, [graphData, GC, theme]);

  const performSearch = useCallback(
    async (term) => {
      const base = apiUrl.replace(/\/graph\/?$/, "");
      const searchUrl = `${base}/graph/search`;

      if (!term.trim()) {
        setLoading(true);
        try {
          const res = await fetch(apiUrl, { headers: authHeaders() });
          const data = await res.json();
          setGraphData(data);
          setLastUpdate(new Date().toLocaleTimeString());
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
        return;
      }

      setPhase("scanning");
      setScanPct(0);
      pushLog(`neo4j> MATCH (n) WHERE toLower(n.name) CONTAINS '${term}'`);

      try {
        const res = await fetch(searchUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ term }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        setScanPct(75);
        await new Promise((r) => setTimeout(r, 200));

        setGraphData(data);
        setScanPct(100);
        setPhase("complete");
        pushLog(`> ${data.nodes.length} nodes | ${data.links.length} links`);
      } catch (err) {
        setError(`Search failed: ${err.message}`);
        setPhase("notfound");
        pushLog(`> ERROR: ${err.message}`);
      }
    },
    [apiUrl, pushLog, authHeaders],
  );

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => performSearch(query), 500);
    return () => clearTimeout(id);
  }, [query, performSearch]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const pc = PHASE_COLOR[phase] || theme.muted;

  return (
    <div
      style={{
        background: theme.card,
        borderRadius: 16,
        overflow: "hidden",
        fontFamily: theme.fontMono,
        boxShadow: "0 20px 64px rgba(0,0,0,0.35)",
        border: `1px solid ${theme.border}`,
      }}
    >
      <div
        style={{
          padding: "12px 18px",
          borderBottom: `1px solid ${theme.border}`,
          background: `color-mix(in srgb, ${theme.card} 70%, transparent)`,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: theme.border,
                opacity: 0.6,
              }}
            />
          ))}
        </div>

        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <span
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: pc,
              fontSize: 14,
              pointerEvents: "none",
              transition: "color 0.3s",
            }}
          >
            /
          </span>
          <input
            type="text"
            placeholder="search graph nodes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              background: theme.muted,
              border: `1px solid ${query ? pc + "80" : theme.border}`,
              borderRadius: 8,
              color: theme.foreground,
              fontSize: 12,
              padding: "8px 30px 8px 28px",
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.2s",
              fontFamily: theme.fontMono,
              letterSpacing: "0.3px",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: theme.mutedFg,
                cursor: "pointer",
                fontSize: 16,
                padding: 0,
              }}
              aria-label="Clear search"
            >
              x
            </button>
          )}
        </div>

        <div style={{ flex: 1, maxWidth: 150 }}>
          <div
            style={{
              height: 3,
              background: theme.border,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${scanPct}%`,
                background: pc,
                transition: "width 0.15s, background 0.3s",
                borderRadius: 2,
              }}
            />
          </div>
          <div style={{ fontSize: 9, color: theme.mutedFg, marginTop: 3 }}>
            {scanPct}% indexed
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {useStreaming && (
            <span
              style={{
                fontSize: 10,
                color: theme.primary,
                letterSpacing: "0.08em",
              }}
            >
              LIVE {lastUpdate ? `(${lastUpdate})` : ""}
            </span>
          )}
          <div
            style={{
              fontSize: 9,
              padding: "4px 12px",
              borderRadius: 999,
              border: `1px solid ${pc}55`,
              color: pc,
              background: `color-mix(in srgb, ${pc} 16%, transparent)`,
              letterSpacing: "0.12em",
              transition: "all 0.3s",
              minWidth: 90,
              textAlign: "center",
            }}
          >
            {phase.toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", flexShrink: 0, gap: 10 }}>
          {Object.entries(GC)
            .filter(([k]) => k !== "default")
            .map(([g, c]) => (
              <span
                key={g}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 9,
                  color: theme.mutedFg,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: c,
                    display: "inline-block",
                  }}
                />
                {g}
              </span>
            ))}
        </div>
      </div>

      <div style={{ display: "flex", height }}>
        <div
          ref={wrapRef}
          style={{ flex: 1, position: "relative", overflow: "hidden" }}
        >
          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: theme.foreground,
                fontSize: 14,
                background: theme.background,
                zIndex: 10,
              }}
            >
              {thinkingStatus ? `... ${thinkingStatus}` : "Loading graph..."}
            </div>
          )}
          {error && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: theme.destructive,
                fontSize: 14,
                background: theme.background,
                zIndex: 10,
              }}
            >
              Warning: {error}
            </div>
          )}
          <svg
            ref={svgRef}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
          {phase === "idle" && !query && !loading && (
            <div
              style={{
                position: "absolute",
                bottom: 14,
                left: 14,
                fontSize: 9,
                color: theme.mutedFg,
                lineHeight: 1.9,
                pointerEvents: "none",
              }}
            >
              scroll to zoom | drag to pan | drag node to pin
            </div>
          )}
        </div>

        <div
          style={{
            width: 240,
            borderLeft: `1px solid ${theme.border}`,
            display: "flex",
            flexDirection: "column",
            background: `color-mix(in srgb, ${theme.card} 82%, transparent)`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: "6px 12px",
              borderBottom: `1px solid ${theme.border}`,
              fontSize: 9,
              color: theme.mutedFg,
              letterSpacing: "0.12em",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>CYPHER LOG</span>
            {logs.length > 0 && (
              <button
                onClick={() => setLogs([])}
                style={{
                  background: "none",
                  border: "none",
                  color: theme.mutedFg,
                  cursor: "pointer",
                  fontSize: 10,
                  padding: 0,
                }}
              >
                clr
              </button>
            )}
          </div>

          <div
            ref={logRef}
            style={{
              flex: 1,
              overflow: "auto",
              padding: "10px 12px",
              fontSize: "10px",
              lineHeight: 2,
              scrollbarWidth: "thin",
              scrollbarColor: `${theme.border} transparent`,
            }}
          >
            {logs.length === 0 && (
              <div style={{ color: theme.mutedFg, fontSize: 9, marginTop: 4 }}>
                // type to begin search...
              </div>
            )}
            {logs.map((l, i) => (
              <div
                key={i}
                style={{
                  color: l.startsWith("neo4j>")
                    ? theme.chart2
                    : l.startsWith(">")
                      ? theme.primary
                      : theme.mutedFg,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {l}
              </div>
            ))}
            {phase !== "idle" &&
              phase !== "complete" &&
              phase !== "notfound" && (
                <span
                  style={{
                    color: theme.primary,
                    display: "inline-block",
                    animation: "gsvcaret 1s step-start infinite",
                  }}
                >
                  |
                </span>
              )}
          </div>

          <div
            style={{
              padding: "10px 12px",
              borderTop: `1px solid ${theme.border}`,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {["alice", "api", "db", "mobile", "cache"].map((q) => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                style={{
                  fontSize: 9,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background:
                    query === q
                      ? `color-mix(in srgb, ${theme.chart3} 18%, transparent)`
                      : theme.muted,
                  border: `1px solid ${
                    query === q ? theme.chart3 : theme.border
                  }`,
                  color: query === q ? theme.chart3 : theme.mutedFg,
                  cursor: "pointer",
                  fontFamily: theme.fontMono,
                  transition: "all 0.15s",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes gsvcaret { 0%,100%{opacity:1} 50%{opacity:0} }
        input::placeholder { color: ${theme.mutedFg} !important; }
      `}</style>
    </div>
  );
}
