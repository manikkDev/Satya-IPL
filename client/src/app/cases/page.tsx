"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, MessageSquare, FolderSearch, RotateCcw, AlertCircle, CheckCircle2, Files } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { useAuth } from "@/contexts/auth-context";
import { businessApi, money, type BusinessCase } from "@/lib/business-api";

export default function CasesPage() {
  const { user } = useAuth();
  const [cases, setCases] = useState<BusinessCase[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("all");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState("attention");
  const load = () => { setError(""); businessApi.cases().then(setCases).catch((error) => setError(error.message)); };
  useEffect(() => { businessApi.cases().then(setCases).catch((error) => setError(error.message)); }, []);
  const reset = () => { setFilter(""); setStatus("all"); setSector("all"); setSort("attention"); };
  const visible = (cases || []).filter((item) => `${item.title} ${item.supplier} ${item.sector} ${item.poId}`.toLowerCase().includes(filter.trim().toLowerCase()) && (status === "all" || (status === "checked" ? item.status === "reconciled" : item.status !== "reconciled")) && (sector === "all" || item.sector === sector)).sort((a, b) => sort === "order" ? a.poId.localeCompare(b.poId, undefined, { numeric: true }) : Number(a.status === "reconciled") - Number(b.status === "reconciled") || b.findingCount - a.findingCount || a.poId.localeCompare(b.poId));

  return <BusinessShell title="Investigations" subtitle="Find an order, understand what doesn’t match and review the records behind it.">
    <State error={error} loading={!cases && !error} />
    {error && <button className="satya-button secondary mb-5" onClick={load}><RotateCcw size={17} />Try again</button>}
    {cases && <>
      <div className="satya-metric-grid">{[
        { label: "All investigations", value: cases.length, detail: "Orders in this workspace", icon: FolderSearch },
        { label: "Needs attention", value: cases.filter((item) => item.status !== "reconciled").length, detail: "Missing or conflicting information", icon: AlertCircle },
        { label: "Checked", value: cases.filter((item) => item.status === "reconciled").length, detail: "No blocking issues found", icon: CheckCircle2 },
        { label: "Issues to review", value: cases.reduce((sum, item) => sum + item.findingCount, 0), detail: "Findings across all investigations", icon: Files },
      ].map(({ label, value, detail, icon: Icon }) => <article className="satya-metric" key={label}><div><span>{label}</span><Icon size={20} /></div><strong>{value}</strong><p>{detail}</p></article>)}</div>
      <div className="satya-filter-bar"><div className="satya-filter-field"><label htmlFor="investigation-search">Find an investigation</label><div className="satya-search-input"><Search size={19} aria-hidden="true" /><input id="investigation-search" className="satya-input" placeholder="Order number, supplier or title" value={filter} onChange={(event) => setFilter(event.target.value)} /></div></div><div className="satya-filter-field compact"><label htmlFor="investigation-status">Status</label><select id="investigation-status" className="satya-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="review">Needs attention</option><option value="checked">Checked</option></select></div><div className="satya-filter-field compact"><label htmlFor="investigation-sector">Sector</label><select id="investigation-sector" className="satya-input" value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">All sectors</option>{[...new Set(cases.map((item) => item.sector))].sort().map((value) => <option key={value}>{value}</option>)}</select></div><div className="satya-filter-field compact"><label htmlFor="investigation-sort">Sort by</label><select id="investigation-sort" className="satya-input" value={sort} onChange={(event) => setSort(event.target.value)}><option value="attention">Needs attention first</option><option value="order">Order number</option></select></div></div>
      <p className="satya-results-count" role="status">{visible.length} of {cases.length} investigations{(filter || status !== "all" || sector !== "all") && <button className="underline ml-3" onClick={reset}>Clear filters</button>}</p>
      <div className="satya-case-grid">{visible.map((item) => <Panel key={item.id}><div className="satya-case-card-top"><span className="satya-eyebrow">{item.poId} · {item.sector}</span><span className={`satya-status ${item.status === "reconciled" ? "ok" : "review"}`}>{item.status === "reconciled" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{item.status === "reconciled" ? "Checked" : "Needs attention"}</span></div><Link className="satya-case-card-title" href={`/cases/${item.id}`}>{item.title}</Link><p className="satya-case-supplier">{item.supplier}</p><dl className="satya-case-card-stats"><div><dt>Delivery-supported balance</dt><dd>{money(item.ledger?.supportedOutstanding, item.ledger?.currency)}<small>Based on deliveries and linked payments</small></dd></div><div><dt>Issues found</dt><dd>{item.findingCount}<small>{item.findingCount ? "Review before making a decision" : "No findings in the latest check"}</small></dd></div></dl><div className="satya-case-card-actions"><Link href={`/cases/${item.id}`} className="satya-button">Review investigation <ArrowUpRight size={17} /></Link><Link href={`/chat?case=${encodeURIComponent(item.id)}`} className="satya-button secondary"><MessageSquare size={17} />Ask Satya</Link></div></Panel>)}</div>
      {visible.length === 0 && <Panel><div className="satya-empty-state"><FolderSearch size={36} /><h2>{cases.length ? "No matching investigations" : "Start your first investigation"}</h2><p>{cases.length ? "Try another search or clear the filters to see all orders." : "Import a JSON file of your records to check an order."}</p>{cases.length ? <button className="satya-button secondary" onClick={reset}>Clear filters</button> : user?.role !== "auditor" && <Link className="satya-button" href="/inbox">Import records</Link>}</div></Panel>}
    </>}
  </BusinessShell>;
}
