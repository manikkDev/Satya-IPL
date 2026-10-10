"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import RiskShell, { ErrorPanel, LoadingPanel, MetricCard } from "@/components/risk/RiskShell";
import { api } from "@/lib/api";

const percent = (value, digits = 1) => value == null ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;

function CustomerInvestigation() {
  const { id } = useParams();
  const customerId = String(id || "");
  const [detail, setDetail] = useState(null);
  const [neighbors, setNeighbors] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customerId) return;
    setError("");
    Promise.all([
      api.fl.customer(customerId, { dataset: "paysim_banks", run_id: "latest" }),
      api.graph.neighbors(customerId).catch(() => ({ neighbors: [] })),
    ])
      .then(([customer, graph]) => {
        setDetail(customer);
        setNeighbors(graph.neighbors || []);
      })
      .catch((reason) => setError(reason.message));
  }, [customerId]);

  if (error) {
    return (
      <RiskShell title="Customer investigation" subtitle="Institution-scoped risk review">
        <ErrorPanel message={error} />
        <Link href="/analyst" className="inline-flex rounded-xl border px-4 py-2 text-sm">Return to portfolio</Link>
      </RiskShell>
    );
  }

  if (!detail) {
    return (
      <RiskShell title="Customer investigation" subtitle="Institution-scoped risk review">
        <LoadingPanel />
      </RiskShell>
    );
  }

  const row = detail.transaction;
  const explanation = detail.explanation || [];
  const highRing = row.risk_band === "high" && neighbors.length >= 3;
  const action = highRing
    ? "Escalate for enhanced manual review; graph proximity is supporting evidence, not proof."
    : row.risk_band === "high"
      ? "Perform manual transaction review and verify recent account activity."
      : row.risk_band === "medium"
        ? "Apply step-up verification if other institution policy signals agree."
        : "Continue standard monitoring; no automated adverse action is recommended.";

  return (
    <RiskShell
      title="Customer investigation"
      subtitle={`Authorized pseudonymous account ${customerId.slice(0, 18)}… · model run ${detail.run_id}`}
    >
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Risk percentile" value={percent(row.score)} tone={row.risk_band === "high" ? "rose" : row.risk_band === "medium" ? "amber" : "emerald"} detail={`${row.risk_band} relative band`} />
        <MetricCard label="Calibrated probability" value={percent(row.probability, 2)} detail="Not the displayed percentile" />
        <MetricCard label="Transactions reviewed" value={detail.transactions_reviewed} detail="Same pseudonymous account" />
        <MetricCard label="Derived neighbors" value={neighbors.length} tone="emerald" detail="Current graph snapshot" />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Model evidence</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Feature occlusion measures how the calibrated probability changes when one standardized feature is neutralized. It is supporting evidence, not a causal explanation.
          </p>
          <div className="mt-5 space-y-3">
            {explanation.map((item) => (
              <div key={item.feature} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium">{item.feature.replaceAll("_", " ")}</span>
                  <span className={item.contribution >= 0 ? "text-rose-600" : "text-emerald-600"}>
                    {item.contribution >= 0 ? "+" : ""}{Number(item.contribution).toFixed(4)} probability
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${item.contribution >= 0 ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, 8 + Math.abs(item.contribution) * 500)}%` }}
                  />
                </div>
              </div>
            ))}
            {!explanation.length && <p className="text-sm text-muted-foreground">No explanation artifact is available for this model run.</p>}
          </div>
        </article>

        <div className="space-y-5">
          <article className="rounded-2xl border bg-card p-6">
            <h2 className="text-xl font-semibold">Reviewed transaction</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Type</dt><dd>{row.type}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Amount</dt><dd>₹{Number(row.amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Hour bucket</dt><dd>{row.hour}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Institution</dt><dd>Bank {row.institution_id}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Amount/balance ratio</dt><dd>{Number(row.amt_to_bal_ratio || 0).toFixed(3)}</dd></div>
            </dl>
          </article>

          <article className="rounded-2xl border bg-card p-6">
            <h2 className="text-xl font-semibold">Graph context</h2>
            <ul className="mt-4 max-h-48 space-y-2 overflow-auto text-xs">
              {neighbors.slice(0, 12).map((neighbor) => (
                <li key={neighbor.id} className="flex justify-between gap-4 rounded-lg border p-2 font-mono">
                  <span>{String(neighbor.id).slice(0, 14)}…</span>
                  <span>{percent(neighbor.score, 0)} · {neighbor.n_tx} tx</span>
                </li>
              ))}
              {!neighbors.length && <li className="text-sm text-muted-foreground">No authorized derived neighbors are available.</li>}
            </ul>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-indigo-600">Recommended human workflow</p>
        <p className="mt-2 font-medium">{action}</p>
        <p className="mt-2 text-sm text-muted-foreground">A model score or graph connection must never be the sole basis for an adverse customer decision.</p>
        <Link href={`/chat?mode=risk_analyst&customer=${encodeURIComponent(customerId)}`} className="mt-4 inline-flex rounded-xl border px-4 py-2 text-sm">
          Ask the risk copilot about this account
        </Link>
      </section>
    </RiskShell>
  );
}

export default function CustomerPage() {
  return (
    <ProtectedRoute allowedRoles={["analyst", "admin"]}>
      <CustomerInvestigation />
    </ProtectedRoute>
  );
}
