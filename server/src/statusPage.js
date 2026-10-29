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
    name: "Identity & access",
    detail: "JWT-authenticated company workspaces",
    routes: [
      ["POST", "/api/auth/signup", "Create an account (invite-gated roles)"],
      ["POST", "/api/auth/login", "Issue a session token"],
      ["GET", "/api/auth/profile", "Current user profile and role"],
      ["GET", "/api/users", "Company membership directory"],
    ],
  },
  {
    name: "Investigations",
    detail: "Purchase-order evidence review",
    routes: [
      ["GET", "/api/v1/cases", "List investigations for the company"],
      ["GET", "/api/v1/cases/:id", "Case detail with latest snapshot"],
      ["POST", "/api/v1/cases/:id/reconcile", "Queue a reconciliation job"],
      ["POST", "/api/v1/cases/:id/replay", "Recompute evidence at a cutoff"],
      ["POST", "/api/v1/cases/:id/scenario", "Preview a what-if record"],
    ],
  },
  {
    name: "Source records & imports",
    detail: "Immutable evidence intake",
    routes: [
      ["GET", "/api/v1/records", "All imported source records"],
      ["POST", "/api/v1/imports/preview", "Validate a bundle before saving"],
      ["POST", "/api/v1/imports", "Commit a validated bundle"],
      ["GET", "/api/v1/documents/:id", "Stored source document"],
    ],
  },
  {
    name: "Evidence graph & matching",
    detail: "Neo4j projection of record links",
    routes: [
      ["GET", "/api/v1/graph/cases/:id", "Projected evidence graph"],
      ["GET", "/api/v1/snapshots/:id", "Committed snapshot result"],
      ["GET", "/api/v1/jobs/:id", "Reconciliation job status"],
    ],
  },
  {
    name: "Review workflow",
    detail: "Role-gated decisions",
    routes: [
      ["POST", "/api/v1/cases/:id/decisions", "Record an approve/escalate/hold decision"],
      ["GET", "/api/v1/evaluation", "Matching-model evaluation report"],
      ["GET", "/api/audit", "Immutable audit trail"],
    ],
  },
  {
    name: "Platform",
    detail: "Operations and integrations",
    routes: [
      ["GET", "/api/health", "Liveness probe"],
      ["GET", "/api/conversations", "Copilot conversation history"],
      ["GET", "/api/v2/meta/flags", "Feature flags"],
      ["WS", "/socket.io", "Realtime workspace events"],
    ],
  },
];

const badge = (method) => {
  const colors = { GET: "#0f766e", POST: "#1d4ed8", WS: "#7c3aed", PUT: "#b45309", DELETE: "#b91c1c" };
  return `<span class="method" style="background:${colors[method] || "#475569"}">${method}</span>`;
};

export const statusPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Satya Business API</title>
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
  .status .pill{margin-left:auto}
  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:18px}
  .metric{border:1px solid var(--border);border-radius:10px;padding:12px 15px}
  .metric span{display:block;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .metric strong{font-size:16px;font-weight:650}
  h2{font-size:15px;font-weight:700;margin-bottom:4px}
  .group-detail{font-size:13px;color:var(--muted);margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  td{padding:9px 10px;border-top:1px solid var(--border);vertical-align:top}
  tr:first-child td{border-top:0}
  .method{display:inline-block;min-width:46px;text-align:center;color:#fff;font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px;font-family:ui-monospace,monospace}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--primary-dark)}
  .desc{color:var(--muted)}
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
      <h1>Satya Business API</h1>
      <p>Evidence-first purchase-order reconciliation service</p>
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
      <div class="metric"><span>Region</span><strong>Singapore</strong></div>
      <div class="metric"><span>Datastore</span><strong>MongoDB Atlas</strong></div>
      <div class="metric"><span>Graph store</span><strong>Neo4j Aura</strong></div>
    </div>
  </div>

  <div class="card">
    <h2>What this service does</h2>
    <p class="desc">Satya reconstructs what a company actually owes by comparing purchase orders, delivery receipts, invoices and payments. Every figure is backed by an immutable source record and its evidence trail &mdash; nothing is guessed. All endpoints require a bearer token except <code>/api/health</code>.</p>
  </div>

  ${ENDPOINT_GROUPS.map((g) => `
  <div class="card">
    <h2>${g.name}</h2>
    <p class="group-detail">${g.detail}</p>
    <table>${g.routes.map(([m, p, d]) => `<tr><td style="width:64px">${badge(m)}</td><td style="width:44%"><code>${p}</code></td><td class="desc">${d}</td></tr>`).join("")}</table>
  </div>`).join("")}

  <div class="links">
    <a class="link" href="https://satya-ipl.vercel.app"><strong>Satya app</strong><span>Open the workspace UI</span></a>
    <a class="link" href="/api/health"><strong>Health check</strong><span>JSON liveness probe</span></a>
    <a class="link" href="https://satya-ipl-chat.onrender.com"><strong>Copilot service</strong><span>Question-answering API</span></a>
    <a class="link" href="https://satya-ipl-ml.onrender.com"><strong>Reconciliation engine</strong><span>Matching &amp; rules service</span></a>
  </div>

  <p class="foot">Satya business workspace &middot; Demo data is fictional &middot; Infrastructure defined in <code>render.yaml</code> &middot; <code>manikkDev/Satya-IPL</code></p>
</div>
</body>
</html>`;
