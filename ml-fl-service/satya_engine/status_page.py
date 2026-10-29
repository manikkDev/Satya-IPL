import time

STARTED_AT = time.time()


def uptime() -> str:
    seconds = int(time.time() - STARTED_AT)
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    if days:
        return f"{days}d {hours}h {minutes}m"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m {secs}s"


def status_page(model_ready: bool) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Satya Reconciliation Engine</title>
<style>
  :root{{--primary:#087f74;--primary-dark:#065f56;--ink:#182638;--muted:#526477;--border:#dce3eb;--card:#ffffff;--bg:#f4f7f9}}
  *{{box-sizing:border-box;margin:0}}
  body{{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;padding:32px 20px 48px}}
  .wrap{{max-width:920px;margin:0 auto}}
  .top{{display:flex;align-items:center;gap:16px;margin-bottom:28px}}
  .mark{{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-size:27px;font-weight:800;box-shadow:0 6px 18px rgba(8,127,116,.28)}}
  .top h1{{font-size:26px;font-weight:750;letter-spacing:-.02em}}
  .top p{{color:var(--muted);font-size:15px}}
  .pill{{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--muted)}}
  .pill.live{{color:#047857;border-color:#a7f3d0;background:#ecfdf5}}
  .pill.live::before{{content:"";width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.2)}}
  .card{{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 26px;margin-bottom:20px;box-shadow:0 1px 3px rgba(24,38,56,.05)}}
  .status{{display:flex;flex-wrap:wrap;gap:12px}}
  .metrics{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-top:18px}}
  .metric{{border:1px solid var(--border);border-radius:10px;padding:12px 15px}}
  .metric span{{display:block;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}}
  .metric strong{{font-size:15px;font-weight:650}}
  h2{{font-size:15px;font-weight:700;margin-bottom:4px}}
  .group-detail{{font-size:13px;color:var(--muted);margin-bottom:14px}}
  table{{width:100%;border-collapse:collapse;font-size:13.5px}}
  td{{padding:9px 10px;border-top:1px solid var(--border);vertical-align:top}}
  tr:first-child td{{border-top:0}}
  .method{{display:inline-block;min-width:46px;text-align:center;color:#fff;font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px;font-family:ui-monospace,monospace}}
  code{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--primary-dark)}}
  .desc{{color:var(--muted)}}
  .links{{display:flex;flex-wrap:wrap;gap:12px}}
  .link{{flex:1;min-width:190px;display:block;border:1px solid var(--border);border-radius:12px;padding:15px 18px;text-decoration:none;color:var(--ink);background:var(--card);transition:border-color .15s,transform .15s}}
  .link:hover{{border-color:var(--primary);transform:translateY(-1px)}}
  .link strong{{display:block;font-size:14.5px;margin-bottom:3px}}
  .link span{{font-size:12.5px;color:var(--muted)}}
  .foot{{margin-top:26px;font-size:12.5px;color:var(--muted);text-align:center}}
  .foot code{{color:var(--muted)}}
  @media(max-width:560px){{.top h1{{font-size:21px}}td{{padding:8px 6px}}.card{{padding:18px}}}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="mark">S</div>
    <div>
      <h1>Satya Reconciliation Engine</h1>
      <p>Invoice&ndash;line matching and evidence evaluation service</p>
    </div>
  </div>

  <div class="card">
    <div class="status">
      <span class="pill live">Operational</span>
      <span class="pill">v1.0.0</span>
      <span class="pill">UTC {time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())}Z</span>
    </div>
    <div class="metrics">
      <div class="metric"><span>Uptime</span><strong>{uptime()}</strong></div>
      <div class="metric"><span>Rules engine</span><strong>Ready</strong></div>
      <div class="metric"><span>Matching model</span><strong>{"Ready" if model_ready else "Heuristic fallback"}</strong></div>
      <div class="metric"><span>Model artifact</span><strong>satya-pair-xgb-v2</strong></div>
    </div>
  </div>

  <div class="card">
    <h2>What this service does</h2>
    <p class="desc">This is Satya&rsquo;s internal computation engine. It validates imported business records, reconstructs delivery-supported balances, scores candidate invoice-to-order line matches and reports model limitations. Every endpoint except <code>/health</code> requires the internal service token &mdash; it is not a public API.</p>
  </div>

  <div class="card">
    <h2>Internal endpoints</h2>
    <p class="group-detail">Called by the business API with a service token</p>
    <table>
      <tr><td style="width:64px"><span class="method" style="background:#0f766e">GET</span></td><td style="width:44%"><code>/internal/demo</code></td><td class="desc">Constructed demo bundle for seeded investigations</td></tr>
      <tr><td><span class="method" style="background:#1d4ed8">POST</span></td><td><code>/internal/import-preview</code></td><td class="desc">Validate and normalize an import bundle</td></tr>
      <tr><td><span class="method" style="background:#1d4ed8">POST</span></td><td><code>/internal/reconcile</code></td><td class="desc">Recompute a case ledger, findings and evidence graph</td></tr>
      <tr><td><span class="method" style="background:#0f766e">GET</span></td><td><code>/internal/evaluation</code></td><td class="desc">Matching-model metrics and limitations</td></tr>
      <tr><td><span class="method" style="background:#0f766e">GET</span></td><td><code>/health</code></td><td class="desc">Liveness and model readiness</td></tr>
    </table>
  </div>

  <div class="links">
    <a class="link" href="https://satya-ipl.vercel.app"><strong>Satya app</strong><span>Open the workspace UI</span></a>
    <a class="link" href="/health"><strong>Health check</strong><span>JSON readiness report</span></a>
    <a class="link" href="https://satya-ipl-api.onrender.com"><strong>Business API</strong><span>Investigations &amp; records service</span></a>
    <a class="link" href="https://satya-ipl-chat.onrender.com"><strong>Copilot service</strong><span>Question-answering API</span></a>
  </div>

  <p class="foot">Satya business workspace &middot; Matching model trained on constructed fixtures &middot; Human review remains mandatory &middot; <code>manikkDev/Satya-IPL</code></p>
</div>
</body>
</html>"""
