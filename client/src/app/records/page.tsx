"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search, ArrowUpRight } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, money, type SourceRecord } from "@/lib/business-api";

const types: Record<string, string> = { PO:"Purchase order", GRN:"Delivery receipt", INVOICE:"Invoice", PAYMENT:"Payment", CREDIT_NOTE:"Credit note", RETURN:"Return", PROFORMA:"Proforma invoice" };
export default function RecordsPage() {
  const [records, setRecords] = useState<(SourceRecord & { caseId: string })[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [type, setType] = useState("all");
  useEffect(() => { businessApi.records().then(setRecords).catch((error) => setError(error.message)); }, []);
  const visible = (records || []).filter((record) => `${record.reference} ${record.id} ${record.supplier} ${types[record.type] || record.type} ${record.source}`.toLowerCase().includes(filter.trim().toLowerCase()) && (type === "all" || record.type === type));
  return <BusinessShell title="Records" subtitle="Browse the original orders, delivery receipts, invoices and payments. Disputed records stay visible.">
    <State error={error} loading={!records && !error} />
    {records && <><div className="satya-filter-bar"><div className="satya-filter-field"><label htmlFor="record-search">Find a record</label><div className="satya-search-input"><Search size={19} aria-hidden="true" /><input id="record-search" className="satya-input" placeholder="Reference, supplier or source" value={filter} onChange={(event) => setFilter(event.target.value)} /></div></div><div className="satya-filter-field compact"><label htmlFor="record-type">Record type</label><select id="record-type" className="satya-input" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{[...new Set(records.map((record) => record.type))].sort().map((value) => <option key={value} value={value}>{types[value] || value.replaceAll("_", " ")}</option>)}</select></div></div><Panel title="Company records" detail={`${visible.length} of ${records.length} records. Open a reference to view its investigation.`}><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Reference</th><th>Record type</th><th>Source system</th><th>Amount</th><th>Origin</th><th><span className="sr-only">View investigation</span></th></tr></thead><tbody>{visible.map((record) => <tr key={record.id}><td><Link href={`/cases/${encodeURIComponent(record.caseId)}`}><strong>{record.reference}</strong><span>{record.id}</span></Link></td><td>{types[record.type] || record.type.replaceAll("_", " ")}</td><td>{record.source.replaceAll("_", " ")}</td><td>{record.amount ? money(record.amount, record.currency) : "Quantity record"}</td><td><span className="satya-tag">{record.provenance.replaceAll("_", " ")}</span></td><td><Link className="satya-evidence-chip" href={`/cases/${encodeURIComponent(record.caseId)}`} aria-label={`Open investigation for ${record.reference}`}><ArrowUpRight size={17} /></Link></td></tr>)}</tbody></table></div>{!visible.length && <div className="satya-empty-state"><h2>{records.length ? "No records match your search" : "No records yet"}</h2><p>{records.length ? "Try a different reference or show all record types." : "Your imported records will appear here."}</p>{records.length > 0 && <button className="satya-button secondary" onClick={() => { setFilter(""); setType("all"); }}>Clear filters</button>}</div>}</Panel></>}
  </BusinessShell>;
}
