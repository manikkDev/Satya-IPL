"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import RiskShell, { ErrorPanel, LoadingPanel } from "@/components/risk/RiskShell";
import { api } from "@/lib/api";

const pct = (v) => `${(v * 100).toFixed(0)}`;

function ScoringDisabled() {
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 text-center">
      <p className="text-xl font-semibold">Risk scoring is paused for your account</p>
      <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
        You withdrew consent for <em>risk scoring</em>, so the model no longer evaluates your transactions. Your raw data
        never left your institution, and this withdrawal is recorded in the audit trail. Re-enable it anytime from the
        consent center.
      </p>
      <Link href="/citizen/consent" className="mt-5 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white">
        Manage consent →
      </Link>
    </section>
  );
}

function Profile() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.fl.citizen().then(setProfile).catch((reason) => setError(reason.message));
  }, []);
  return (
    <RiskShell
      role="citizen"
      title="Your financial risk profile"
      subtitle="A privacy-preserving explanation based on the current federated model. Your raw financial history stays with your institution."
    >
      {error && <ErrorPanel message={error} />}
      {!profile ? (
        <LoadingPanel />
      ) : profile.scoring_disabled ? (
        <ScoringDisabled />
      ) : (
        <>
          <section className="grid gap-5 lg:grid-cols-[340px_1fr]">
            <div className="rounded-2xl border bg-card p-8 text-center">
              <div
                className={`mx-auto flex h-48 w-48 items-center justify-center rounded-full border-[14px] ${
                  profile.risk_band === "high" ? "border-rose-500" : profile.risk_band === "medium" ? "border-amber-500" : "border-emerald-500"
                }`}
              >
                <div>
                  <p className="text-4xl font-semibold">{pct(profile.score)}</p>
                  <p className="text-sm uppercase tracking-wider text-muted-foreground">risk percentile</p>
                </div>
              </div>
              <p className="mt-5 text-xl font-medium capitalize">{profile.risk_band} risk band</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">Account {profile.pseudonymous_account?.slice(0, 16)}…</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Calibrated probability {(profile.probability * 100).toFixed(2)}% · the percentile compares you to all scored transactions.
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-6">
              <h2 className="text-xl font-semibold">Why the model produced this score</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Signed feature contributions on your riskiest reviewed transaction ({profile.facts?.transaction_type}, ₹
                {Math.round(profile.facts?.amount || 0).toLocaleString("en-IN")}, hour {profile.facts?.hour}) — not a black-box verdict.
              </p>
              <div className="mt-6 space-y-3">
                {(profile.explanation || []).slice(0, 6).map((item) => (
                  <div key={item.feature}>
                    <div className="flex justify-between text-sm">
                      <span>{item.feature.replaceAll("_", " ")}</span>
                      <span className={item.contribution >= 0 ? "text-rose-600" : "text-emerald-600"}>{item.direction}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${item.contribution >= 0 ? "bg-rose-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, 15 + Math.abs(item.contribution) * 35)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border bg-card p-6">
              <h2 className="text-xl font-semibold">Practical next steps</h2>
              <ul className="mt-4 space-y-3 text-sm">
                {(profile.guidance || []).map((tip) => (
                  <li key={tip} className="flex gap-3">
                    <span className="text-emerald-600">✓</span>
                    {tip}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-muted-foreground">{profile.disclaimer}</p>
            </div>
            <div className="rounded-2xl border bg-card p-6">
              <h2 className="text-xl font-semibold">Your privacy controls</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Explicit risk-scoring consent is enforced now. Other purpose choices are recorded for the research prototype and require data-pipeline enforcement before production use.
              </p>
              <div className="mt-5 flex gap-3">
                <Link href="/citizen/consent" className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white">
                  Manage consent
                </Link>
                <Link href="/chat?mode=risk_citizen" className="rounded-xl border px-4 py-3 text-sm">
                  Ask the copilot
                </Link>
              </div>
            </div>
          </section>
        </>
      )}
    </RiskShell>
  );
}

export default function CitizenPage() {
  return (
    <ProtectedRoute allowedRoles={["citizen", "admin"]}>
      <Profile />
    </ProtectedRoute>
  );
}
