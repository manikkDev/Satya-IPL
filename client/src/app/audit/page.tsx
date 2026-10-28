"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, type DetailedAuditEntry } from "@/lib/business-api";

const roles: Record<string, string> = { ap_manager:"Finance manager", ops_analyst:"Operations analyst", auditor:"Auditor", admin:"Administrator" };
export default function AuditPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<DetailedAuditEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    // Use the enriched endpoint for managers/auditors, fall back to basic
    businessApi.auditDetailed()
      .then(setRows)
      .catch(() => businessApi.audit().then((basic) => setRows(basic.map((r) => ({ ...r, caseContext: null })))))
      .catch((error) => setError(error.message));
  }, []);
  return <BusinessShell title="Review history" subtitle="See who reviewed an investigation, when it happened and what decision they recorded.">
    <State error={error} loading={!rows && !error} />
    {rows && <Panel title="Recorded activity" detail={`${rows.length} events in your company workspace.`}><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Date and time · India time</th><th>Activity</th><th>Investigation / record</th><th>Role</th><th>Case context</th></tr></thead><tbody>{rows.map((row) => <tr key={row._id}><td>{new Date(row.createdAt).toLocaleString("en-IN", { timeZone:"Asia/Kolkata" })}</td><td>{row.action.replaceAll("_", " ").toLowerCase()}</td><td>{row.caseContext ? <Link href={`/cases/${row.target}`}><strong>{row.caseContext.poId}</strong><span> · {row.caseContext.supplier}</span></Link> : row.target}</td><td>{roles[row.role] || row.role.replaceAll("_", " ")}</td><td>{row.caseContext ? <><span className={`satya-status ${row.caseContext.currentStatus === "reconciled" ? "ok" : "review"}`}>{row.caseContext.currentStatus.replaceAll("_", " ")}</span> · {row.caseContext.decisionCount} decision{row.caseContext.decisionCount !== 1 ? "s" : ""}</> : "—"}</td></tr>)}</tbody></table></div>{!rows.length && <div className="satya-empty-state"><h2>No review activity yet</h2><p>Decisions recorded for an investigation will appear here.</p></div>}<div className="satya-notice">This is the application's review history. It is not independently certified or guaranteed to be tamper-proof against a database administrator.</div></Panel>}
  </BusinessShell>;
}
