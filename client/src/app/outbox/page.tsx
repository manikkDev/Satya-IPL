"use client";

import { useEffect, useState } from "react";
import {
  Radio, Send, RefreshCw, Moon, Sun, CheckCircle2, MessageSquare,
  Mail, Smartphone, Globe, ExternalLink, FileText, FileDown, Copy, Check, X
} from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, downloadFile, type OutboxView, type OutboxMessage } from "@/lib/business-api";

function formatTimeIST(dateVal?: string | Date | null) {
  if (!dateVal) return "—";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }) + " IST";
}

export default function OutboxPage() {
  const [data, setData] = useState<OutboxView | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [reseeding, setReseeding] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [activeSmsModal, setActiveSmsModal] = useState<OutboxMessage | null>(null);
  const [smsCopied, setSmsCopied] = useState(false);

  // Test send form state
  const [channel, setChannel] = useState<"whatsapp" | "email" | "sms" | "webhook">("email");
  const [recipient, setRecipient] = useState("manager@satya.demo");
  const [subject, setSubject] = useState("Urgent: PO-1001 3-Way Match Clearance & Executive PDF Report");
  const [body, setBody] = useState("Discrepancies detected between INV-041 and PO-1001. Form GFR-12A and 3-way match reconciliation attached in executive PDF report.");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("high");
  const [sending, setSending] = useState(false);

  const loadData = () => {
    setLoading(true);
    businessApi.outbox()
      .then((res) => setData(res))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleProcessQueue = async () => {
    setProcessing(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await businessApi.processOutbox();
      setSuccessMsg(`Outbox worker processed ${res.processedCount} messages with live delivery receipts.`);
      const updated = await businessApi.outbox();
      setData(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process outbox queue");
    } finally {
      setProcessing(false);
    }
  };

  const handleReseed = async () => {
    setReseeding(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await businessApi.reseedOutbox();
      setSuccessMsg(`Re-seeded ${res.count} authentic BPCI challenge procurement messages.`);
      const updated = await businessApi.outbox();
      setData(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to re-seed outbox messages");
    } finally {
      setReseeding(false);
    }
  };

  const handleTestSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await businessApi.testSendNotification({
        channel,
        recipient,
        subject,
        body,
        severity
      });
      const previewNote = res.record.deliveryReceipt?.previewUrl
        ? ` View live email via Ethereal link below.`
        : "";
      setSuccessMsg(`Dispatched notification ${res.record.id} via ${channel.toUpperCase()}!${previewNote}`);
      const updated = await businessApi.outbox();
      setData(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to dispatch test notification");
    } finally {
      setSending(false);
    }
  };

  const messages = data?.messages || [];
  const statusSummary = data?.statusSummary;
  const channelSummary = data?.channelSummary;
  const inQuietHours = data?.inQuietHours;

  const getChannelIcon = (ch: string) => {
    switch (ch) {
      case "whatsapp": return <MessageSquare size={16} className="text-emerald-600" />;
      case "email": return <Mail size={16} className="text-sky-600" />;
      case "sms": return <Smartphone size={16} className="text-violet-600" />;
      case "webhook": return <Globe size={16} className="text-amber-600" />;
      default: return <Radio size={16} />;
    }
  };

  return (
    <BusinessShell
      title="Communications & escalation outbox"
      subtitle="Transactional notification dispatcher with live SMTP/Email dispatch, PDF report attachment, WhatsApp action links, and quiet hours enforcement."
    >
      <State error={error} loading={loading} />

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {successMsg && (
            <div className="satya-notice ok" role="status">
              <CheckCircle2 size={16} className="inline mr-1 text-emerald-600" />
              {successMsg}
            </div>
          )}

          {/* ── Action Bar: Download PDF & Queue Processing ───────────── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={async () => {
                  try {
                    await downloadFile(businessApi.outboxPdfReportUrl(), "Satya_Executive_Procurement_Report.pdf");
                  } catch (err: unknown) {
                    alert(err instanceof Error ? err.message : "Failed to download outbox PDF report");
                  }
                }}
                className="satya-button"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
              >
                <FileDown size={16} /> Download Executive PDF Report
              </button>
              <button
                onClick={handleReseed}
                disabled={reseeding}
                className="satya-button-secondary"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
              >
                <RefreshCw size={14} className={reseeding ? "satya-spin" : ""} />
                {reseeding ? "Resetting..." : "Reload BPCI Challenge Outbox"}
              </button>
            </div>

            <button
              onClick={handleProcessQueue}
              disabled={processing}
              className="satya-button"
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              <RefreshCw size={16} className={processing ? "satya-spin" : ""} />
              {processing ? "Processing..." : "Process outbox now"}
            </button>
          </div>

          {/* ── Quiet Hours Policy Status ────────────────────────────── */}
          <div
            style={{
              padding: "1.25rem",
              borderRadius: "8px",
              border: `1px solid ${inQuietHours ? "#f59e0b" : "#10b981"}`,
              backgroundColor: inQuietHours ? "rgba(245, 158, 11, 0.08)" : "rgba(16, 185, 129, 0.08)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              {inQuietHours ? (
                <Moon size={28} className="text-amber-500" />
              ) : (
                <Sun size={28} className="text-emerald-500" />
              )}
              <div>
                <strong style={{ fontSize: "1.05rem" }}>
                  Quiet Hours Policy: {inQuietHours ? "ACTIVE (Dispatches Held)" : "INACTIVE (Live Dispatch Open)"}
                </strong>
                <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: "var(--muted-foreground)" }}>
                  Policy Window: <strong>22:00 – 08:00 IST</strong>. Non-critical notifications are safely held until 08:00 AM.
                  Critical emergency alerts bypass quiet hours immediately.
                </p>
              </div>
            </div>
          </div>

          {/* ── Metric Summary ────────────────────────────────────────── */}
          <div className="satya-metric-grid">
            <article className="satya-metric">
              <div>
                <span>Sent messages</span>
                <CheckCircle2 size={20} className="text-emerald-500" />
              </div>
              <strong>{statusSummary?.sent ?? 0}</strong>
              <p>Delivered with provider receipts</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Held in quiet hours</span>
                <Moon size={20} className="text-amber-500" />
              </div>
              <strong>{statusSummary?.quiet_hours_delayed ?? 0}</strong>
              <p>Deferred to next morning window</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Queued in outbox</span>
                <Radio size={20} className="text-sky-500" />
              </div>
              <strong>{statusSummary?.queued ?? 0}</strong>
              <p>Pending worker pick-up</p>
            </article>

            <article className="satya-metric">
              <div>
                <span>Active channels</span>
                <Send size={20} />
              </div>
              <strong>4 channels</strong>
              <p>
                {channelSummary?.whatsapp ?? 0} WA · {channelSummary?.email ?? 0} Email ·{" "}
                {channelSummary?.sms ?? 0} SMS · {channelSummary?.webhook ?? 0} Hook
              </p>
            </article>
          </div>

          {/* ── Test Dispatch Form ────────────────────────────────────── */}
          <Panel
            title="Dispatch external notification & generate PDF report"
            detail="Send an immediate live notification. Email dispatches include a fully compiled executive PDF report and live preview URL; WhatsApp messages provide direct WhatsApp Web launch links."
          >
            <form onSubmit={handleTestSend} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                    Channel
                  </label>
                  <select
                    value={channel}
                    onChange={(e) => {
                      const ch = e.target.value as any;
                      setChannel(ch);
                      if (ch === "whatsapp") setRecipient("+91 98200 12345");
                      else if (ch === "email") setRecipient("manager@satya.demo");
                      else if (ch === "sms") setRecipient("+91 98190 54321");
                      else setRecipient("https://erp.bpci.internal/api/v2/satya-events");
                    }}
                    className="satya-input"
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    <option value="email">SendGrid / SMTP Email (With Attached PDF Report)</option>
                    <option value="whatsapp">WhatsApp Business API (With Direct Action Link)</option>
                    <option value="sms">Twilio SMS Gateway (With Direct SMS Link)</option>
                    <option value="webhook">Enterprise ERP Webhook (HMAC-SHA256)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                    Recipient
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    required
                    className="satya-input"
                    style={{ width: "100%", padding: "0.5rem" }}
                    placeholder="+91... or email@company.com"
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                    Severity
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as any)}
                    className="satya-input"
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    <option value="low">Low (Quiet hours apply)</option>
                    <option value="medium">Medium (Quiet hours apply)</option>
                    <option value="high">High (Quiet hours apply)</option>
                    <option value="critical">Critical (Immediate bypass)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                  Subject / Alert Title
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="satya-input"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                  Message Content
                </label>
                <textarea
                  rows={2}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  className="satya-input"
                  style={{ width: "100%", padding: "0.5rem", fontFamily: "inherit" }}
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={sending}
                  className="satya-button"
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
                >
                  <Send size={16} />
                  {sending ? "Queuing, Compiling PDF & Dispatching..." : "Dispatch notification"}
                </button>
              </div>
            </form>
          </Panel>

          {/* ── Transactional Outbox Queue Table ──────────────────────── */}
          <Panel
            title={`Transactional outbox messages (${messages.length})`}
            detail="Persistent log of queued, dispatched, and deferred communications with live delivery receipts and attachment verification."
          >
            <div className="satya-table-wrap">
              <table className="satya-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Recipient</th>
                    <th>Subject & message</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Scheduled / Sent at</th>
                    <th>Delivery receipt & actions</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          {getChannelIcon(m.channel)}
                          <strong style={{ textTransform: "capitalize" }}>{m.channel}</strong>
                        </div>
                      </td>
                      <td>
                        <code>{m.recipient}</code>
                      </td>
                      <td>
                        {m.subject && <strong>{m.subject}<br /></strong>}
                        <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)" }}>
                          {m.body}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`satya-tag ${
                            m.severity === "critical"
                              ? "text-red-600"
                              : m.severity === "high"
                              ? "text-amber-600"
                              : ""
                          }`}
                        >
                          {(m.severity || "medium").toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`satya-status ${
                            m.status === "sent"
                              ? "ok"
                              : m.status === "quiet_hours_delayed"
                              ? "info"
                              : m.status === "failed"
                              ? "review"
                              : ""
                          }`}
                        >
                          {(m.status || "queued").replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>{m.attempts ?? m.retryCount ?? 1}</td>
                      <td>
                        {m.deliveredAt || m.sentAt ? (
                          <small>
                            Sent: {formatTimeIST(m.deliveredAt || m.sentAt)}
                          </small>
                        ) : (
                          <small>
                            Scheduled: {formatTimeIST(m.scheduledAt || m.scheduledFor || m.createdAt)}
                          </small>
                        )}
                      </td>
                      <td>
                        {m.deliveryReceipt ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                            <small style={{ color: "#16a34a", fontWeight: 600 }}>
                              {m.deliveryReceipt.provider}: {m.deliveryReceipt.status}
                            </small>

                            {/* Live Ethereal Preview Link for Emails */}
                            {m.deliveryReceipt.previewUrl && (
                              <a
                                href={m.deliveryReceipt.previewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="satya-button"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.3rem",
                                  padding: "0.2rem 0.5rem",
                                  fontSize: "0.75rem",
                                  width: "fit-content",
                                  textDecoration: "none"
                                }}
                              >
                                View Email & PDF in Ethereal <ExternalLink size={12} />
                              </a>
                            )}

                            {/* Direct WhatsApp Launch Link */}
                            {m.channel === "whatsapp" && m.deliveryReceipt.actionUrl && (
                              <a
                                href={m.deliveryReceipt.actionUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="satya-button"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.3rem",
                                  padding: "0.2rem 0.5rem",
                                  fontSize: "0.75rem",
                                  width: "fit-content",
                                  backgroundColor: "#16a34a",
                                  borderColor: "#16a34a",
                                  textDecoration: "none"
                                }}
                              >
                                Open in WhatsApp <ExternalLink size={12} />
                              </a>
                            )}

                            {/* Direct SMS Launch & Inspection Modal Trigger */}
                            {m.channel === "sms" && (
                              <button
                                onClick={() => {
                                  setActiveSmsModal(m);
                                  setSmsCopied(false);
                                }}
                                className="satya-button"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.3rem",
                                  padding: "0.2rem 0.5rem",
                                  fontSize: "0.75rem",
                                  width: "fit-content",
                                  backgroundColor: "#7c3aed",
                                  borderColor: "#7c3aed"
                                }}
                              >
                                View SMS / Carrier <Smartphone size={12} />
                              </button>
                            )}

                            {/* Attached PDF indicator */}
                            {m.deliveryReceipt.hasPdfAttachment && (
                              <small style={{ color: "#0284c7", display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
                                <FileText size={12} /> Executive PDF Attached ({m.deliveryReceipt.pdfSizeKb || 42} KB)
                              </small>
                            )}
                          </div>
                        ) : m.lastError ? (
                          <small style={{ color: "#dc2626" }}>Error: {m.lastError}</small>
                        ) : (
                          <span style={{ color: "var(--muted-foreground)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ── SMS Inspection & Carrier Dialog Modal ───────────────────────── */}
      {activeSmsModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem"
          }}
          onClick={() => setActiveSmsModal(null)}
        >
          <div
            style={{
              backgroundColor: "var(--card, #ffffff)",
              color: "var(--foreground, #0f172a)",
              borderRadius: "0.75rem",
              maxWidth: "520px",
              width: "100%",
              padding: "1.5rem",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              border: "1px solid var(--border, #e2e8f0)",
              display: "flex",
              flexDirection: "column",
              gap: "1rem"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Smartphone size={20} className="text-violet-600" />
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Twilio SMS Carrier Dispatch</h3>
              </div>
              <button
                onClick={() => setActiveSmsModal(null)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0.25rem" }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: "0.85rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", padding: "0.75rem", background: "var(--accent, #f8fafc)", borderRadius: "0.5rem" }}>
              <div><strong>DLT Header:</strong> BPCI-SATYA</div>
              <div><strong>TRAI Template:</strong> DLT-BPCI-SATYA-1002</div>
              <div><strong>DLT Entity ID:</strong> 1101552390000023412</div>
              <div><strong>Gateway Status:</strong> <span style={{ color: "#16a34a", fontWeight: 600 }}>Delivered to Carrier</span></div>
              <div style={{ gridColumn: "span 2" }}><strong>Recipient Phone:</strong> <code>{activeSmsModal.recipient}</code></div>
            </div>

            {/* Mobile Chat Bubble Simulation */}
            <div>
              <p style={{ margin: "0 0 0.35rem 0", fontSize: "0.75rem", color: "var(--muted-foreground, #64748b)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Handset SMS Screen Preview</p>
              <div
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "1rem 1rem 1rem 0.2rem",
                  padding: "0.9rem",
                  fontSize: "0.88rem",
                  lineHeight: "1.45",
                  color: "#0f172a"
                }}
              >
                <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: "0.4rem", fontWeight: 600 }}>
                  FROM: BPCI-SATYA · Indian Telecom DLT Standard
                </div>
                {activeSmsModal.body}
              </div>
            </div>

            {/* Action Bar */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(activeSmsModal.body);
                  setSmsCopied(true);
                  setTimeout(() => setSmsCopied(false), 2500);
                }}
                className="satya-button"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
              >
                {smsCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {smsCopied ? "Copied SMS Body!" : "Copy SMS Body"}
              </button>

              <a
                href="https://messages.google.com/web"
                target="_blank"
                rel="noopener noreferrer"
                className="satya-button secondary"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", textDecoration: "none" }}
              >
                Open Google Messages Web <ExternalLink size={12} />
              </a>

              {activeSmsModal.deliveryReceipt?.actionUrl && (
                <a
                  href={activeSmsModal.deliveryReceipt.actionUrl}
                  className="satya-button secondary"
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", textDecoration: "none" }}
                >
                  Trigger Device SMS App <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </BusinessShell>
  );
}
