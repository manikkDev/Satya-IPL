"use client";

import { useEffect, useState } from "react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi } from "@/lib/business-api";

export default function AuditPage() {
  const [rows, setRows] = useState<{ _id: string; action: string; target: string; createdAt: string; role: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { businessApi.audit().then(setRows).catch((error) => setError(error.message)); }, []);
  return <BusinessShell title="Review history" subtitle="See who reviewed an investigation, when it happened and what decision they recorded."><State error={error} loading={!rows && !error} />{rows && <Panel title="Company audit events"><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Knowledge time · IST</th><th>Event</th><th>Case / target</th><th>Actor role</th></tr></thead><tbody>{rows.map((row) => <tr key={row._id}><td>{new Date(row.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td>{row.action}</td><td>{row.target}</td><td>{row.role.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>{rows.length === 0 && <p className="text-sm text-muted-foreground">No review events yet. Record a case decision to start the trail.</p>}<div className="satya-notice">Append-only application history is not a claim of tamper-proof storage against a database administrator.</div></Panel>}</BusinessShell>;
}
