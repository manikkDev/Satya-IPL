"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import RiskShell, { ErrorPanel, LoadingPanel, MetricCard } from "@/components/risk/RiskShell";
import { api } from "@/lib/api";

const ACTION_LABELS = {
  "fl.start": "Federated run started",
  "fl.stop": "Federated run stopped",
  predict: "Model prediction",
  "consent.grant": "Consent granted",
  "consent.revoke": "Consent revoked",
  "data.erase_request": "Erasure request",
  "data.export": "Data export",
  "citizen.view_blocked": "Citizen view blocked (consent)",
  "graph.seed": "Graph seeded",
};

function AuditView() {
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.audit.list(200).then(setLogs).catch((reason) => setError(reason.message));
  }, []);
  return (
    <RiskShell
      title="Accountability audit trail"
      subtitle="Every sensitive action — training runs, predictions, consent changes, erasure — is recorded with actor, role and institution (DPDP §8(6))."
    >
      {error && <ErrorPanel message={error} />}
      {!logs ? (
        <LoadingPanel />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Recorded actions" value={logs.length} />
            <MetricCard label="Consent events" value={logs.filter((l) => l.action?.startsWith("consent")).length} tone="emerald" />
            <MetricCard label="Model actions" value={logs.filter((l) => ["fl.start", "fl.stop", "predict", "graph.seed"].includes(l.action)).length} tone="amber" />
          </section>
          <section className="rounded-2xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-4">Time</th>
                  <th>Action</th>
                  <th>Actor role</th>
                  <th>Institution</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id} className="border-b last:border-0">
                    <td className="p-4 text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="font-medium">{ACTION_LABELS[log.action] || log.action}</td>
                    <td className="capitalize">{log.role}</td>
                    <td>{log.institutionId == null ? "—" : `Bank ${log.institutionId}`}</td>
                    <td className="max-w-48 truncate font-mono text-xs">{log.target || "—"}</td>
                  </tr>
                ))}
                {!logs.length && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      No audited actions yet — start an FL run or toggle a consent to generate entries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </RiskShell>
  );
}

export default function AuditPage() {
  return (
    <ProtectedRoute allowedRoles={["analyst", "admin"]}>
      <AuditView />
    </ProtectedRoute>
  );
}
