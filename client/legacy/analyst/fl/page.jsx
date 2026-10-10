"use client";

import { useEffect, useRef, useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import RiskShell, { ErrorPanel, LoadingPanel, MetricCard } from "@/components/risk/RiskShell";
import { Term } from "@/components/risk/Term";
import { api } from "@/lib/api";

const pct = (value) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);

function Convergence({ rounds = [], isolated, centralized, metric = "pr_auc" }) {
  const width = 600;
  const height = 240;
  const x = (index) => 20 + (index * (width - 40)) / Math.max(1, rounds.length - 1);
  const y = (value) => height - 20 - (value || 0) * (height - 50);
  const points = rounds.map((entry, index) => `${x(index)},${y(entry.global?.[metric])}`).join(" ");
  return (
    <div className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Live {metric === "pr_auc" ? <Term id="pr-auc">PR-AUC</Term> : <Term id="roc-auc">ROC-AUC</Term>} convergence</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-64 w-full">
        <line x1="20" y1={height - 20} x2={width - 20} y2={height - 20} stroke="currentColor" opacity=".2" />
        <line x1="20" y1="30" x2="20" y2={height - 20} stroke="currentColor" opacity=".2" />
        {isolated != null && (
          <g>
            <line x1="20" y1={y(isolated)} x2={width - 20} y2={y(isolated)} stroke="#f59e0b" strokeDasharray="6 6" />
            <text x={width - 130} y={y(isolated) - 6} fill="#f59e0b" fontSize="11">isolated mean</text>
          </g>
        )}
        {centralized != null && (
          <g>
            <line x1="20" y1={y(centralized)} x2={width - 20} y2={y(centralized)} stroke="#10b981" strokeDasharray="6 6" />
            <text x={width - 130} y={y(centralized) - 6} fill="#10b981" fontSize="11">pooled ceiling</text>
          </g>
        )}
        <polyline fill="none" stroke="#4f46e5" strokeWidth="3" points={points} />
        {rounds.map((entry, index) => (
          <circle key={entry.round} cx={x(index)} cy={y(entry.global?.[metric])} r="4" fill="#4f46e5">
            <title>{`round ${entry.round}: ${pct(entry.global?.[metric])}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function ClientBars({ clients = {} }) {
  const entries = Object.entries(clients);
  if (!entries.length) return null;
  return (
    <div className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Per-bank validation this round</h2>
      <p className="mt-1 text-xs text-muted-foreground">Non-IID spread — the same global model scored on each bank's own validation slice.</p>
      <div className="mt-4 space-y-3">
        {entries.map(([client, m]) => (
          <div key={client}>
            <div className="flex justify-between text-xs">
              <span>Bank {client}</span>
              <span>PR-AUC {pct(m.val_pr_auc)} · Δ‖{Number(m.update_norm ?? 0).toFixed(2)}‖</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (m.val_pr_auc || 0) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunHistory({ runs = [], activeId }) {
  if (!runs.length) return null;
  return (
    <div className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Run history</h2>
      <div className="mt-3 max-h-56 space-y-2 overflow-auto text-xs">
        {runs.map((run) => (
          <div key={run.run_id} className={`flex items-center justify-between rounded-lg border p-2 ${run.run_id === activeId ? "border-indigo-500" : ""}`}>
            <div>
              <p className="font-mono">{run.run_id}</p>
              <p className="text-muted-foreground">
                {run.engine === "flower-1.20-simulation" ? "flower" : "local"} · {run.config?.strategy} · {run.config?.["num-server-rounds"]}r{run.config?.["dp-enabled"] ? ` · DP ε${run.epsilon?.toFixed?.(1) ?? ""}` : ""}
              </p>
            </div>
            <span className="font-medium">{pct(run.final?.pr_auc)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerticalShowcase({ vfl }) {
  if (!vfl) return null;
  const rows = [
    { label: "Bank-only model (single institution)", value: vfl.bank_only_pr_auc, color: "#f59e0b", note: "one party's features alone" },
    { label: "Vertical split-NN (3 parties)", value: vfl.vfl_pr_auc, color: "#6366f1", note: `+${((vfl.vfl_pr_auc_gain || 0) * 100).toFixed(1)} pts` },
    { label: "Centralized pooled reference", value: vfl.centralized_pooled_reference_pr_auc, color: "#10b981", note: "NOT deployable — pools raw data" },
  ];
  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Vertical federated learning — split neural network</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Different institutions hold <em>different feature slices</em> for the same customer. After private-set
            intersection aligns {vfl.aligned_n?.toLocaleString?.() ?? vfl.aligned_n} pseudonymous accounts, each party trains a
            bottom network; only embeddings and their gradients cross the boundary — never raw features, and labels
            stay with the label holder. Educational single-process simulation: {vfl.protocol}
          </p>
        </div>
        <div className="rounded-lg bg-muted px-3 py-2 text-right text-xs">
          <p>boundary crossings: <span className="font-mono">{vfl.communication?.boundary_crossings}</span></p>
          <p>raw features exchanged: <span className="font-mono text-emerald-600">{vfl.communication?.raw_feature_values_exchanged}</span></p>
          <p>labels shared with feature parties: <span className="font-mono text-emerald-600">{vfl.communication?.labels_shared_with_feature_parties}</span></p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex justify-between text-xs">
              <span>{row.label}</span>
              <span className="text-muted-foreground">PR-AUC {pct(row.value)} · {row.note}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (row.value || 0) * 100)}%`, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{vfl.notes}</p>
    </section>
  );
}

function ControlPanel() {
  const [config, setConfig] = useState({
    engine: "flower",
    strategy: "fedprox",
    rounds: 8,
    local_epochs: 1,
    fraction_train: 1.0,
    dp_enabled: false,
    dp_mode: "noise",
    dp_noise_multiplier: 0.45,
    dp_clipping_norm: 2.0,
    target_epsilon: 8.0,
    secagg_enabled: true,
  });
  const [epsilon, setEpsilon] = useState(null);
  const [summary, setSummary] = useState(null);
  const [runs, setRuns] = useState([]);
  const [status, setStatus] = useState(null);
  const [runId, setRunId] = useState("");
  const [error, setError] = useState("");
  const polling = useRef(null);

  const latestRounds = status?.rounds || [];
  const privacy = latestRounds.at(-1)?.privacy || status?.final?.privacy;
  const lastClients = latestRounds.at(-1)?.clients;

  useEffect(() => {
    api.fl.summary().then(setSummary).catch(() => {});
    api.fl.runs().then(setRuns).catch(() => {});
  }, []);

  useEffect(() => {
    if (!config.dp_enabled) return setEpsilon(null);
    const noise = config.dp_mode === "target" ? undefined : config.dp_noise_multiplier;
    api.fl
      .epsilon(noise ?? 0.45, config.rounds, config.dp_mode === "target" ? config.target_epsilon : undefined)
      .then(setEpsilon)
      .catch(() => {});
  }, [config.dp_enabled, config.dp_mode, config.dp_noise_multiplier, config.target_epsilon, config.rounds]);

  useEffect(() => {
    if (!runId) return;
    const tick = () => api.fl.status(runId).then(setStatus).catch(() => {});
    tick();
    polling.current = setInterval(tick, 1500);
    return () => clearInterval(polling.current);
  }, [runId]);

  const start = async () => {
    setError("");
    try {
      const body = {
        engine: config.engine,
        strategy: config.strategy,
        rounds: config.rounds,
        local_epochs: config.local_epochs,
        fraction_train: config.fraction_train,
        dp_enabled: config.dp_enabled,
        dp_noise_multiplier: config.dp_noise_multiplier,
        dp_clipping_norm: config.dp_clipping_norm,
        target_epsilon: config.dp_enabled && config.dp_mode === "target" ? config.target_epsilon : null,
        secagg_enabled: config.secagg_enabled,
      };
      const result = await api.fl.start(body);
      setRunId(result.run_id);
      setStatus({ status: "running", rounds: [] });
    } catch (reason) {
      setError(reason.message);
    }
  };

  return (
    <RiskShell
      title="Federated learning control"
      subtitle="Five research partitions benchmark federated strategies. Choose the Flower engine for process-isolated clients with real SecAgg+, or the in-process runner for fast experiments."
    >
      {error && <ErrorPanel message={error} />}
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Run status" value={status?.status || (runId ? "starting" : "ready")} detail={runId || "Configure a run below"} />
        <MetricCard
          label={<Term id="pr-auc">Current PR-AUC</Term>}
          value={pct(latestRounds.at(-1)?.global?.pr_auc || status?.final?.final?.pr_auc)}
          detail={`${latestRounds.length}/${config.rounds} rounds`}
          tone="emerald"
        />
        <MetricCard
          label={<Term id="dp-epsilon">Privacy ε</Term>}
          value={config.dp_enabled ? (privacy?.epsilon?.toFixed(2) || epsilon?.epsilon?.toFixed(2) || "—") : "Off"}
          detail={config.dp_enabled ? `δ=1e-5 · noise ${(privacy?.noise_multiplier ?? config.dp_noise_multiplier).toFixed(2)}` : "enable DP below"}
          tone="amber"
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="text-lg font-semibold">Run configuration</h2>
            <div className="mt-5 space-y-4 text-sm">
              <label className="block">
                Execution engine
                <select className="mt-1 w-full rounded-lg border bg-background p-2" value={config.engine} onChange={(e) => setConfig({ ...config, engine: e.target.value })}>
                  <option value="flower">Flower — isolated client processes</option>
                  <option value="local">In-process runner (fast dev loop)</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {config.engine === "flower"
                    ? "Each bank trains in a separate Ray actor; the coordinator only receives the masked aggregate (real SecAgg+)."
                    : "All partitions run in one Python process for speed — usable for experiments, not a privacy guarantee."}
                </p>
              </label>
              <label className="block">
                Strategy
                <select className="mt-1 w-full rounded-lg border bg-background p-2" value={config.strategy} onChange={(e) => setConfig({ ...config, strategy: e.target.value })}>
                  <option value="fedavg">FedAvg</option>
                  <option value="fedprox">FedProx</option>
                  <option value="fedadam">FedAdam (adaptive server)</option>
                </select>
              </label>
              <label className="block">
                Rounds: {config.rounds}
                <input className="mt-2 w-full" type="range" min="2" max="20" value={config.rounds} onChange={(e) => setConfig({ ...config, rounds: Number(e.target.value) })} />
              </label>
              <label className="block">
                Client participation: {Math.round(config.fraction_train * 100)}%
                <input className="mt-2 w-full" type="range" min="0.4" max="1" step="0.2" value={config.fraction_train} onChange={(e) => setConfig({ ...config, fraction_train: Number(e.target.value) })} />
              </label>
              <label className="flex items-center justify-between">
                Differential privacy
                <input type="checkbox" checked={config.dp_enabled} onChange={(e) => setConfig({ ...config, dp_enabled: e.target.checked })} />
              </label>
              {config.dp_enabled && (
                <div className="space-y-3 rounded-xl border p-3">
                  <label className="block">
                    ε budget mode
                    <select className="mt-1 w-full rounded-lg border bg-background p-2 text-xs" value={config.dp_mode} onChange={(e) => setConfig({ ...config, dp_mode: e.target.value })}>
                      <option value="noise">fix noise multiplier</option>
                      <option value="target">target ε (auto noise)</option>
                    </select>
                  </label>
                  {config.dp_mode === "target" ? (
                    <label className="block">
                      Target ε: {config.target_epsilon}
                      <input className="mt-2 w-full" type="range" min="1" max="100" step="1" value={config.target_epsilon} onChange={(e) => setConfig({ ...config, target_epsilon: Number(e.target.value) })} />
                    </label>
                  ) : (
                    <label className="block">
                      Noise multiplier: {config.dp_noise_multiplier}
                      <input className="mt-2 w-full" type="range" min="0.2" max="3" step="0.05" value={config.dp_noise_multiplier} onChange={(e) => setConfig({ ...config, dp_noise_multiplier: Number(e.target.value) })} />
                    </label>
                  )}
                  <label className="block">
                    Clipping norm: {config.dp_clipping_norm}
                    <input className="mt-2 w-full" type="range" min="0.5" max="6" step="0.25" value={config.dp_clipping_norm} onChange={(e) => setConfig({ ...config, dp_clipping_norm: Number(e.target.value) })} />
                  </label>
                </div>
              )}
              <label className="flex items-center justify-between">
                <span>
                  Secure aggregation{" "}
                  <span className="text-xs text-muted-foreground">
                    ({config.engine === "flower" ? "real SecAgg+ protocol" : "simulated pairwise masks"})
                  </span>
                </span>
                <input type="checkbox" checked={config.secagg_enabled} onChange={(e) => setConfig({ ...config, secagg_enabled: e.target.checked })} />
              </label>
              {config.engine === "flower" && config.strategy === "fedadam" && config.secagg_enabled && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  FedAdam is disabled under SecAgg+ — the protocol already reconstructs the weighted mean, so the server would apply FedAvg instead.
                </p>
              )}
              <button onClick={start} disabled={status?.status === "running"} className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white disabled:opacity-50">
                {status?.status === "running" ? "Training…" : "Start five-bank training"}
              </button>
              {status?.status === "running" && (
                <button onClick={() => api.fl.stop(runId)} className="w-full rounded-xl border px-4 py-2">
                  Stop run
                </button>
              )}
            </div>
            <div className="mt-6 grid grid-cols-5 gap-2">
              {[0, 1, 2, 3, 4].map((bank) => (
                <div key={bank} className={`rounded-lg p-2 text-center text-xs ${lastClients?.[String(bank)] ? "bg-indigo-500/10" : "bg-muted"}`}>
                  Bank {bank}
                  <br />
                  <span className="text-amber-600">research partition</span>
                </div>
              ))}
            </div>
          </div>
          <RunHistory runs={runs} activeId={runId} />
        </div>
        <div className="space-y-5">
          <Convergence rounds={latestRounds} isolated={summary?.baselines?.isolated_mlp_mean?.pr_auc} centralized={summary?.baselines?.centralized_mlp?.pr_auc} />
          <ClientBars clients={lastClients} />
        </div>
      </section>

      <VerticalShowcase vfl={summary?.vfl} />
    </RiskShell>
  );
}

export default function FederatedLearningPage() {
  return (
    <ProtectedRoute allowedRoles={["analyst", "admin"]}>
      <ControlPanel />
    </ProtectedRoute>
  );
}
