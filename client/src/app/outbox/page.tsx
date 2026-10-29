"use client";

import { useEffect, useState } from "react";
import { Radio, Send, RefreshCw, Moon, Sun, AlertCircle, CheckCircle2, MessageSquare, Mail, Smartphone, Globe } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, type OutboxView, type OutboxMessage } from "@/lib/business-api";

export default function OutboxPage() {
  const [data, setData] = useState<OutboxView | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Test send form state
  const [channel, setChannel] = useState<"whatsapp" | "email" | "sms" | "webhook">("whatsapp");
  const [recipient, setRecipient] = useState("+91 98765 43210");
  const [subject, setSubject] = useState("Satya AI Urgent Alert");
  const [body, setBody] = useState("Reconciliation milestone discrepancy detected for PO-1001.");
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
      setSuccessMsg(`Outbox worker processed ${res.processedCount} messages.`);
      const updated = await businessApi.outbox();
      setData(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process outbox queue");
    } finally {
      setProcessing(false);
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
      setSuccessMsg(`Dispatched notification ${res.record.id} via ${channel.toUpperCase()}! Status: ${res.record.status}`);
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
      subtitle="Transactional notification dispatcher with quiet hours enforcement (22:00–08:00 IST) and multi-channel delivery receipts."
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
            title="Test external communication gateway"
            detail="Send an immediate simulated notification to verify multi-channel dispatch, quiet hours adherence, and delivery logging."
          >
            <form onSubmit={handleTestSend} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                    Channel
                  </label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as any)}
                    className="satya-input"
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    <option value="whatsapp">WhatsApp Business API</option>
                    <option value="email">SendGrid / SMTP Email</option>
                    <option value="sms">Twilio SMS Gateway</option>
                    <option value="webhook">ERP / Slack Webhook</option>
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
                  {sending ? "Queuing & Dispatching..." : "Dispatch notification"}
                </button>
              </div>
            </form>
          </Panel>

          {/* ── Transactional Outbox Queue Table ──────────────────────── */}
          <Panel
            title={`Transactional outbox messages (${messages.length})`}
            detail="Persistent log of queued, dispatched, and deferred communications with provider delivery receipts."
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
                    <th>Retries</th>
                    <th>Scheduled / Sent at</th>
                    <th>Delivery receipt</th>
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
                          {m.severity.toUpperCase()}
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
                          {m.status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>{m.retryCount}</td>
                      <td>
                        {m.sentAt ? (
                          <small>
                            Sent: {new Date(m.sentAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST
                          </small>
                        ) : (
                          <small>
                            Scheduled: {new Date(m.scheduledFor).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST
                          </small>
                        )}
                      </td>
                      <td>
                        {m.deliveryReceipt ? (
                          <small style={{ color: "#16a34a" }}>
                            {m.deliveryReceipt.provider}: {m.deliveryReceipt.status}
                          </small>
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
    </BusinessShell>
  );
}
