"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, money, type SourceRecord } from "@/lib/business-api";

export default function RecordsPage() {
  const [records, setRecords] = useState<(SourceRecord & { caseId: string })[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => { businessApi.records().then(setRecords).catch((error) => setError(error.message)); }, []);
  return <BusinessShell title="Source records" subtitle="The original observations stay visible, including disputed duplicate postings."><State error={error} loading={!records && !error} /><input aria-label="Search source records" placeholder="Search reference, type or source…" className="satya-input mb-5 max-w-lg" value={filter} onChange={(event) => setFilter(event.target.value)} /><Panel title="Company record registry"><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Reference</th><th>Record type</th><th>Source system</th><th>Amount / currency</th><th>Provenance</th></tr></thead><tbody>{records?.filter((record) => `${record.reference} ${record.type} ${record.source}`.toLowerCase().includes(filter.toLowerCase())).map((record) => <tr key={record.id}><td><Link href={`/cases/${record.caseId}`}><strong>{record.reference}</strong><span>{record.id}</span></Link></td><td>{record.type}</td><td>{record.source}</td><td>{record.amount ? money(record.amount, record.currency) : "Quantity evidence"}</td><td><span className="satya-tag">{record.provenance}</span></td></tr>)}</tbody></table></div></Panel></BusinessShell>;
}
