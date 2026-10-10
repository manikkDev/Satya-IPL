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
  const flagship = cases.find((item) => item.id === "pumps-1001") || cases[0];
  const needingReview = cases.filter((item) => item.status !== "reconciled").length;
  return <BusinessShell title="Clarity, before you pay." subtitle="A single evidence trail across what you ordered, received, were billed for and paid."><State error={error} loading={loading} />{!loading && !error && <><div className="satya-metric-grid">{[
    { label: "Investigations needing evidence", value: String(needingReview), detail: `${cases.length} persisted procurement cases`, icon: ShieldAlert },
    { label: "Flagship · supported outstanding", value: money(flagship?.ledger?.supportedOutstanding, flagship?.ledger?.currency), detail: "Receipt-supported amount, not final approval", icon: Wallet },
    { label: "Flagship · disputed posting", value: money(flagship?.ledger?.disputedExposure, flagship?.ledger?.currency), detail: "Potential duplicate exposure · not savings", icon: GitBranch },
    { label: "Reconciled cases", value: String(cases.filter((item) => item.status === "reconciled").length), detail: "No blocking findings in current snapshot", icon: FileCheck2 },
  ].map(({ label, value, detail, icon: Icon }) => <article className="satya-metric" key={label}><div><span>{label}</span><Icon size={19} /></div><strong>{value}</strong><p>{detail}</p></article>)}</div>{flagship && <div className="satya-spotlight"><div><span className="satya-eyebrow">THE SHOWCASE INVESTIGATION</span><h2>One order. Several records.<br /><em>No room for double counting.</em></h2><p>{flagship.title}. Follow the invoices, inspect the split transfers and resolve what is still unknown.</p><Link href={`/cases/${flagship.id}`} className="satya-button">Open the evidence trail <ArrowUpRight size={17} /></Link></div><div className="satya-stage-preview">{[["ORDERED", flagship.ledger?.ordered, "PO"], ["RECEIVED", flagship.ledger?.received, "GRN"], ["OPEN DELIVERY", flagship.ledger?.openDelivery, "Not automatically overdue"]].map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{value ?? "—"}</strong><small>{detail}</small></div>)}</div></div>}<Panel title="Investigation queue" detail="Every balance belongs to a currency and a committed evidence snapshot."><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Purchase order / investigation</th><th>Sector</th><th>Supported outstanding</th><th>Status</th><th /></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td><Link href={`/cases/${item.id}`}><strong>{item.poId}</strong><span>{item.title}</span></Link></td><td>{item.sector}</td><td>{money(item.ledger?.supportedOutstanding, item.ledger?.currency)}</td><td><span className={`satya-status ${item.status === "reconciled" ? "ok" : "review"}`}>{item.status.replaceAll("_", " ")}</span></td><td><Link href={`/cases/${item.id}`} aria-label={`Open ${item.poId}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div>{cases.length === 0 && <p className="p-5 text-muted-foreground">No records yet. Import a source bundle to begin.</p>}</Panel><div className="satya-notice">Source honesty: the equipment company and these records are constructed fixtures. Public procurement datasets and OCR benchmarks are separate future integrations; they are not silently relabeled as this company.</div></>}</BusinessShell>;
}
