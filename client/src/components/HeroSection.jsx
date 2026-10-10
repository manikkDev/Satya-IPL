// "use client";
import { useEffect, useRef, useState } from "react";

const STATS = [
  { value: "5.7M+", label: "Federated Transactions" },
  { value: "5", label: "Institutions" },
  { value: "0", label: "Raw Rows Shared" },
];

// ══════════════════════════════════════════════════════════════════
//  NetworkOrb — pure-canvas 3-D perspective network globe
// ══════════════════════════════════════════════════════════════════
const NetworkOrb = () => {
  const cvs = useRef(null);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0,
      H = 0;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    /* ── 3-D math ─────────────────────────────────────────────── */
    const ry = (x, y, z, a) => ({
      x: x * Math.cos(a) + z * Math.sin(a),
      y,
      z: -x * Math.sin(a) + z * Math.cos(a),
    });
    const rx = (x, y, z, a) => ({
      x,
      y: y * Math.cos(a) - z * Math.sin(a),
      z: y * Math.sin(a) + z * Math.cos(a),
    });
    const prj = (x, y, z) => {
      const R = Math.min(W, H) * 0.3;
      const s = 440 / (440 + z + R * 0.55);
      return { sx: W / 2 + x * s, sy: H / 2 + y * s + 12, scale: s, z };
    };
    const R = () => Math.min(W, H) * 0.3;

    /* ── build scene ──────────────────────────────────────────── */
    const buildScene = () => {
      const r = R() || 130;
      const nds = [];

      // 13 background nodes on sphere (golden-angle distribution)
      for (let i = 0; i < 13; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / 13);
        const th = Math.PI * (1 + Math.sqrt(5)) * i;
        nds.push({
          ox: r * Math.sin(phi) * Math.cos(th),
          oy: r * Math.sin(phi) * Math.sin(th) * 0.72,
          oz: r * Math.cos(phi),
          flagged: false,
          r: 2.6 + Math.random() * 2.2,
          ph: Math.random() * 6.28,
          id: null,
          score: null,
        });
      }

      // 3 suspicious nodes with strong forward Z for visibility
      [
        { ox: r * 0.44, oy: -r * 0.54, oz: r * 0.64, id: "NH", score: 94 },
        { ox: r * 0.83, oy: r * 0.24, oz: r * 0.33, id: "MT", score: 81 },
        { ox: r * 0.14, oy: r * 0.73, oz: r * 0.5, id: "AL", score: 76 },
      ].forEach((s) =>
        nds.push({ ...s, flagged: true, r: 7, ph: Math.random() * 6.28 }),
      );

      // edges: connect close normal nodes + suspicious loop
      const eds = [];
      for (let i = 0; i < 13; i++)
        for (let j = i + 1; j < 13; j++) {
          const d = Math.hypot(
            nds[i].ox - nds[j].ox,
            nds[i].oy - nds[j].oy,
            nds[i].oz - nds[j].oz,
          );
          if (d < r * 0.9) eds.push({ a: i, b: j, sus: false });
        }
      const S0 = eds.length;
      eds.push(
        { a: 13, b: 14, sus: true },
        { a: 14, b: 15, sus: true },
        { a: 15, b: 13, sus: true },
      );
      return { nds, eds, S0 };
    };

    let { nds: nodes, eds: edges, S0: SUSP0 } = buildScene();

    // money flow particles on the suspicious loop
    const ptcls = [
      { ei: SUSP0, t: 0.0, sp: 0.0048 },
      { ei: SUSP0 + 1, t: 0.35, sp: 0.0053 },
      { ei: SUSP0 + 2, t: 0.7, sp: 0.0044 },
      { ei: SUSP0, t: 0.6, sp: 0.0039 },
      { ei: SUSP0 + 1, t: 0.15, sp: 0.0051 },
    ];

    let angle = 0,
      frame = 0,
      scanRing = 0,
      scanActive = false;
    // ambient data-stream lines (atmospheric)
    const streams = Array.from({ length: 6 }, (_, i) => ({
      y: (i / 6) * 0.9 + 0.05,
      sp: 0.0018 + Math.random() * 0.0012,
      x: Math.random(),
      al: 0.07 + Math.random() * 0.09,
    }));
    const TILT = 0.23;

    /* ── wireframe sphere ─────────────────────────────────────── */
    const drawSphere = () => {
      const r = R();
      if (!r) return;
      // Thicker and darker grid lines
      ctx.lineWidth = 0.8;
      const drawPath = (fn) => {
        ctx.beginPath();
        for (let i = 0; i <= 38; i++) {
          let p = fn(i / 38);
          let t = ry(p.x, p.y, p.z, angle);
          t = rx(t.x, t.y, t.z, TILT);
          const { sx, sy } = prj(t.x, t.y, t.z);
          i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = "rgba(0,232,122,0.2)"; // darker
        ctx.stroke();
      };

      // Latitude lines (parallels) – already full circles
      for (let lat = -60; lat <= 60; lat += 20) {
        const y0 = r * Math.sin((lat * Math.PI) / 180);
        const lr = Math.sqrt(Math.max(0, r * r - y0 * y0));
        drawPath((t) => ({
          x: lr * Math.cos(t * 6.28),
          y: y0,
          z: lr * Math.sin(t * 6.28),
        }));
      }

      // Longitude lines (meridians) – now full 360°
      for (let lon = 0; lon < 360; lon += 20) {
        const a0 = (lon * Math.PI) / 180;
        drawPath((t) => {
          const phi = t * Math.PI - Math.PI / 2; // from -90° to +90°
          return {
            x: r * Math.cos(phi) * Math.cos(a0),
            y: r * Math.sin(phi),
            z: r * Math.cos(phi) * Math.sin(a0),
          };
        });
      }
    };

    /* ── sonar scan rings ─────────────────────────────────────── */
    const drawScan = (pr) => {
      if (!scanActive) return;
      const sus = pr.slice(13);
      const cx = sus.reduce((s, n) => s + n.sx, 0) / sus.length;
      const cy = sus.reduce((s, n) => s + n.sy, 0) / sus.length;
      const maxR = R() * 0.85;
      [1, 0.62, 0.34].forEach((mult, i) => {
        const t = Math.max(0, scanRing - i * 0.13);
        if (t <= 0) return;
        const ringR = t * maxR * mult;
        const alpha = (1 - t) * (0.38 - i * 0.1);
        if (alpha <= 0) return;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, 6.28);
        ctx.strokeStyle = `rgba(239,68,68,${alpha})`;
        ctx.lineWidth = i === 0 ? 1.5 : 0.8;
        ctx.stroke();
      });
      if (scanRing < 0.28) {
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, 6.28);
        ctx.fillStyle = `rgba(239,68,68,${(1 - scanRing / 0.28) * 0.45})`;
        ctx.fill();
      }
    };

    /* ── HUD corners + readouts ───────────────────────────────── */
    const drawHUD = () => {
      const pad = 12;
      // corner L-brackets
      ctx.strokeStyle = "rgba(0,232,122,.23)";
      ctx.lineWidth = 1.1;
      [
        [pad, pad, 1, 1],
        [W - pad, pad, -1, 1],
        [pad, H - pad, 1, -1],
        [W - pad, H - pad, -1, -1],
      ].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * 16, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * 16);
        ctx.stroke();
      });

      // top-left info
      ctx.font = "500 8px 'IBM Plex Mono',monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,232,122,.42)";
      ctx.fillText("NET ANALYSIS v2.4", pad + 3, pad + 20);
      ctx.fillStyle = "rgba(0,232,122,.22)";
      ctx.fillText(
        `NODES: ${nodes.length}  EDGES: ${edges.length}`,
        pad + 3,
        pad + 32,
      );
      ctx.fillText(
        `FRAME: ${String(frame % 1000).padStart(4, "0")}`,
        pad + 3,
        pad + 44,
      );

      // top-right alert
      ctx.textAlign = "right";
      ctx.font = "700 8px 'IBM Plex Mono',monospace";
      ctx.fillStyle = "rgba(239,68,68,.72)";
      ctx.fillText("⚠ LOOP DETECTED", W - pad - 3, pad + 20);
      ctx.font = "500 8px 'IBM Plex Mono',monospace";
      ctx.fillStyle = "rgba(239,68,68,.42)";
      ctx.fillText("$6.8M · 3 HOPS", W - pad - 3, pad + 32);
      ctx.fillText("LAYERING PATTERN", W - pad - 3, pad + 44);

      // bottom loop chain
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,232,122,.17)";
      ctx.font = "400 8px 'IBM Plex Mono',monospace";
      ctx.fillText("NH  →  MT  →  AL  →  NH", W / 2, H - pad - 3);

      // scan progress bar
      const bw = 70,
        bX = W / 2 - 35,
        bY = H - pad - 15;
      ctx.fillStyle = "rgba(0,232,122,.08)";
      ctx.fillRect(bX, bY, bw, 2);
      ctx.fillStyle = "rgba(239,68,68,.48)";
      ctx.fillRect(bX, bY, bw * ((frame % 160) / 160), 2);
    };

    /* ── main render loop ─────────────────────────────────────── */
    let raf;
    const draw = () => {
      frame++;
      angle += 0.0042;
      ctx.clearRect(0, 0, W, H);

      // trigger scan ring every 160 frames
      if (frame % 160 === 0) {
        scanActive = true;
        scanRing = 0.01;
      }
      if (scanActive) {
        scanRing += 0.013;
        if (scanRing >= 1.05) {
          scanActive = false;
          scanRing = 0;
        }
      }

      ptcls.forEach((p) => {
        p.t = (p.t + p.sp) % 1;
      });

      // ambient streams
      streams.forEach((s) => {
        s.x = (s.x + s.sp) % 1.3;
        const x = s.x * W,
          y = s.y * H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 26, y + 11);
        ctx.strokeStyle = `rgba(0,232,122,${s.al})`;
        ctx.lineWidth = 0.45;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, 6.28);
        ctx.fillStyle = `rgba(0,232,122,${s.al * 1.8})`;
        ctx.fill();
      });

      drawSphere();

      // project all nodes
      const pr = nodes.map((n) => {
        let p = ry(n.ox, n.oy, n.oz, angle);
        p = rx(p.x, p.y, p.z, TILT);
        return { ...n, ...prj(p.x, p.y, p.z) };
      });

      // draw edges
      edges.forEach((e) => {
        const a = pr[e.a],
          b = pr[e.b];
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        if (e.sus) {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = "rgba(239,68,68,.6)";
          ctx.lineWidth = 1.5;
        } else {
          ctx.setLineDash([]);
          const az = (a.z + b.z) / 2,
            r = R();
          // Increased opacity for better visibility (range 0.1 to 0.5)
          const alpha = Math.max(0.1, ((az + r) / (2 * r)) * 0.4 + 0.1);
          ctx.strokeStyle = `rgba(0,232,122,${alpha})`;
          ctx.lineWidth = 0.6;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      });

      drawScan(pr);

      // money particles
      ptcls.forEach((p) => {
        const e = edges[p.ei],
          a = pr[e.a],
          b = pr[e.b];
        const px = a.sx + (b.sx - a.sx) * p.t,
          py = a.sy + (b.sy - a.sy) * p.t;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, 6.28);
        ctx.fillStyle = "rgba(239,68,68,.08)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, 6.28);
        ctx.fillStyle = "rgba(239,68,68,.92)";
        ctx.fill();
        // specular highlight
        ctx.beginPath();
        ctx.arc(px - 0.6, py - 0.6, 1, 0, 6.28);
        ctx.fillStyle = "rgba(255,160,155,.55)";
        ctx.fill();
      });

      // nodes — painter's algorithm (back → front)
      [...pr]
        .sort((a, b) => a.z - b.z)
        .forEach((n) => {
          const pulse = Math.sin(frame * 0.028 + n.ph);
          const sz = n.r * Math.max(0.6, n.scale) * 1.55;

          if (n.flagged) {
            // outer sonar ring
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz + 10 + pulse * 5, 0, 6.28);
            ctx.strokeStyle = `rgba(239,68,68,${0.1 + pulse * 0.04})`;
            ctx.lineWidth = 1;
            ctx.stroke();
            // mid ring
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz + 3, 0, 6.28);
            ctx.strokeStyle = "rgba(239,68,68,.18)";
            ctx.lineWidth = 0.6;
            ctx.stroke();
            // filled node
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz, 0, 6.28);
            ctx.fillStyle = "rgba(239,68,68,.24)";
            ctx.fill();
            ctx.strokeStyle = "rgba(239,68,68,.82)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // bright inner core
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz * 0.4, 0, 6.28);
            ctx.fillStyle = `rgba(239,68,68,${0.34 + pulse * 0.1})`;
            ctx.fill();
            // ID label
            if (n.scale > 0.62) {
              ctx.font = "700 8px 'IBM Plex Mono',monospace";
              ctx.textAlign = "center";
              ctx.fillStyle = "rgba(255,200,200,.98)";
              ctx.fillText(n.id, n.sx, n.sy + 1.5);
            }
            // risk score badge
            if (n.score && n.scale > 0.72) {
              const bw = 28,
                bh = 13,
                bx = n.sx - 14,
                by = n.sy + sz + 5;
              ctx.fillStyle = "rgba(239,68,68,.15)";
              ctx.fillRect(bx, by, bw, bh);
              ctx.strokeStyle = "rgba(239,68,68,.3)";
              ctx.lineWidth = 0.6;
              ctx.strokeRect(bx, by, bw, bh);
              ctx.font = "700 8px 'IBM Plex Mono',monospace";
              ctx.fillStyle = "#ef4444";
              ctx.textAlign = "center";
              ctx.fillText(`${n.score}`, n.sx, by + 9.5);
            }
          } else {
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz, 0, 6.28);
            ctx.fillStyle = `rgba(0,232,122,${0.04 + n.scale * 0.06})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(0,232,122,${0.12 + pulse * 0.06 + n.scale * 0.05})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        });

      drawHUD();
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={cvs}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
};

// ══════════════════════════════════════════════════════════════════
//  HeroSection — two-column layout: text left, 3-D orb right
// ══════════════════════════════════════════════════════════════════
const HeroSection = () => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 120);
    return () => clearTimeout(t);
  }, []);

  /* ── background particle canvas (same logic, slightly dimmer) ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const primary = "0,232,122",
      danger = "239,68,68";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const W = () => canvas.offsetWidth,
      H = () => canvas.offsetHeight;

    const nodes = Array.from({ length: 22 }, (_, i) => ({
      x: Math.random() * W(),
      y: Math.random() * H(),
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      r: Math.random() * 2.2 + 1.4,
      flagged: i < 3,
      phase: Math.random() * Math.PI * 2,
    }));
    nodes[0] = {
      ...nodes[0],
      x: W() * 0.5,
      y: H() * 0.44,
      r: 5,
      flagged: true,
    };
    nodes[1] = {
      ...nodes[1],
      x: W() * 0.43,
      y: H() * 0.56,
      r: 4.2,
      flagged: true,
      vx: -0.09,
      vy: 0.07,
    };
    nodes[2] = {
      ...nodes[2],
      x: W() * 0.57,
      y: H() * 0.56,
      r: 4.2,
      flagged: true,
      vx: 0.07,
      vy: -0.11,
    };
    const loop = [nodes[0], nodes[1], nodes[2]];
    const cpts = [
      { t: 0, sp: 0.0042 },
      { t: 0.33, sp: 0.0055 },
      { t: 0.67, sp: 0.0036 },
    ];
    const lerp = (a, b, t) => a + (b - a) * t;
    const getCP = (t) => {
      const s = Math.floor(t * 3) % 3,
        st = (t * 3) % 1,
        f = loop[s],
        to = loop[(s + 1) % 3];
      return { x: lerp(f.x, to.x, st), y: lerp(f.y, to.y, st) };
    };

    let frame = 0;
    const draw = () => {
      frame++;
      const w = W(),
        h = H();
      ctx.clearRect(0, 0, w, h);
      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 16 || n.x > w - 16) n.vx *= -1;
        if (n.y < 16 || n.y > h - 16) n.vy *= -1;
      });
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(
            nodes[i].x - nodes[j].x,
            nodes[i].y - nodes[j].y,
          );
          if (d > 155) continue;
          const alpha = (1 - d / 155) * 0.09,
            sus = nodes[i].flagged && nodes[j].flagged;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.setLineDash(sus ? [5, 4] : []);
          ctx.strokeStyle = sus
            ? `rgba(${danger},${alpha * 4})`
            : `rgba(${primary},${alpha})`;
          ctx.lineWidth = sus ? 1.3 : 0.65;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      cpts.forEach((p) => {
        p.t = (p.t + p.sp) % 1;
        const pt = getCP(p.t);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.4, 0, 6.28);
        ctx.fillStyle = `rgba(${danger},.88)`;
        ctx.fill();
      });
      nodes.forEach((n) => {
        const pulse = Math.sin(frame * 0.022 + n.phase);
        if (n.flagged) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 8 + pulse * 4, 0, 6.28);
          ctx.strokeStyle = `rgba(${danger},${0.08 + pulse * 0.03})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, 6.28);
          ctx.fillStyle = `rgba(${danger},.18)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${danger},.7)`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, 6.28);
          ctx.fillStyle = `rgba(${primary},.05)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${primary},${0.18 + pulse * 0.05})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      });
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const stagger = (i) => ({
    opacity: loaded ? 1 : 0,
    transform: loaded ? "translateY(0)" : "translateY(24px)",
    transition: `opacity .62s ease ${i * 95}ms, transform .62s ease ${i * 95}ms`,
  });

  return (
    <>
      <style>{`
        @keyframes hero-blink { 0%,100%{opacity:1} 50%{opacity:.18} }
        @keyframes orb-glow   { 0%,100%{box-shadow:0 0 32px rgba(0,232,122,.07),0 28px 80px rgba(0,0,0,.45)} 50%{box-shadow:0 0 60px rgba(0,232,122,.15),0 28px 80px rgba(0,0,0,.45)} }
        .hero-grid { display:grid; grid-template-columns:1fr; gap:32px; align-items:center; width:100%; max-width:1180px; margin:0 auto; padding:86px 28px 40px; position:relative; z-index:10; }
        @media(min-width:900px){ .hero-grid{ grid-template-columns:1fr 1fr; gap:52px; } .hero-text{ text-align:left!important; } .hero-row{ justify-content:flex-start!important; } }
        .orb-wrap { animation: orb-glow 4s ease infinite; }
        .sec-btn:hover { border-color:rgba(var(--primary-rgb),.5)!important; color:var(--foreground)!important; }
      `}</style>

      <section
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        {/* video */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          style={{ zIndex: 0, opacity: 0.2 }}
        >
          <source src="/bg-video-graphP.webm" type="video/webm" />
        </video>

        {/* particle bg canvas */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0.36,
            zIndex: 1,
          }}
        />

        {/* overlays */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            pointerEvents: "none",
            backgroundImage:
              "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.022) 2px,rgba(0,0,0,.022) 4px)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse 900px 600px at 50% 46%,rgba(var(--primary-rgb),.055) 0%,transparent 65%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-background/45"
          style={{ zIndex: 2 }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "0 0 auto",
            height: 110,
            background:
              "linear-gradient(to bottom,var(--background),transparent)",
            zIndex: 3,
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "auto 0 0",
            height: 110,
            background: "linear-gradient(to top,var(--background),transparent)",
            zIndex: 3,
          }}
        />

        {/* ── grid ──────────────────────────────────────────── */}
        <div className="hero-grid">
          {/* LEFT: text */}
          <div className="hero-text" style={{ textAlign: "center" }}>
            <h1
              style={{
                ...stagger(1),
                fontFamily:
                  "var(--font-serif,'Playfair Display',Georgia,serif)",
                fontSize: "clamp(36px,5vw,64px)",
                lineHeight: 1.06,
                letterSpacing: "-.022em",
                color: "var(--foreground)",
                marginBottom: 20,
              }}
            >
              Sharper risk models.
              <br />
              <em
                style={{
                  fontStyle: "italic",
                  color: "var(--primary)",
                  fontWeight: 400,
                }}
              >
                Verifiable privacy
              </em>
              <span style={{ fontWeight: 900 }}> by design.</span>
            </h1>

            <p
              style={{
                ...stagger(2),
                fontSize: 16,
                lineHeight: 1.76,
                color: "var(--muted-foreground)",
                maxWidth: 460,
                margin: "0 auto 32px",
              }}
            >
              Arth Saathi is a research prototype for collaborative fraud and credit-risk modelling. It demonstrates federated strategies, measured differential-privacy trade-offs, pseudonymised graph intelligence and citizen controls while production-grade institution isolation and secure aggregation are validated.
            </p>

            <div
              className="hero-row"
              style={{
                ...stagger(3),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                marginBottom: 42,
              }}
            >
              <a
                href="/signup"
                className="btn-primary btn-glow animate-glow-pulse"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  padding: "13px 30px",
                  letterSpacing: ".035em",
                }}
              >
                Launch the Demo ↗
              </a>
              <a
                href="#how-it-works"
                className="sec-btn"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "13px 22px",
                  borderRadius: 8,
                  textDecoration: "none",
                  letterSpacing: ".02em",
                  transition: "all .2s ease",
                  border: "1px solid rgba(var(--primary-rgb),.2)",
                  color: "var(--muted-foreground)",
                }}
              >
                How it works
              </a>
              <a
                href="/chat"
                className="sec-btn"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "13px 22px",
                  borderRadius: 8,
                  textDecoration: "none",
                  letterSpacing: ".02em",
                  transition: "all .2s ease",
                  border: "1px solid rgba(var(--primary-rgb),.2)",
                  color: "var(--muted-foreground)",
                }}
              >
                Chat with our AI
              </a>
            </div>

            <div
              className="hero-row"
              style={{
                ...stagger(4),
                display: "flex",
                justifyContent: "center",
                borderTop: "1px solid rgba(var(--primary-rgb),.1)",
                paddingTop: 24,
              }}
            >
              {STATS.map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: "0 22px",
                    textAlign: "center",
                    borderRight:
                      i < STATS.length - 1
                        ? "1px solid rgba(var(--primary-rgb),.08)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily:
                        "var(--font-serif,'Playfair Display',Georgia,serif)",
                      fontSize: 23,
                      fontWeight: 700,
                      lineHeight: 1.1,
                      color: "var(--primary)",
                      letterSpacing: "-.02em",
                    }}
                  >
                    {s.value}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono',monospace",
                      fontSize: 9,
                      letterSpacing: ".1em",
                      color: "var(--muted-foreground)",
                      marginTop: 4,
                      textTransform: "uppercase",
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: 3D orb */}
          <div style={{ ...stagger(1), width: "100%", minHeight: 0 }}>
            <div
              className="orb-wrap"
              style={{
                position: "relative",
                height: 500,
                borderRadius: 16,
                overflow: "hidden",
                background: "transparent",
              }}
            >
              {/* corner SVG brackets */}
              {[
                { pos: { top: 10, left: 10 }, d: "M 0 17 L 0 0 L 17 0" },
                { pos: { top: 10, right: 10 }, d: "M 0 0 L 17 0 L 17 17" },
                { pos: { bottom: 10, left: 10 }, d: "M 0 0 L 0 17 L 17 17" },
                { pos: { bottom: 10, right: 10 }, d: "M 17 0 L 17 17 L 0 17" },
              ].map((b, i) => (
                <svg
                  key={i}
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  style={{
                    position: "absolute",
                    pointerEvents: "none",
                    zIndex: 4,
                    ...b.pos,
                  }}
                >
                  <path
                    d={b.d}
                    fill="none"
                    stroke="rgba(0,232,122,.32)"
                    strokeWidth="1.3"
                  />
                </svg>
              ))}

              <NetworkOrb />

              {/* bottom fade */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 48,
                  zIndex: 3,
                  pointerEvents: "none",
                  background:
                    "linear-gradient(to top,rgba(0,0,0,.3),transparent)",
                }}
              />
            </div>

            <p
              style={{
                textAlign: "center",
                marginTop: 9,
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 9,
                color: "var(--muted-foreground)",
                letterSpacing: ".08em",
                opacity: 0.55,
              }}
            >
              RESEARCH NETWORK · 5 SIMULATED INSTITUTIONS · VERIFIED ARTIFACTS
            </p>
          </div>
        </div>

        {/* scroll hint */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 7,
            opacity: loaded ? 0.38 : 0,
            transition: "opacity 1s ease 1.3s",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 9,
              letterSpacing: ".18em",
              color: "var(--muted-foreground)",
            }}
          >
            SCROLL
          </span>
          <div
            style={{
              width: 1,
              height: 28,
              background:
                "linear-gradient(to bottom,var(--muted-foreground),transparent)",
            }}
          />
        </div>
      </section>
    </>
  );
};

export default HeroSection;
