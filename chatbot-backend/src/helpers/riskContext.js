import { ml } from "./mlClient.js";

const graphBase = () => process.env.GRAPH_API_URL || "http://localhost:5002";

const asUser = async (req, path) => {
  try {
    const response = await fetch(`${graphBase()}${path}`, {
      headers: { authorization: req.headers.authorization || "" },
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
};

const pct = (value) => (typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "n/a");

/** Latest consent state for a purpose: "granted" | "revoked" | "unset". */
export const consentState = (consentMe, purpose) => {
  const entry = (consentMe?.history || []).find((item) => item.purpose === purpose);
  if (!entry) return "unset";
  return entry.granted ? "granted" : "revoked";
};

export const fetchConsentMe = (req) => asUser(req, "/api/consent/me");
export const fetchProfile = (req) => asUser(req, "/api/auth/profile");

/**
 * Live platform context injected into the risk copilot's system prompt so it can
 * quote real run metrics instead of improvising. Called only for risk_* modes.
 */
export async function buildRiskContext(req, mode) {
  const lines = [
    "LIVE PLATFORM CONTEXT (authoritative — quote these figures verbatim, never invent others):",
  ];
  if (mode === "risk_analyst") {
    const [summary, campaigns, customers] = await Promise.all([
      ml.summary().catch(() => null),
      asUser(req, "/api/risk-graph/campaigns"),
      req.user?.institutionId != null
        ? ml.sample("paysim_banks", "latest", { n: 8, client_id: req.user.institutionId }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const latest = summary?.latest;
    lines.push(
      latest
        ? `- Active model: run "${latest.run_id}", strategy ${latest.config?.strategy}, ${latest.config?.["num-server-rounds"]} rounds, PR-AUC ${pct(latest.final?.pr_auc)}, ROC-AUC ${pct(latest.final?.roc_auc)}, ECE ${latest.calibration?.ece_after?.toFixed(3) ?? "n/a"}.`
        : "- No federated model has been trained yet.",
    );
    const baselines = summary?.baselines;
    if (baselines) {
      lines.push(`- Centralized ceiling (illegal pooled baseline): PR-AUC ${pct(baselines.centralized?.pr_auc)}; isolated-bank mean: ${pct(baselines.isolated_mean?.pr_auc)}; federated MLP same-class pooled: ${pct(baselines.centralized_mlp?.pr_auc)}.`);
    }
    lines.push(`- Institution scope: this analyst is scoped to Bank ${req.user?.institutionId}; only that bank's customers are visible — never reveal other banks' rows.`);
    if (campaigns?.length) {
      lines.push(`- Fraud-ring campaigns detected: ${campaigns.length}. Top: ${campaigns.slice(0, 3).map((c) => `${c.label} (size ${c.size}, avg risk ${(c.avg_score * 100).toFixed(0)}th pct)`).join("; ")}.`);
    }
    if (customers?.rows?.length) {
      const top = customers.rows.slice().sort((a, b) => b.score - a.score).slice(0, 3);
      lines.push(`- Highest-risk queued accounts for this institution: ${top.map((r) => `${String(r.customer_id).slice(0, 12)}… (${(r.score * 100).toFixed(0)}th pct, ${r.type}, ₹${Math.round(r.amount).toLocaleString("en-IN")})`).join("; ")}.`);
    }
  } else if (mode === "risk_citizen") {
    const profile = await fetchProfile(req);
    const ref = profile?.customerRef || req.user?.id;
    const consentMe = await fetchConsentMe(req);
    const scoringGranted = consentState(consentMe, "risk_scoring") === "granted";
    const citizen = scoringGranted && ref ? await ml.citizen(ref).catch(() => null) : null;
    if (!scoringGranted) {
      lines.push("- Risk scoring is disabled until the user explicitly grants risk_scoring consent.");
    }
    if (citizen) {
      lines.push(`- User's risk band: ${citizen.risk_band} (score ${(citizen.score * 100).toFixed(0)}th percentile of scored transactions).`);
      lines.push(`- Top feature contributions: ${(citizen.explanation || []).slice(0, 4).map((e) => `${e.feature.replaceAll("_", " ")} (${e.direction})`).join("; ")}.`);
      lines.push(`- Latest reviewed transaction: ${citizen.facts?.transaction_type}, ₹${Math.round(citizen.facts?.amount || 0).toLocaleString("en-IN")}.`);
    }
    if (consentMe) {
      lines.push(`- Consent state: ${Object.entries(consentMe.purposes || {}).map(([k, v]) => `${k}=${v === null ? "unset" : v ? "granted" : "revoked"}`).join(", ") || "none recorded"}.`);
    }
    lines.push("- The user can exercise DPDP rights (access, correction, erasure, consent withdrawal) from the consent center.");
  }
  return lines.join("\n");
}
