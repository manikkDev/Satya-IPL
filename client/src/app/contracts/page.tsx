"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileSignature, AlertTriangle, CheckCircle2, ShieldCheck, GitCommit, ArrowRight, Clock, FileText, FileDown, RefreshCw } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, downloadFile, type ContractView, type ContractObligation, type ContractAgreement } from "@/lib/business-api";

export default function ContractsPage() {
  const [data, setData] = useState<ContractView | null>(null);
  const [loading, setLoading] = useState(true);
  const [reseeding, setReseeding] = useState(false);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    businessApi.contracts()
      .then((res) => setData(res))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleReseedContracts = async () => {
    setReseeding(true);
    setActionSuccess("");
    try {
      const res = await businessApi.reseedContracts();
      setData(res);
      setActionSuccess(`Loaded ${res.agreements.length} authentic BPCI challenge contracts and ${res.obligations.length} compliance obligations.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reload BPCI contracts");
    } finally {
      setReseeding(false);
    }
  };

  const handleUpdateStatus = async (obligationId: string, status: "satisfied" | "pending" | "disputed_superseded" | "waived") => {
    setUpdatingId(obligationId);
    setActionSuccess("");
    try {
      const res = await businessApi.updateObligationStatus(obligationId, {
        status,
        notes: status === "satisfied" ? "Verified completion by user action." : "Flagged by compliance review."
      });
      setActionSuccess(`Obligation ${res.obligation.obligationId} status updated to ${status}.`);
      // Update local state
      if (data) {
        setData({
          ...data,
          obligations: data.obligations.map((o) => (o.id === obligationId ? res.obligation : o))
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update obligation");
    } finally {
      setUpdatingId(null);
    }
  };

  const agreements = data?.agreements || [];
  const obligations = data?.obligations || [];
  const contradictions = data?.contradictions || [];
  const edges = data?.evidenceGraph?.edges || [];

  return (
    <BusinessShell
      title="Contract obligations & legal intelligence"
      subtitle="Manage non-financial legal agreements, track clause contradictions, and resolve compliance obligations."
    >
      <State error={error} loading={loading} />

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {actionSuccess && (
            <div className="satya-notice ok" role="status">
              <CheckCircle2 size={16} className="inline mr-1 text-emerald-600" />
              {actionSuccess}
            </div>
          )}

          {/* ── Action Bar: Download PDF & Reload Contracts ───────────── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={async () => {
                  try {
                    await downloadFile(businessApi.contractPdfReportUrl(), "BPCI_Legal_MOU_Clearance_Report.pdf");
                  } catch (err: unknown) {
                    alert(err instanceof Error ? err.message : "Failed to download contract PDF report");
                  }
                }}
                className="satya-button"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
              >
                <FileDown size={16} /> Download Legal MOU Clearance PDF Report
              </button>
              <button
                onClick={handleReseedContracts}
                disabled={reseeding}
                className="satya-button-secondary"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
              >
                <RefreshCw size={14} className={reseeding ? "satya-spin" : ""} />
                {reseeding ? "Reloading..." : "Reload BPCI Challenge Contracts"}
              </button>
            </div>
          </div>

          {/* ── Metric Summary ────────────────────────────────────────── */}
          <div className="satya-metric-grid">
            <article className="satya-metric">
              <div>
                <span>Active agreements</span>
                <FileSignature size={20} />
              </div>
              <strong>{agreements.length}</strong>
              <p>MOUs, MSAs & addenda in workspace</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Compliance obligations</span>
                <Clock size={20} />
              </div>
              <strong>{obligations.length}</strong>
              <p>
                {obligations.filter((o) => o.status === "satisfied").length} satisfied ·{" "}
                {obligations.filter((o) => o.status === "pending").length} pending
              </p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Clause contradictions</span>
                <AlertTriangle size={20} />
              </div>
              <strong>{contradictions.length}</strong>
              <p>Superseding clauses detected</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Graph relation edges</span>
                <GitCommit size={20} />
              </div>
              <strong>{edges.length}</strong>
              <p>Provenance & non-financial links</p>
            </article>
          </div>

          {/* ── Legal Clause Contradiction Panel ───────────────────────── */}
          {contradictions.length > 0 && (
            <Panel
              title="Legal clause contradiction & supersession analysis"
              detail="Automated detection of conflicting terms between base agreements and executed addenda."
            >
              {contradictions.map((c) => (
                <div
                  key={c.id}
                  style={{
                    border: "1px solid #f59e0b",
                    borderRadius: "8px",
                    padding: "1.25rem",
                    backgroundColor: "rgba(245, 158, 11, 0.05)",
                    marginBottom: "1rem"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <AlertTriangle size={18} className="text-amber-500" />
                      <strong>{c.topic} · Counterparty: {c.counterparty}</strong>
                    </div>
                    <span className={`satya-status ${c.status === "superseded_authoritative" ? "ok" : "review"}`}>
                      {c.status === "superseded_authoritative" ? "Authoritative supersession" : "Disputed / Unverified"}
                    </span>
                  </div>

                  <p style={{ fontSize: "0.9rem", color: "var(--muted-foreground)", marginBottom: "1rem" }}>
                    {c.recommendation}
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
                    <div style={{ padding: "0.75rem", background: "var(--card-bg, #fff)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)", marginBottom: "0.25rem" }}>
                        Original Base Agreement ({c.baseAgreement.number})
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#dc2626" }}>
                        Expiry: {new Date(c.baseAgreement.expiryDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" })}
                      </div>
                      <small style={{ display: "block", marginTop: "0.25rem", color: "var(--muted-foreground)" }}>
                        {c.baseAgreement.clauseRef}: "{c.baseAgreement.clauseText}"
                      </small>
                    </div>

                    <div style={{ padding: "0.75rem", background: "var(--card-bg, #fff)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)", marginBottom: "0.25rem" }}>
                        Superseding Addendum ({c.supersedingDocument.number})
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#16a34a" }}>
                        Extended Expiry: {new Date(c.supersedingDocument.extendedExpiryDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" })}
                      </div>
                      <small style={{ display: "block", marginTop: "0.25rem", color: "var(--muted-foreground)" }}>
                        {c.supersedingDocument.clauseRef}: "{c.supersedingDocument.clauseText}"
                      </small>
                    </div>
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {/* ── Active Agreements & Addenda ────────────────────────────── */}
          <Panel
            title={`Active agreements & legal documents (${agreements.length})`}
            detail="Commercial frameworks, technical MOUs, and valid contract addenda."
          >
            <div className="satya-table-wrap">
              <table className="satya-table">
                <thead>
                  <tr>
                    <th>Agreement #</th>
                    <th>Title</th>
                    <th>Counterparty</th>
                    <th>Category</th>
                    <th>Effective</th>
                    <th>Expiry</th>
                    <th>Signatures</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.map((ag) => (
                    <tr key={ag.id}>
                      <td><strong>{ag.agreementNumber}</strong></td>
                      <td>{ag.title}</td>
                      <td>{ag.counterparty}</td>
                      <td>
                        <span className="satya-tag">{ag.category}</span>
                      </td>
                      <td>
                        {new Date(ag.effectiveDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td>
                        {new Date(ag.expiryDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td>
                        {ag.signatures?.every((s) => s.verified) ? (
                          <span style={{ color: "#16a34a", display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem" }}>
                            <ShieldCheck size={14} /> Verified ({ag.signatures.length})
                          </span>
                        ) : (
                          <span style={{ color: "#f59e0b", fontSize: "0.85rem" }}>Pending</span>
                        )}
                      </td>
                      <td>
                        <span className={`satya-status ${ag.status === "active" ? "ok" : "review"}`}>
                          {ag.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Non-Financial Compliance Obligations ───────────────────── */}
          <Panel
            title={`Non-financial obligations & milestone requirements (${obligations.length})`}
            detail="Contractual milestones, utilization certificates, SLA uptimes, and periodic compliance reports."
          >
            <div className="satya-table-wrap">
              <table className="satya-table">
                <thead>
                  <tr>
                    <th>Obligation ID</th>
                    <th>Title & description</th>
                    <th>Category</th>
                    <th>Due date</th>
                    <th>Status</th>
                    <th>Associated case</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {obligations.map((obl) => (
                    <tr key={obl.id}>
                      <td><strong>{obl.obligationId}</strong></td>
                      <td>
                        <strong>{obl.title}</strong>
                        {(obl.description || obl.sourceClauseRef) && (
                          <p style={{ margin: "0.2rem 0 0", fontSize: "0.825rem", color: "var(--muted-foreground)" }}>
                            {obl.description || `Clause Ref: ${obl.sourceClauseRef}`}
                          </p>
                        )}
                        {obl.disputeReason && (
                          <small style={{ color: "#f59e0b" }}>Note: {obl.disputeReason}</small>
                        )}
                      </td>
                      <td>
                        <span className="satya-tag">
                          {((obl.type || obl.category || "OBLIGATION") as string).replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        {obl.dueDate
                          ? new Date(obl.dueDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
                          : "—"}
                      </td>
                      <td>
                        <span className={`satya-status ${obl.status === "satisfied" ? "ok" : obl.status === "waived" ? "info" : "review"}`}>
                          {(obl.status || "pending").replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        {obl.caseId ? (
                          <Link href={`/cases/${obl.caseId}`} className="satya-evidence-chip">
                            {obl.poId || obl.caseId} <ArrowRight size={14} className="inline ml-1" />
                          </Link>
                        ) : (
                          <span style={{ color: "var(--muted-foreground)" }}>—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          {obl.status !== "satisfied" && (
                            <button
                              disabled={updatingId === obl.id}
                              onClick={() => handleUpdateStatus(obl.id, "satisfied")}
                              className="satya-button"
                              style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem", height: "auto" }}
                            >
                              Satisfy
                            </button>
                          )}
                          {obl.status === "satisfied" && (
                            <button
                              disabled={updatingId === obl.id}
                              onClick={() => handleUpdateStatus(obl.id, "pending")}
                              className="satya-button-secondary"
                              style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem", height: "auto" }}
                            >
                              Reopen
                            </button>
                          )}
                          {obl.status !== "disputed_superseded" && (
                            <button
                              disabled={updatingId === obl.id}
                              onClick={() => handleUpdateStatus(obl.id, "disputed_superseded")}
                              className="satya-button-secondary"
                              style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem", height: "auto" }}
                            >
                              Dispute
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Non-Financial Evidence Graph Overview ─────────────────── */}
          {edges.length > 0 && (
            <Panel
              title={`Obligation evidence graph relationships (${edges.length} edges)`}
              detail="Extended non-financial edge types connecting counterparties, agreements, obligations, and task investigations."
            >
              <div className="satya-table-wrap">
                <table className="satya-table">
                  <thead>
                    <tr>
                      <th>Edge Type</th>
                      <th>Source node</th>
                      <th>Target node</th>
                      <th>Semantic relationship</th>
                    </tr>
                  </thead>
                  <tbody>
                    {edges.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <span className="satya-tag" style={{ fontFamily: "monospace" }}>{e.type}</span>
                        </td>
                        <td><strong>{e.source}</strong></td>
                        <td><strong>{e.target}</strong></td>
                        <td>{e.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}
    </BusinessShell>
  );
}
