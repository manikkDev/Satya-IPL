"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowRight, FileCheck2, ShieldAlert, GitBranch, Wallet, AlertTriangle, Bell, TrendingUp, Users } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, money, type BusinessCase, type DashboardSummary, type AttentionItem, type Alert } from "@/lib/business-api";

export default function DashboardPage() {
  const [cases, setCases] = useState<BusinessCase[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      businessApi.cases().then(setCases),
      businessApi.dashboardSummary().then(setSummary).catch(() => null),
      businessApi.dashboardAttention().then((r) => setAttention(r.items)).catch(() => null),
      businessApi.alerts().then((r) => setAlerts(r.alerts)).catch(() => null),
    ]).catch((error) => setError(error.message)).finally(() => setLoading(false));
  }, []);
  const featured = cases.find((item) => item.id === "pumps-1001") || cases[0];
  const needingReview = cases.filter((item) => item.status !== "reconciled").length;
  const highAlerts = alerts.filter((a) => a.severity === "high").length;
  const cur = summary?.currency || featured?.ledger?.currency || "INR";

  return <BusinessShell title="Overview" subtitle="See what needs attention across your orders, deliveries, invoices and payments.">
    <State error={error} loading={loading} />
    {!loading && !error && <>
      {/* ── Primary metric cards ─────────────────────────────────────── */}
      <div className="satya-metric-grid satya-money-grid">{[
        { label: "Needs review", value: String(summary?.statusCounts.needs_review ?? needingReview), detail: `${summary?.statusCounts.total ?? cases.length} investigations in your workspace`, icon: ShieldAlert },
        { label: "Total outstanding (supported)", value: summary ? money(summary.totals.supportedOutstanding, cur) : money(featured?.ledger?.supportedOutstanding, featured?.ledger?.currency), detail: summary ? "Across all cases · delivery-supported" : `${featured?.poId || "Featured order"} · not a payment approval`, icon: Wallet },
        { label: "Disputed exposure", value: summary ? money(summary.totals.disputedExposure, cur) : money(featured?.ledger?.disputedExposure, featured?.ledger?.currency), detail: summary ? "Total possible duplicates and disputes" : `${featured?.poId || "Featured order"} · needs confirmation`, icon: GitBranch },
        { label: "Matched and checked", value: String(summary?.statusCounts.reconciled ?? cases.filter((item) => item.status === "reconciled").length), detail: "No blocking issues in the latest check", icon: FileCheck2 },
      ].map(({ label, value, detail, icon: Icon }) => <article className="satya-metric" key={label}><div><span>{label}</span><Icon size={20} /></div><strong>{value}</strong><p>{detail}</p></article>)}</div>

      {/* ── Alerts badge row ─────────────────────────────────────────── */}
      {(highAlerts > 0 || (summary && (summary.findings.blocking > 0 || summary.duplicateCandidates > 0))) && <div className="satya-notice warning" role="status">
        <strong><Bell size={16} className="inline mr-1" />{highAlerts} high-priority alert{highAlerts !== 1 ? "s" : ""}</strong>
        {summary && <> · {summary.findings.blocking} blocking issue{summary.findings.blocking !== 1 ? "s" : ""} · {summary.duplicateCandidates} duplicate candidate{summary.duplicateCandidates !== 1 ? "s" : ""} · {summary.unallocatedPayments} unlinked payment{summary.unallocatedPayments !== 1 ? "s" : ""}</>}
      </div>}

      {summary?.mixedCurrencyWarning && <div className="satya-notice warning"><AlertTriangle size={16} className="inline mr-1" />{summary.mixedCurrencyWarning}</div>}

      {/* ── Featured investigation spotlight (preserved) ──────────── */}
      {featured && <div className="satya-spotlight"><div><span className="satya-eyebrow">Featured investigation · {featured.poId}</span><h2>What was ordered.<br />What arrived. <em>What's still open.</em></h2><p>{featured.title}. Check the invoices and payments, then review any missing or conflicting records.</p><Link href={`/cases/${featured.id}`} className="satya-button">Review this order <ArrowUpRight size={18} /></Link></div><div className="satya-stage-preview">{[["Ordered", featured.ledger?.ordered, "Purchase order"], ["Delivered", featured.ledger?.received, "Delivery receipts"], ["Still to arrive", featured.ledger?.openDelivery, "Not necessarily overdue"]].map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{value ?? "—"}</strong><small>{detail}</small></div>)}</div></div>}

      {/* ── Attention items (priority-scored) ─────────────────────── */}
      {attention.length > 0 && <Panel title={`Needs attention (${attention.length})`} detail="Cases ranked by priority score. Higher scores need action first.">
        <div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Order</th><th>Supplier</th><th>Status</th><th>Priority</th><th>Why</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{attention.slice(0, 15).map((item) => <tr key={item.caseId}><td><Link href={`/cases/${item.caseId}`}><strong>{item.poId}</strong></Link></td><td>{item.supplier}</td><td><span className={`satya-status ${item.status === "escalated" ? "review" : "review"}`}>{item.status.replaceAll("_", " ")}</span></td><td><strong>{item.priority}</strong></td><td><ul className="satya-list">{item.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></td><td><Link className="satya-evidence-chip" href={`/cases/${item.caseId}`} aria-label={`Open ${item.poId}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div>
      </Panel>}

      {/* ── Supplier balances ─────────────────────────────────────── */}
      {summary && summary.supplierBalances.length > 0 && <Panel title={`Supplier balances (${summary.supplierBalances.length})`} detail="Aggregated from authoritative snapshots. Individual case balances are definitive.">
        <div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Supplier</th><th>Recorded outstanding</th><th>Supported outstanding</th><th>Disputed</th><th>Settled</th><th>Cases</th></tr></thead><tbody>{summary.supplierBalances.map((s) => <tr key={s.supplier}><td><strong>{s.supplier}</strong></td><td>{money(s.recorded, s.currency)}</td><td>{money(s.supported, s.currency)}</td><td>{money(s.disputed, s.currency)}</td><td>{money(s.settled, s.currency)}</td><td>{s.caseCount}</td></tr>)}</tbody></table></div>
      </Panel>}

      {/* ── In-app alerts ─────────────────────────────────────────── */}
      {alerts.length > 0 && <Panel title={`Alerts (${alerts.length})`} detail="Generated from case state. No external notifications are sent.">
        <div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Severity</th><th>Order</th><th>Alert</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{alerts.slice(0, 20).map((a, i) => <tr key={`${a.caseId}-${a.type}-${i}`}><td><span className={`satya-status ${a.severity === "high" ? "review" : "ok"}`}>{a.severity}</span></td><td><Link href={`/cases/${a.caseId}`}><strong>{a.poId}</strong></Link></td><td>{a.message}</td><td><Link className="satya-evidence-chip" href={`/cases/${a.caseId}`} aria-label={`Open ${a.poId}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div>
      </Panel>}

      {/* ── Full case list (preserved from original) ──────────────── */}
      <Panel title="Your investigations" detail="Open an order to review its records, issues and next steps."><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Order / investigation</th><th>Sector</th><th>Delivery-supported balance</th><th>Status</th><th><span className="sr-only">Open investigation</span></th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td><Link href={`/cases/${item.id}`}><strong>{item.poId}</strong><span>{item.title}</span></Link></td><td>{item.sector}</td><td>{money(item.ledger?.supportedOutstanding, item.ledger?.currency)}</td><td><span className={`satya-status ${item.status === "reconciled" ? "ok" : "review"}`}>{item.status === "reconciled" ? "Checked" : item.status.replaceAll("_", " ")}</span></td><td><Link className="satya-evidence-chip" href={`/cases/${item.id}`} aria-label={`Open ${item.poId}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div>{cases.length === 0 && <div className="satya-empty-state"><h2>No investigations yet</h2><p>Import your first set of records to get started.</p><Link href="/inbox" className="satya-button">Import records</Link></div>}</Panel>
      <div className="satya-notice">This workspace uses fictional demo records, not live banking or verified tax data. A balance marked "Needs evidence" cannot be confirmed from the available records.</div>
    </>}
  </BusinessShell>;
}
