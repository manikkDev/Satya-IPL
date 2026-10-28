const startedAt = Date.now();

const uptime = () => {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
};

const ENDPOINT_GROUPS = [
  {
    name: "Question answering",
    detail: "Grounded answers over authorized company records",
    routes: [
      ["POST", "/api/chat", "Ask a question; returns a structured answer"],
      ["POST", "/api/chat/stream", "Same, streamed as SSE status + answer events"],
    ],
  },
  {
    name: "Conversations",
    detail: "Per-user history stored on the business API",
    routes: [
      ["GET", "/api/conversations", "List past conversations"],
      ["GET", "/api/conversations/:id", "Fetch one conversation with messages"],
    ],
  },
  {
    name: "Platform",
    detail: "Operations",
    routes: [
      ["GET", "/health", "Liveness and capability report"],
    ],
  },
];

const badge = (method) => {
  const colors = { GET: "#0f766e", POST: "#1d4ed8", WS: "#7c3aed" };
  return `<span class="method" style="background:${colors[method] || "#475569"}">${method}</span>`;
};

export const statusPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Satya Copilot API</title>
<style>
  :root{--primary:#087f74;--primary-dark:#065f56;--ink:#182638;--muted:#526477;--border:#dce3eb;--card:#ffffff;--bg:#f4f7f9}
  *{box-sizing:border-box;margin:0}
  body{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;padding:32px 20px 48px}
  .wrap{max-width:920px;margin:0 auto}
  .top{display:flex;align-items:center;gap:16px;margin-bottom:28px}
  .mark{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-size:27px;font-weight:800;box-shadow:0 6px 18px rgba(8,127,116,.28)}
  .top h1{font-size:26px;font-weight:750;letter-spacing:-.02em}
  .top p{color:var(--muted);font-size:15px}
  .pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--muted)}
  .pill.live{color:#047857;border-color:#a7f3d0;background:#ecfdf5}
  .pill.live::before{content:"";width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.2)}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 26px;margin-bottom:20px;box-shadow:0 1px 3px rgba(24,38,56,.05)}
  .status{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-top:18px}
  .metric{border:1px solid var(--border);border-radius:10px;padding:12px 15px}
  .metric span{display:block;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .metric strong{font-size:15px;font-weight:650}
  h2{font-size:15px;font-weight:700;margin-bottom:4px}
  .group-detail{font-size:13px;color:var(--muted);margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  td{padding:9px 10px;border-top:1px solid var(--border);vertical-align:top}
  tr:first-child td{border-top:0}
  .method{display:inline-block;min-width:46px;text-align:center;color:#fff;font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px;font-family:ui-monospace,monospace}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--primary-dark)}
  .desc{color:var(--muted)}
  .flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:14px}
  .step{border:1px solid var(--border);border-radius:10px;padding:13px 15px}
  .step b{display:block;font-size:13.5px;margin-bottom:3px}
  .step span{font-size:12.5px;color:var(--muted)}
  .links{display:flex;flex-wrap:wrap;gap:12px}
  .link{flex:1;min-width:190px;display:block;border:1px solid var(--border);border-radius:12px;padding:15px 18px;text-decoration:none;color:var(--ink);background:var(--card);transition:border-color .15s,transform .15s}
  .link:hover{border-color:var(--primary);transform:translateY(-1px)}
  .link strong{display:block;font-size:14.5px;margin-bottom:3px}
  .link span{font-size:12.5px;color:var(--muted)}
  .foot{margin-top:26px;font-size:12.5px;color:var(--muted);text-align:center}
  .foot code{color:var(--muted)}
  @media(max-width:560px){.top h1{font-size:21px}td{padding:8px 6px}.card{padding:18px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="mark">S</div>
    <div>
      <h1>Satya Copilot API</h1>
      <p>Source-backed question answering over company evidence</p>
    </div>
  </div>

  <div class="card">
    <div class="status">
      <span class="pill live">Operational</span>
      <span class="pill">v1.0.0</span>
      <span class="pill">${process.env.NODE_ENV || "development"}</span>
      <span class="pill">UTC ${new Date().toISOString().slice(0, 19)}Z</span>
    </div>
    <div class="metrics">
      <div class="metric"><span>Uptime</span><strong>${uptime()}</strong></div>
      <div class="metric"><span>Retrieval</span><strong>Business tools + Neo4j</strong></div>
      <div class="metric"><span>Narration</span><strong>${process.env.ENABLE_EXTERNAL_BUSINESS_LLM === "1" ? "Grounded AI" : "Deterministic evidence"}</strong></div>
      <div class="metric"><span>Upstream</span><strong>Satya Business API</strong></div>
    </div>
  </div>

  <div class="card">
    <h2>How an answer is produced</h2>
    <div class="flow">
      <div class="step"><b>1. Read</b><span>Authorized cases and records are fetched live from the business API.</span></div>
      <div class="step"><b>2. Resolve</b><span>The question is matched to a case via PO, invoice or receipt references.</span></div>
      <div class="step"><b>3. Check</b><span>Snapshot ledger, findings and the Neo4j evidence graph are consulted.</span></div>
      <div class="step"><b>4. Answer</b><span>A cited, question-specific reply is streamed &mdash; never a guessed summary.</span></div>
    </div>
  </div>

  ${ENDPOINT_GROUPS.map((g) => `
  <div class="card">
    <h2>${g.name}</h2>
    <p class="group-detail">${g.detail}</p>
    <table>${g.routes.map(([m, p, d]) => `<tr><td style="width:64px">${badge(m)}</td><td style="width:44%"><code>${p}</code></td><td class="desc">${d}</td></tr>`).join("")}</table>
  </div>`).join("")}

  <div class="links">
    <a class="link" href="https://satya-ipl.vercel.app/chat"><strong>Ask Satya</strong><span>Open the copilot in the app</span></a>
    <a class="link" href="/health"><strong>Health check</strong><span>JSON capability report</span></a>
    <a class="link" href="https://satya-ipl-api.onrender.com"><strong>Business API</strong><span>Investigations &amp; records service</span></a>
    <a class="link" href="https://satya-ipl-ml.onrender.com"><strong>Reconciliation engine</strong><span>Matching &amp; rules service</span></a>
  </div>

  <p class="foot">Satya business workspace &middot; Demo data is fictional &middot; Answers cite live records, not cached summaries &middot; <code>manikkDev/Satya-IPL</code></p>
</div>
</body>
</html>`;
