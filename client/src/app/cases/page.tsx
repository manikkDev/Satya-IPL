"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, money, type BusinessCase } from "@/lib/business-api";

export default function CasesPage() {
  const [cases, setCases] = useState<BusinessCase[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => { businessApi.cases().then(setCases).catch((error) => setError(error.message)); }, []);
  return <BusinessShell title="Investigations" subtitle="Find the discrepancy, follow its evidence, and keep unresolved facts unresolved."><State error={error} loading={!cases && !error} /><input className="satya-input mb-5 max-w-lg" aria-label="Search investigations" placeholder="Search order, supplier or sector…" value={filter} onChange={(event) => setFilter(event.target.value)} /><div className="satya-case-grid">{cases?.filter((item) => `${item.title} ${item.supplier} ${item.sector} ${item.poId}`.toLowerCase().includes(filter.toLowerCase())).map((item) => <Panel key={item.id}><div className="flex items-center justify-between"><span className="satya-eyebrow">{item.sector} / {item.poId}</span><span className={`satya-status ${item.status === "reconciled" ? "ok" : "review"}`}>{item.status.replaceAll("_", " ")}</span></div><h2 className="mt-4 text-2xl">{item.title}</h2><p className="mt-3 text-sm text-muted-foreground">{item.supplier}</p><div className="satya-case-balance"><span>Receipt-supported outstanding</span><strong>{money(item.ledger?.supportedOutstanding, item.ledger?.currency)}</strong></div><Link href={`/cases/${item.id}`} className="satya-button secondary">Inspect evidence <ArrowUpRight size={16} /></Link></Panel>)}</div>{cases?.length === 0 && <Panel>No cases yet. Import a structured bundle to begin.</Panel>}</BusinessShell>;
}
