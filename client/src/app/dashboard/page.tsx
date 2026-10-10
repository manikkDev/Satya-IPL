"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowRight, FileCheck2, ShieldAlert, GitBranch, Wallet } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, money, type BusinessCase } from "@/lib/business-api";

export default function DashboardPage() {
  const [cases, setCases] = useState<BusinessCase[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { businessApi.cases().then(setCases).catch((error) => setError(error.message)).finally(() => setLoading(false)); }, []);
  const featured = cases.find((item) => item.id === "pumps-1001") || cases[0];
  const needingReview = cases.filter((item) => item.status !== "reconciled").length;
  return <BusinessShell title="Overview" subtitle="See what needs attention across your orders, deliveries, invoices and payments.">
    <State error={error} loading={loading} />
    {!loading && !error && <>
      <div className="satya-metric-grid satya-money-grid">{[
        { label: "Needs review", value: String(needingReview), detail: `${cases.length} investigations in your workspace`, icon: ShieldAlert },
        { label: "Balance supported by deliveries", value: money(featured?.ledger?.supportedOutstanding, featured?.ledger?.currency), detail: `${featured?.poId || "Featured order"} · not a payment approval`, icon: Wallet },
        { label: "Possible duplicate amount", value: money(featured?.ledger?.disputedExposure, featured?.ledger?.currency), detail: `${featured?.poId || "Featured order"} · needs confirmation`, icon: GitBranch },
        { label: "Matched and checked", value: String(cases.filter((item) => item.status === "reconciled").length), detail: "No blocking issues in the latest check", icon: FileCheck2 },
      ].map(({ label, value, detail, icon: Icon }) => <article className="satya-metric" key={label}><div><span>{label}</span><Icon size={20} /></div><strong>{value}</strong><p>{detail}</p></article>)}</div>
      {featured && <div className="satya-spotlight"><div><span className="satya-eyebrow">Featured investigation · {featured.poId}</span><h2>What was ordered.<br />What arrived. <em>What’s still open.</em></h2><p>{featured.title}. Check the invoices and payments, then review any missing or conflicting records.</p><Link href={`/cases/${featured.id}`} className="satya-button">Review this order <ArrowUpRight size={18} /></Link></div><div className="satya-stage-preview">{[["Ordered", featured.ledger?.ordered, "Purchase order"], ["Delivered", featured.ledger?.received, "Delivery receipts"], ["Still to arrive", featured.ledger?.openDelivery, "Not necessarily overdue"]].map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{value ?? "—"}</strong><small>{detail}</small></div>)}</div></div>}
      <Panel title="Your investigations" detail="Open an order to review its records, issues and next steps."><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Order / investigation</th><th>Sector</th><th>Delivery-supported balance</th><th>Status</th><th><span className="sr-only">Open investigation</span></th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td><Link href={`/cases/${item.id}`}><strong>{item.poId}</strong><span>{item.title}</span></Link></td><td>{item.sector}</td><td>{money(item.ledger?.supportedOutstanding, item.ledger?.currency)}</td><td><span className={`satya-status ${item.status === "reconciled" ? "ok" : "review"}`}>{item.status === "reconciled" ? "Checked" : item.status.replaceAll("_", " ")}</span></td><td><Link className="satya-evidence-chip" href={`/cases/${item.id}`} aria-label={`Open ${item.poId}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div>{cases.length === 0 && <div className="satya-empty-state"><h2>No investigations yet</h2><p>Import your first set of records to get started.</p><Link href="/inbox" className="satya-button">Import records</Link></div>}</Panel>
      <div className="satya-notice">This workspace uses fictional demo records, not live banking or verified tax data. A balance marked “Needs evidence” cannot be confirmed from the available records.</div>
    </>}
  </BusinessShell>;
}
