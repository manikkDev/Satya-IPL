"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrendingUp, AlertOctagon, ShieldAlert, ArrowRight, Activity, HelpCircle } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, money, type PredictiveRiskView, type PredictiveRiskCase } from "@/lib/business-api";

export default function PredictiveRiskPage() {
  const [data, setData] = useState<PredictiveRiskView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCase, setSelectedCase] = useState<PredictiveRiskCase | null>(null);

  useEffect(() => {
    businessApi.predictiveRisk()
      .then((res) => {
        setData(res);
        if (res.cases?.length > 0) {
          setSelectedCase(res.cases[0]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const summary = data?.summary;
  const cases = data?.cases || [];

  return (
    <BusinessShell
      title="Predictive risk & survival analysis"
      subtitle="Defensible expected loss calibration and Cox proportional hazards time-to-breach modeling."
    >
      <State error={error} loading={loading} />

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* ── Executive Metric Summary ─────────────────────────────── */}
          <div className="satya-metric-grid satya-money-grid">
            <article className="satya-metric">
              <div>
                <span>Total expected loss (R_i)</span>
                <TrendingUp size={20} />
              </div>
              <strong>{money(summary?.totalExpectedLoss, "INR")}</strong>
              <p>Calibrated loss across {summary?.totalCasesAnalyzed} open cases</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Total exposure at risk</span>
                <ShieldAlert size={20} />
              </div>
              <strong>{money(summary?.totalExposureUnderRisk, "INR")}</strong>
              <p>Maximum possible disputed & open impact</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Average hazard ratio</span>
                <Activity size={20} />
              </div>
              <strong>{summary?.averageHazardRatio}×</strong>
              <p>Relative to standard low-risk baseline</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Critical urgency cases</span>
                <AlertOctagon size={20} />
              </div>
              <strong>{summary?.criticalCasesCount}</strong>
              <p>Hazard ratio &gt; 2.0; immediate intervention</p>
            </article>
          </div>

          {/* ── Statistical Methodology Note ─────────────────────────── */}
          <div
            style={{
              padding: "1rem 1.25rem",
              background: "rgba(14, 165, 233, 0.08)",
              border: "1px solid #0284c7",
              borderRadius: "8px",
              fontSize: "0.875rem"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem", fontWeight: 600 }}>
              <HelpCircle size={18} className="text-sky-600" />
              <span>Statistical Formulation &amp; Calibration Architecture</span>
            </div>
            <p style={{ margin: 0, color: "var(--foreground)" }}>
              <strong>Algorithm E (Stage 2 Expected Loss):</strong> Computed continuously as{" "}
              <code>R_i = P(Breach = 1 | X_i) × I_i</code>, where <code>I_i</code> is financial impact and{" "}
              <code>P(Breach = 1 | X_i)</code> is calibrated via multi-factor logistic sigmoid.
              <br />
              <strong>Algorithm F (Survival Analysis):</strong> Semi-parametric Cox Proportional Hazards model{" "}
              <code>h(t) = h_0(t) exp(β · X)</code> estimating median days to breach and empirical survival probability{" "}
              <code>S(t)</code> across 7, 14, 30, 45, and 60 day windows.
            </p>
          </div>

          {/* ── Ranked Case Risk Table ───────────────────────────────── */}
          <Panel
            title={`Ranked case risk & expected loss (${cases.length})`}
            detail="Ranked by expected loss R_i descending. Click any case row to inspect its feature decomposition."
          >
            <div className="satya-table-wrap">
              <table className="satya-table">
                <thead>
                  <tr>
                    <th>Order / Case</th>
                    <th>Supplier</th>
                    <th>Disputed impact (I_i)</th>
                    <th>Breach prob. P(Y=1)</th>
                    <th>Expected loss (R_i)</th>
                    <th>Hazard ratio</th>
                    <th>Median breach</th>
                    <th>Urgency</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => {
                    const isSelected = selectedCase?.caseId === c.caseId;
                    return (
                      <tr
                        key={c.caseId}
                        onClick={() => setSelectedCase(c)}
                        style={{
                          cursor: "pointer",
                          backgroundColor: isSelected ? "rgba(14, 165, 233, 0.12)" : undefined
                        }}
                      >
                        <td>
                          <strong>{c.poId}</strong>
                        </td>
                        <td>{c.supplier}</td>
                        <td>{money(c.financialImpact, c.currency)}</td>
                        <td>
                          <span style={{ fontWeight: 600 }}>
                            {(c.probabilityOfBreach * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td>
                          <strong style={{ color: "#dc2626" }}>
                            {money(c.expectedLoss, c.currency)}
                          </strong>
                        </td>
                        <td>
                          <strong>{c.hazardRatio.toFixed(2)}×</strong>
                        </td>
                        <td>
                          {c.medianDaysToBreach} days
                        </td>
                        <td>
                          <span
                            className={`satya-status ${
                              c.urgencyLevel === "CRITICAL"
                                ? "review"
                                : c.urgencyLevel === "ELEVATED"
                                ? "info"
                                : "ok"
                            }`}
                          >
                            {c.urgencyLevel}
                          </span>
                        </td>
                        <td>
                          <Link href={`/cases/${c.caseId}`} className="satya-evidence-chip">
                            Investigate <ArrowRight size={14} className="inline ml-1" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Survival Projections S(t) Table ───────────────────────── */}
          <Panel
            title="Longitudinal survival projections S(t) across horizons"
            detail="Estimated probability that the dispute or breach has not yet occurred at day t. Steeper decay signals severe operational bottleneck."
          >
            <div className="satya-table-wrap">
              <table className="satya-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Supplier</th>
                    <th>Hazard ratio</th>
                    <th>Day 7 S(7)</th>
                    <th>Day 14 S(14)</th>
                    <th>Day 30 S(30)</th>
                    <th>Day 45 S(45)</th>
                    <th>Day 60 S(60)</th>
                    <th>Intervention window</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => {
                    const s7 = c.survivalCurve.find((s) => s.day === 7)?.survivalProbability || 0;
                    const s14 = c.survivalCurve.find((s) => s.day === 14)?.survivalProbability || 0;
                    const s30 = c.survivalCurve.find((s) => s.day === 30)?.survivalProbability || 0;
                    const s45 = c.survivalCurve.find((s) => s.day === 45)?.survivalProbability || 0;
                    const s60 = c.survivalCurve.find((s) => s.day === 60)?.survivalProbability || 0;

                    return (
                      <tr key={c.caseId}>
                        <td><strong>{c.poId}</strong></td>
                        <td>{c.supplier}</td>
                        <td>{c.hazardRatio}×</td>
                        <td>
                          <span style={{ color: s7 > 0.7 ? "#16a34a" : "#dc2626" }}>
                            {(s7 * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <span style={{ color: s14 > 0.5 ? "#16a34a" : "#dc2626" }}>
                            {(s14 * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <span style={{ color: s30 > 0.3 ? "#f59e0b" : "#dc2626" }}>
                            {(s30 * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <span style={{ color: s45 > 0.2 ? "#f59e0b" : "#dc2626" }}>
                            {(s45 * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <span style={{ color: s60 > 0.1 ? "#6b7280" : "#dc2626" }}>
                            {(s60 * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <span className="satya-tag">
                            Within {c.recommendedInterventionDays} days
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Feature Decomposition for Selected Case ──────────────── */}
          {selectedCase && (
            <Panel
              title={`Risk feature decomposition for ${selectedCase.poId} (${selectedCase.supplier})`}
              detail="Relative contribution of empirical risk features to the log-odds linear predictor β · X."
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>Blocking findings</span>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
                    {selectedCase.riskFeatureDecomposition.blockingFindings.count}
                  </div>
                  <small style={{ color: "#dc2626" }}>
                    β-contribution: +{selectedCase.riskFeatureDecomposition.blockingFindings.contribution}
                  </small>
                </div>

                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>Duplicate invoices</span>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
                    {selectedCase.riskFeatureDecomposition.duplicateInvoices.count}
                  </div>
                  <small style={{ color: "#dc2626" }}>
                    β-contribution: +{selectedCase.riskFeatureDecomposition.duplicateInvoices.contribution}
                  </small>
                </div>

                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>Delivery shortfall</span>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
                    {selectedCase.riskFeatureDecomposition.deliveryShortfall.ratio}
                  </div>
                  <small style={{ color: "#dc2626" }}>
                    β-contribution: +{selectedCase.riskFeatureDecomposition.deliveryShortfall.contribution}
                  </small>
                </div>

                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>Unallocated payments</span>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
                    {selectedCase.riskFeatureDecomposition.unallocatedPayments.count}
                  </div>
                  <small style={{ color: "#dc2626" }}>
                    β-contribution: +{selectedCase.riskFeatureDecomposition.unallocatedPayments.contribution}
                  </small>
                </div>

                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "6px" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>Case aging</span>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
                    {selectedCase.riskFeatureDecomposition.caseAgingDays.days} days
                  </div>
                  <small style={{ color: "#f59e0b" }}>
                    β-contribution: +{selectedCase.riskFeatureDecomposition.caseAgingDays.contribution}
                  </small>
                </div>
              </div>
            </Panel>
          )}
        </div>
      )}
    </BusinessShell>
  );
}
