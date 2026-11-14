#!/usr/bin/env node
// Satya Tally connector — runs on the customer's Tally machine (or LAN),
// pulls masters + vouchers from TallyPrime's local XML HTTP interface
// (default http://localhost:9000) and pushes them to Satya's import API with
// an import-only API key. Outbound HTTPS only: port 9000 is never exposed.
//
// Zero dependencies; Node.js 18+ (built-in fetch).
//
//   node satya-tally-connector.mjs --days 7 --commit
//   node satya-tally-connector.mjs --from 2026-11-01 --to 2026-11-14 --dry-run
//   node satya-tally-connector.mjs --file DayBook.xml --commit     (push a manual export)
//
// Configuration (flags override env; a JSON config file via --config):
//   SATYA_URL       https://<your-satya-api>          (required)
//   SATYA_API_KEY   satk_…  (Import hub > Connector keys; import-only)
//   TALLY_URL       http://localhost:9000
//   TALLY_COMPANY   exact company name loaded in Tally (optional when one company is open)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const fileConfig = flag("config") ? JSON.parse(readFileSync(flag("config"), "utf8")) : {};
const cfg = {
  satyaUrl: String(flag("satya-url", process.env.SATYA_URL || fileConfig.satyaUrl || "")).replace(/\/$/, ""),
  apiKey: flag("api-key", process.env.SATYA_API_KEY || fileConfig.apiKey || ""),
  tallyUrl: String(flag("tally-url", process.env.TALLY_URL || fileConfig.tallyUrl || "http://localhost:9000")).replace(/\/$/, ""),
  company: flag("company", process.env.TALLY_COMPANY || fileConfig.company || ""),
  stateFile: flag("state", fileConfig.stateFile || ".satya-tally-state.json"),
  chunkDays: Number(flag("chunk-days", fileConfig.chunkDays || 7)),
  commit: Boolean(flag("commit", false)),
  dryRun: Boolean(flag("dry-run", false)),
  masters: !flag("no-masters", false),
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };
const ymd = (d) => d.toISOString().slice(0, 10);
const tallyDate = (s) => s.replaceAll("-", "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- Tally XML requests (TallyPrime "Export Data" over HTTP) ----
const companyVar = () => (cfg.company ? `<SVCURRENTCOMPANY>${esc(cfg.company)}</SVCURRENTCOMPANY>` : "");
const dayBookRequest = (from, to) => `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Day Book</ID></HEADER>
 <BODY><DESC><STATICVARIABLES>
  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  <SVFROMDATE TYPE="Date">${tallyDate(from)}</SVFROMDATE>
  <SVTODATE TYPE="Date">${tallyDate(to)}</SVTODATE>
  ${companyVar()}
 </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;
const mastersRequest = (accountType) => `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Accounts</ID></HEADER>
 <BODY><DESC><STATICVARIABLES>
  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  <ACCOUNTTYPE>${accountType}</ACCOUNTTYPE>
  ${companyVar()}
 </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;

const askTally = async (xml) => {
  let res;
  try {
    res = await fetch(cfg.tallyUrl, { method: "POST", headers: { "content-type": "text/xml;charset=utf-8" }, body: xml, signal: AbortSignal.timeout(120000) });
  } catch (e) {
    die(`cannot reach Tally at ${cfg.tallyUrl} (${e.message}). Is TallyPrime running with the company open and the HTTP server enabled on this port?`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString("utf16le") : buf.toString("utf8");
  if (!res.ok) die(`Tally returned HTTP ${res.status}`);
  const lineError = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/i.exec(text);
  if (lineError) die(`Tally error: ${lineError[1].trim()}`);
  return text;
};

// ---- Satya import API ----
const push = async (label, xml) => {
  const bytes = Buffer.byteLength(xml);
  if (cfg.dryRun) { log(`[dry-run] would push ${label} (${(bytes / 1024).toFixed(0)} KB)`); return null; }
  const url = `${cfg.satyaUrl}/api/v2/connect/import?source=tally_xml&fileName=${encodeURIComponent(label)}${cfg.commit ? "&commit=1" : ""}`;
  const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/xml" }, body: xml, signal: AbortSignal.timeout(180000) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) die("Satya rejected the API key — create a new one in Import hub > Connector keys");
  if (!res.ok) die(`Satya import failed (${res.status}): ${body?.error?.message || body?.message || "unknown error"}`);
  const s = body.summary || {};
  log(`${label}: ${body.status} — create ${s.create ?? 0}, update ${s.update ?? 0}, duplicate ${s.duplicate ?? 0}, errors ${s.error ?? 0}, warnings ${s.warnings ?? 0}${body.status === "previewed" ? (cfg.commit ? " (nothing new to import)" : " (preview only — run with --commit to import)") : ""}`);
  for (const i of (body.issues || []).filter((x) => x.severity === "error").slice(0, 5)) log(`   ! ${i.ref || ""} ${i.message}`);
  return body;
};

const main = async () => {
  if (!cfg.dryRun) {
    if (!cfg.satyaUrl) die("set SATYA_URL (or --satya-url)");
    if (!/^satk_[0-9a-f]{40}$/.test(String(cfg.apiKey))) die("set SATYA_API_KEY to an import key (satk_…)");
    const ping = await fetch(`${cfg.satyaUrl}/api/v2/connect/ping`, { headers: { authorization: `Bearer ${cfg.apiKey}` } }).catch((e) => die(`cannot reach Satya at ${cfg.satyaUrl}: ${e.message}`));
    if (!ping.ok) die(`Satya ping failed (${ping.status}) — check the URL and key`);
    log(`connected to Satya (${(await ping.json()).key})`);
  }

  // 1) a file exported by hand from Tally
  const file = flag("file");
  if (file) {
    const buf = readFileSync(file);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString("utf16le") : buf.toString("utf8");
    await push(file.split(/[\\/]/).pop(), text);
    return;
  }

  // 2) pull from Tally over HTTP
  const state = existsSync(cfg.stateFile) ? JSON.parse(readFileSync(cfg.stateFile, "utf8")) : {};
  const today = new Date();
  const to = flag("to") || ymd(today);
  const from = flag("from") || (flag("days") ? ymd(new Date(today.getTime() - Number(flag("days")) * 86400000)) : state.lastTo || ymd(new Date(today.getTime() - 30 * 86400000)));
  log(`Tally ${cfg.tallyUrl}${cfg.company ? ` company "${cfg.company}"` : ""}: ${from} → ${to}`);

  if (cfg.masters) {
    const ledgers = await askTally(mastersRequest("Ledgers"));
    await push(`tally-ledgers-${to}.xml`, ledgers);
    const stock = await askTally(mastersRequest("Stock Items"));
    await push(`tally-stock-items-${to}.xml`, stock);
  }
  // vouchers in date chunks keep each request well under the upload limit
  for (let start = new Date(`${from}T00:00:00Z`); ymd(start) <= to; start = new Date(start.getTime() + cfg.chunkDays * 86400000)) {
    const endD = new Date(Math.min(start.getTime() + (cfg.chunkDays - 1) * 86400000, new Date(`${to}T00:00:00Z`).getTime()));
    const xml = await askTally(dayBookRequest(ymd(start), ymd(endD)));
    if (!/<VOUCHER[\s>]/.test(xml)) { log(`${ymd(start)} → ${ymd(endD)}: no vouchers`); continue; }
    await push(`tally-daybook-${ymd(start)}_${ymd(endD)}.xml`, xml);
  }
  if (!cfg.dryRun && cfg.commit) writeFileSync(cfg.stateFile, JSON.stringify({ ...state, lastTo: to, lastRunAt: new Date().toISOString() }, null, 2));
  log("done");
};

main().catch((e) => die(e.message));
