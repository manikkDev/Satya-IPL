import { useEffect, useState } from "react";
import useScrollReveal from "@/hooks/useScrollReveal";

const nodes = [
  { id: "A", label: "Nexus Holdings", x: 160, y: 40 },
  { id: "B", label: "Meridian Trust", x: 280, y: 140 },
  { id: "C", label: "Albatross LLC", x: 160, y: 240 },
  { id: "D", label: "Pacific Ventures", x: 40, y: 140 },
];

const edges = [
  { from: 0, to: 1, label: "Consulting fee" },
  { from: 1, to: 2, label: "Loan repayment" },
  { from: 2, to: 3, label: "Service invoice" },
  { from: 3, to: 0, label: "Investment return", isReturn: true },
];

const CircularFlowDiagram = () => {
  const { ref, isVisible } = useScrollReveal(0.3);
  const [activeEdge, setActiveEdge] = useState(0);
  const [loopDetected, setLoopDetected] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setActiveEdge((prev) => {
        const next = (prev + 1) % 5;
        if (next === 4) {
          setLoopDetected(true);
          setTimeout(() => setLoopDetected(false), 1500);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isVisible]);

  return (
    <div ref={ref}>
      <svg viewBox="0 0 320 300" className="w-full" style={{ maxHeight: 300 }}>
        {/* Edges */}
        {edges.map((edge, i) => {
          const from = nodes[edge.from];
          const to = nodes[edge.to];
          const isRed = edge.isReturn;
          const isActive = activeEdge === i;
          return (
            <g key={i}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={isRed ? "var(--destructive)" : "var(--muted-foreground)"}
                strokeWidth={isActive ? 2 : 1}
                strokeDasharray={isRed ? "6 3" : undefined}
                strokeOpacity={isRed ? 1 : 0.35}
              />
              {/* Edge label */}
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 6}
                fill="var(--muted-foreground)"
                fontSize="8"
                textAnchor="middle"
                fontFamily="'IBM Plex Mono', monospace"
              >
                {edge.label}
              </text>
              {/* Traveling dot */}
              {isActive && isVisible && (
                <circle r="4" fill="var(--primary)">
                  <animate
                    attributeName="cx"
                    from={from.x}
                    to={to.x}
                    dur="0.8s"
                    repeatCount="1"
                    fill="freeze"
                  />
                  <animate
                    attributeName="cy"
                    from={from.y}
                    to={to.y}
                    dur="0.8s"
                    repeatCount="1"
                    fill="freeze"
                  />
                </circle>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r="18" fill="var(--card)" stroke="var(--border)" strokeWidth="1" />
            <text
              x={node.x}
              y={node.y + 1}
              fill="var(--foreground)"
              fontSize="11"
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="'IBM Plex Mono', monospace"
              fontWeight="600"
            >
              {node.id}
            </text>
            <text
              x={node.x}
              y={node.y + 34}
              fill="var(--muted-foreground)"
              fontSize="8"
              textAnchor="middle"
              fontFamily="'DM Sans', sans-serif"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>

      {/* Loop detected badge */}
      <div
        className="mt-2 text-center transition-all duration-300"
        style={{
          opacity: loopDetected ? 1 : 0,
          transform: loopDetected ? "scale(1)" : "scale(0.9)",
        }}
      >
        <span className="pill-badge-red">CIRCULAR FLOW DETECTED</span>
      </div>
    </div>
  );
};

export default CircularFlowDiagram;
