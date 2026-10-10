"use client";

/**
 * PatternResult – Unified pattern classification display
 *
 * Works for both AML (P1-P6, family: "aml") and
 * digital threat (T1-T6, family: "digital_threat") results.
 * Accepts either the legacy AML classifier shape or the new unified shape.
 */

// ─── Pattern metadata (mirrors patternRegistry on the frontend) ───
const PATTERN_META = {
  // AML
  P1: { color: "#6aa9ff", icon: "↺", family: "aml", name: "Round Trip" },
  P2: { color: "#8c5cff", icon: "♻", family: "aml", name: "Loan Evergreening" },
  P3: { color: "#ff9f6b", icon: "📦", family: "aml", name: "Invoice Fraud / TBML" },
  P4: { color: "#26c6da", icon: "💸", family: "aml", name: "Hawala Banking" },
  P5: { color: "#66bb6a", icon: "🏠", family: "aml", name: "Benami" },
  P6: { color: "#e54b4f", icon: "🏛", family: "aml", name: "PEP Kickback" },
  // Digital Threat
  T1: { color: "#ff7043", icon: "⚠", family: "digital_threat", name: "Brand Impersonation Phishing" },
  T2: { color: "#e54b4f", icon: "⬡", family: "digital_threat", name: "Malicious URL / Redirect" },
  T3: { color: "#ab47bc", icon: "#", family: "digital_threat", name: "Malware Attachment Delivery" },
  T4: { color: "#ffa726", icon: "₿", family: "digital_threat", name: "Social Engineering Scam" },
  T5: { color: "#78909c", icon: "📢", family: "digital_threat", name: "Coordinated Misinformation" },
  T6: { color: "#e54b4f", icon: "@", family: "digital_threat", name: "Account Takeover / Identity Spread" },
};

const SEVERITY_STYLE = {
  critical: { bg: "bg-destructive/10", text: "text-destructive", border: "border-destructive/30" },
  high:     { bg: "bg-orange-500/10", text: "text-orange-500", border: "border-orange-500/30" },
  medium:   { bg: "bg-yellow-500/10", text: "text-yellow-500", border: "border-yellow-500/30" },
  low:      { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/30" },
};

const DECISION_STYLE = {
  highly_suspicious:  { label: "Highly Suspicious", cls: "text-destructive" },
  likely_suspicious:  { label: "Likely Suspicious",  cls: "text-orange-500" },
  suspicious:         { label: "Suspicious",          cls: "text-orange-500" },
  not_suspicious:     { label: "Not Suspicious",      cls: "text-emerald-500" },
};

function ScoreBar({ score, color }) {
  const pct = Math.min(Math.max(score * 100, 0), 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: color || "#34b27b" }}
      />
    </div>
  );
}

/**
 * Display one pattern entry from the all_results list.
 */
