"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import RiskShell, { ErrorPanel, LoadingPanel, MetricCard } from "@/components/risk/RiskShell";
import { Term } from "@/components/risk/Term";
import { api } from "@/lib/api";

const percent = (value) => (value == null ? "—" : `${(value * 100).toFixed(2)}%`);

function ComparisonBars({ baselines, latest }) {
  if (!baselines) return null;
  const entries = [
    { label: "Isolated banks (residual MLP, same class)", value: baselines.isolated_mlp_mean?.pr_auc, color: "#f59e0b", note: "each bank alone" },
    { label: "Federated — this deployment", value: latest?.final?.pr_auc, color: "#6366f1", note: latest?.config?.strategy || "fedprox" },
    { label: "Centralized residual MLP (pooled, same class)", value: baselines.centralized_mlp?.pr_auc, color: "#10b981", note: "reference only" },
    { label: "Centralized XGBoost ceiling", value: baselines.centralized?.pr_auc, color: "#0ea5e9", note: "not deployable" },
  ];
  return (
    <div className="rounded-2xl border bg-card p-6">
      <h2 className="text-xl font-semibold">Isolated vs federated vs pooled — PR-AUC</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Same-model-class comparison measures the seeded benchmark gain; the XGBoost line is a non-deployable pooled research reference.
      </p>
      <div className="mt-6 space-y-4">
        {entries.map((entry) => (
          <div key={entry.label}>
            <div className="flex justify-between text-sm">
              <span>{entry.label}</span>
              <span className="font-medium">{percent(entry.value)}</span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (entry.value || 0) * 100)}%`, background: entry.color }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api.fl.summary(),
      api.fl.customers({ dataset: "paysim_banks", run_id: "latest", n: "20" }),
    ])
      .then(([model, portfolio]) => {
        setSummary(model);
        setCustomers(portfolio.rows || []);
      })
      .catch((reason) => setError(reason.message));
  }, []);

  if (error)
    return (
      <RiskShell title="Bank risk command center" subtitle="Federated portfolio intelligence for your institution.">
        <ErrorPanel message={`${error}. Run the demo seed command from the setup guide.`} />
      </RiskShell>
    );
  if (!summary)
    return (
      <RiskShell title="Bank risk command center" subtitle="Federated portfolio intelligence for your institution.">
        <LoadingPanel />
      </RiskShell>
    );

  const baseline = summary.baselines;
  const latest = summary.latest;
  const privacy = latest?.privacy || {};
  const highRisk = customers.filter((row) => row.risk_band === "high").length;

  return (
    <RiskShell
      title="Bank risk command center"
      subtitle="Compare isolated, pooled and federated research artifacts with explicit model, sampling and privacy limitations."
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={<Term id="pr-auc">Latest FL PR-AUC</Term>} value={percent(latest?.final?.pr_auc)} detail={latest?.run_id || "No run"} />
        <MetricCard label="Centralized MLP (pooled)" value={percent(baseline?.centralized_mlp?.pr_auc)} detail="Same-class pooled reference" tone="emerald" />
        <MetricCard label="Isolated-bank MLP mean" value={percent(baseline?.isolated_mlp_mean?.pr_auc)} detail="Each bank training alone" tone="amber" />
        <MetricCard
          label={<Term id="dp-epsilon">Privacy posture</Term>}
          value={privacy.dp_enabled ? `ε ${privacy.epsilon?.toFixed(1) ?? "—"}` : "DP off"}
          detail={
            privacy.secagg_mode === "flower_secaggplus"
              ? "real SecAgg+ (Flower)"
              : privacy.secagg
                ? "pairwise-mask simulation — not production SecAgg"
                : "plain averaging"
          }
          tone="rose"
        />
      </section>

      <ComparisonBars baselines={baseline} latest={latest} />

      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Priority review queue</h2>
            <Link href="/analyst/graph" className="text-sm text-indigo-600">
              Investigate graph →
            </Link>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-3">Pseudonymous account</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {[...customers]
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 10)
                  .map((row) => (
                    <tr key={row.customer_id} className="border-t">
                      <td className="py-3 font-mono text-xs">
                        <Link href={`/analyst/customers/${row.customer_id}`}>{String(row.customer_id).slice(0, 12)}…</Link>
                      </td>
                      <td>{row.type}</td>
                      <td>₹{Number(row.amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td>
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            row.risk_band === "high"
                              ? "bg-rose-500/15 text-rose-700"
                              : row.risk_band === "medium"
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-emerald-500/15 text-emerald-700"
                          }`}
                        >
                          {percent(row.score)}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">This federated run</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt>Strategy</dt>
              <dd className="font-medium capitalize">{latest?.config?.strategy || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Rounds</dt>
              <dd>{latest?.config?.["num-server-rounds"] || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>High-risk in queue</dt>
              <dd>
                {highRisk}/{customers.length}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt><Term id="secagg">Aggregation</Term></dt>
              <dd>{privacy?.secagg_mode === "flower_secaggplus" ? "SecAgg+ (real)" : privacy?.secagg ? "Pairwise masks (simulated)" : "Weighted average"}</dd>
            </div>
            <div className="flex justify-between">
              <dt><Term id="dp-epsilon">DP ε</Term></dt>
              <dd>{latest?.epsilon ? `ε ${latest.epsilon.toFixed(2)} (δ=1e-5)` : "Non-private run"}</dd>
            </div>
            <div className="flex justify-between">
              <dt><Term id="ece">Calibration</Term></dt>
              <dd>{latest?.calibration ? `ECE ${latest.calibration.ece_after?.toFixed(3)} (T=${latest.calibration.temperature?.toFixed(2)})` : "—"}</dd>
            </div>
          </dl>
          <div className="mt-6 space-y-2">
            <Link href="/analyst/fl" className="block rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-medium text-white">
              Open FL control panel
            </Link>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/analyst/audit" className="rounded-xl border px-4 py-2.5 text-center text-sm">
                Audit log
              </Link>
              <Link href="/chat?mode=risk_analyst" className="rounded-xl border px-4 py-2.5 text-center text-sm">
                Ask the copilot
              </Link>
            </div>
          </div>
        </div>
      </section>
    </RiskShell>
  );
}

export default function AnalystDashboard() {
  return (
    <ProtectedRoute allowedRoles={["analyst", "admin"]}>
      <Dashboard />
    </ProtectedRoute>
  );
}
