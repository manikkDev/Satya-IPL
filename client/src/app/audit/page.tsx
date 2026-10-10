"use client";

import { useEffect, useState } from "react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi } from "@/lib/business-api";

const roles: Record<string, string> = { ap_manager:"Finance manager", ops_analyst:"Operations analyst", auditor:"Auditor", admin:"Administrator" };
export default function AuditPage() {
  const [rows, setRows] = useState<{ _id: string; action: string; target: string; createdAt: string; role: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { businessApi.audit().then(setRows).catch((error) => setError(error.message)); }, []);
  return <BusinessShell title="Review history" subtitle="See who reviewed an investigation, when it happened and what decision they recorded.">
    <State error={error} loading={!rows && !error} />
    {rows && <Panel title="Recorded activity" detail={`${rows.length} events in your company workspace.`}><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Date and time · India time</th><th>Activity</th><th>Investigation / record</th><th>Role</th></tr></thead><tbody>{rows.map((row) => <tr key={row._id}><td>{new Date(row.createdAt).toLocaleString("en-IN", { timeZone:"Asia/Kolkata" })}</td><td>{row.action.replaceAll("_", " ").toLowerCase()}</td><td>{row.target}</td><td>{roles[row.role] || row.role.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>{!rows.length && <div className="satya-empty-state"><h2>No review activity yet</h2><p>Decisions recorded for an investigation will appear here.</p></div>}<div className="satya-notice">This is the application’s review history. It is not independently certified or guaranteed to be tamper-proof against a database administrator.</div></Panel>}
  </BusinessShell>;
}