function PatternRow({ entry, isHighlighted }) {
  const codeMatch = entry.pattern?.match(/([PT]\d)/);
  const code = codeMatch ? codeMatch[1] : null;
  const meta = code ? PATTERN_META[code] : null;
  const color = meta?.color || "#64748b";
  const score = entry.risk_score ?? 0;
  const pct = Math.round(score * 100);
  const aboveThreshold = entry.above_threshold;

  return (
    <div
      className={`rounded-lg border px-3 py-2 transition-colors ${
        isHighlighted
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {meta && (
            <span
              className="rounded px-1.5 py-0.5 text-xs font-bold"
              style={{ background: color + "20", color }}
            >
              {code}
            </span>
          )}
          <span className="text-xs font-medium text-foreground">
            {entry.pattern}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold"
            style={{ color: aboveThreshold ? "#e54b4f" : "#64748b" }}
          >
            {pct}%
          </span>
          {aboveThreshold && (
            <span className="rounded bg-destructive/10 px-1 py-0.5 text-xs font-semibold text-destructive">
              ⚑ flagged
            </span>
          )}
        </div>
      </div>
      <ScoreBar score={score} color={color} />
      {Array.isArray(entry.top_features) && entry.top_features.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entry.top_features.slice(0, 3).map((f, i) => (
            <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {f?.feature || String(f)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Main component.
 *
 * Props:
 *  result      - unified classification result OR legacy AML classifier result
 *  title       - optional override for section heading
 *  compact     - if true, skip the all_results list
 *  onViewGraph - optional callback to open graph view
 */
export default function PatternResult({ result, title, compact = false, onViewGraph }) {
  if (!result) return null;

  // ── Normalise input ────────────────────────────────────────────
  // Support both legacy AML shape (best_pattern, best_risk_score, all_results)
  // and new unified shape (pattern_code, risk_score, all_results).
  const isLegacyAml = "best_pattern" in result;

  let patternCode, patternLabel, family, riskScore, confidence, severityKey,
      decision, topFeatures, allResults, explanation, evidenceRefs;

  if (isLegacyAml) {
    // Legacy AML classifier output
    const label = result.best_pattern || "Unknown";
    const m = label.match(/([PT]\d)/);
    patternCode = m ? m[1] : "?";
    patternLabel = label;
    family = "aml";
    riskScore = result.best_risk_score || 0;
    confidence = riskScore;
    severityKey = riskScore >= 0.9 ? "critical" : riskScore >= 0.75 ? "high" : riskScore >= 0.5 ? "medium" : "low";
    decision = result.best_decision || "not_suspicious";
    topFeatures = [];
    allResults = result.all_results || [];
    explanation = "";
    evidenceRefs = [];
  } else {
    // New unified shape
    patternCode = result.pattern_code || "?";
    patternLabel = result.pattern_label || result.pattern_name || patternCode;
    family = result.family || "digital_threat";
    riskScore = result.risk_score || 0;
    confidence = result.confidence || riskScore;
    severityKey = result.severity || "medium";
    decision = result.decision || "not_suspicious";
    topFeatures = result.top_features || [];
    allResults = result.all_results || [];
    explanation = result.explanation || "";
    evidenceRefs = result.evidence_refs || [];
  }

  const meta = PATTERN_META[patternCode] || {};
  const sev = SEVERITY_STYLE[severityKey] || SEVERITY_STYLE.medium;
  const dec = DECISION_STYLE[decision] || { label: decision, cls: "text-muted-foreground" };
  const pct = Math.round(riskScore * 100);
  const isDigitalThreat = family === "digital_threat";

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* Pattern icon badge */}
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold flex-shrink-0"
            style={{ background: (meta.color || "#64748b") + "20", color: meta.color || "#64748b" }}
          >
            {meta.icon || patternCode}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {isDigitalThreat ? "Digital Threat Pattern" : "AML Pattern"} · {patternCode}
            </p>
            <h3 className="text-base font-bold text-foreground">{patternLabel}</h3>
            {meta.name && patternLabel !== meta.name && (
              <p className="text-xs text-muted-foreground">{meta.name}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {/* Severity badge */}
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase ${sev.bg} ${sev.text} ${sev.border}`}>
            {severityKey}
          </span>
          {/* Family badge */}
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            isDigitalThreat
              ? "bg-blue-500/10 text-blue-400"
              : "bg-emerald-500/10 text-emerald-400"
          }`}>
            {isDigitalThreat ? "Digital Threat" : "AML"}
          </span>
        </div>
      </div>

      {/* Score row */}
      <div className="mb-4 flex items-center gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Risk Score</span>
            <span
              className="text-lg font-bold"
              style={{ color: riskScore >= 0.9 ? "#e54b4f" : riskScore >= 0.75 ? "#ff7043" : riskScore >= 0.5 ? "#ffa726" : "#34b27b" }}
            >
              {pct}%
            </span>
          </div>
          <ScoreBar score={riskScore} color={meta.color || "#34b27b"} />
        </div>

        <div className="text-right">
          <p className={`text-sm font-bold ${dec.cls}`}>{dec.label}</p>
          <p className="text-xs text-muted-foreground">
            Confidence: {Math.round(confidence * 100)}%
          </p>
        </div>
      </div>

      {/* View Graph button */}
      {onViewGraph && (
        <button
          onClick={onViewGraph}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          <span>◈</span> Open in Graph Investigation View
        </button>
      )}

      {/* Explanation */}
      {explanation && (
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground italic">
          {explanation}
        </p>
      )}

      {/* Top features */}
      {topFeatures.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Key Features</p>
          <div className="flex flex-wrap gap-1.5">
            {topFeatures.map((f, i) => (
              <span key={i} className="rounded bg-muted px-2 py-0.5 text-xs text-foreground">
                {f?.feature || String(f)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Evidence refs */}
      {evidenceRefs.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Evidence References</p>
          <div className="flex flex-wrap gap-1">
            {evidenceRefs.map((ref, i) => (
              <span key={i} className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* All pattern scores (expanded) */}
      {!compact && allResults.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">All Pattern Scores</p>
          <div className="space-y-1.5">
            {allResults.map((entry, idx) => (
              <PatternRow
                key={idx}
                entry={entry}
                isHighlighted={entry.pattern === patternLabel || entry.pattern_code === patternCode}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
