"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, FileSearch, RefreshCw, MessageSquare, X, Clock3, CheckCircle2, UserCheck, AlertTriangle, FileText, Download, BellRing, Check } from "lucide-react";
import BusinessShell, { Panel, State, evidenceLabel } from "@/components/BusinessShell";
import BusinessGraph from "@/components/BusinessGraph";
import DeliveryProgress from '@/components/DeliveryProgress';
import { useAuth } from "@/contexts/auth-context";
import { businessApi, money, waitForJob, type BusinessCase, type Evidence, type Graph, type Snapshot, type AssignableUser, type CaseDocument, type CaseReminder } from "@/lib/business-api";

const tabs = ["Summary", "Records", "Record connections", "Payments & matches", "Anomalies & Evidence", "Documents", "Review history"];
const recordTypes: Record<string, string> = { PO: "Purchase order", GRN: "Delivery receipt", INVOICE: "Invoice", PAYMENT: "Payment", CREDIT_NOTE: "Credit note", RETURN: "Return", PROFORMA: "Proforma invoice" };
const actions = [{ value: "APPROVE", label: "Approve" }, { value: "REQUEST_CLARIFICATION", label: "Request more information" }, { value: "ESCALATE", label: "Escalate for review" }, { value: "PLACE_ON_HOLD", label: "Put on hold" }];

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<BusinessCase | null>(null);
  const [view, setView] = useState<Snapshot | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [tab, setTab] = useState("Summary");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [sourceDocument, setSourceDocument] = useState<{ name: string; content: string } | null>(null);
  const [sourceError, setSourceError] = useState('');
  useEffect(() => {
    setSourceDocument(null); setSourceError('');
    if (!selected?.locator.documentId) return;
    let active = true;
    businessApi.document(selected.locator.documentId).then((document) => { if (active) setSourceDocument(document); }).catch((error) => { if (active) setSourceError(error.message); });
    return () => { active = false; };
  }, [selected?.locator.documentId]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [graphError, setGraphError] = useState("");
  const [cutoff, setCutoff] = useState("2026-10-04T23:59");
  const [assignReason, setAssignReason] = useState("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [reminders, setReminders] = useState<CaseReminder[]>([]);
  const [reminderDue, setReminderDue] = useState("");
  const [reminderReason, setReminderReason] = useState("");
  const [exceptionNotes, setExceptionNotes] = useState("");
  const focusTarget = useRef<HTMLElement | null>(null);

  const showEvidence = useCallback((evidence: Evidence | null) => {
    focusTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(evidence);
    if (!evidence) setNotice("No field-level source evidence is available for this record in the current view.");
  }, []);

  const load = useCallback(async (ignoreCitation = false) => {
    const businessCase = await businessApi.case(id);
    const citation = new URLSearchParams(window.location.search);
    const snapshotId = ignoreCitation ? null : citation.get("snapshot");
    const snapshot = snapshotId && snapshotId !== businessCase.snapshot?.snapshotId ? { ...(await businessApi.snapshot(snapshotId)), simulation: true } : businessCase.snapshot;
    if (snapshot && snapshot.caseId !== id) throw new Error("This source belongs to a different investigation");
    setData(businessCase); setView(snapshot);
    if (!ignoreCitation && citation.get("evidence")) showEvidence(snapshot?.evidence.find((evidence) => evidence.id === citation.get("evidence")) || null);
    setGraphError("");
    try { setGraph(await businessApi.graph(id)); }
    catch { setGraph(null); setGraphError("The graph service could not be reached. Connections from the stored calculation are shown instead."); }
    try {
      businessApi.assignableUsers().then(setAssignableUsers).catch(() => {});
      businessApi.caseDocuments(id).then(setDocuments).catch(() => {});
      businessApi.caseReminders(id).then(setReminders).catch(() => {});
    } catch {}
  }, [id, showEvidence]);

  useEffect(() => { load().catch((error) => setError(error.message)); }, [load]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await task(); } catch (error) { setError(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  };

  const decide = async (action: string, findingId?: string, review?: unknown) => {
    if (!data || !view || view.simulation) return;
    await run(async () => {
      if (reason.trim().length < 10) throw new Error("Explain your decision in at least 10 characters before saving it.");
      const result = await businessApi.decision(id, { action, findingId, review, reason, expectedRevision: data.revision, snapshotId: view.snapshotId });
      await waitForJob(result.job.id); await load(true); setReason(""); setNotice("Decision saved and records checked again. No payment or supplier message was sent.");
    });
  };

  const ledger = view?.ledger;
  const manager = user?.role === "ap_manager" || user?.role === "admin";
  const analystActions = ["REQUEST_CLARIFICATION", "ESCALATE"];
  const canAct = manager || user?.role === "ops_analyst";
  const cannotReview = busy || !manager || !!view?.simulation || reason.trim().length < 10;
  const openEvidence = (recordId: string) => showEvidence(view?.evidence.find((evidence) => evidence.recordId === recordId) || null);
  const reasonField = (fieldId: string) => <><label htmlFor={fieldId} className="text-sm">Why are you making this decision?</label><textarea id={fieldId} className="satya-input mt-2" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe the records you checked and why this is the right next step." disabled={busy || !canAct || !!view?.simulation} /><p className="text-xs text-muted-foreground mt-2">At least 10 characters. A finance manager must review and confirm changes.</p></>;

  return <BusinessShell title={data?.poId || "Investigation"} subtitle={data?.title || "Loading the order and its records…"}>
    <Link href="/cases" className="satya-back"><ArrowLeft size={17} />All investigations</Link>
    <State error={error} loading={!data && !error} />
    {error && <button className="satya-button secondary mb-5" disabled={busy} onClick={() => run(() => load())}>Reload investigation</button>}
    {data && !view && <Panel title="This investigation hasn’t been checked yet"><p className="text-muted-foreground">Run a record check to calculate balances and find any issues.</p>{user?.role !== "auditor" && <button className="satya-button mt-4" disabled={busy} onClick={() => run(async () => { const job = await businessApi.reconcile(id); await waitForJob(job.id); await load(); })}>Check records</button>}</Panel>}
    {view && data && ledger && <>
      {notice && <div className="satya-notice" role="status">{notice}</div>}
      {busy && <State loading />}
      {view.simulation && <div className="satya-notice warning"><strong>You’re viewing a read-only preview.</strong> Current records and decisions have not changed. <button className="underline" disabled={busy} onClick={() => run(() => load(true))}>Return to current records</button></div>}
      <div className="satya-case-meta">
        <span>{data.supplier}</span>
        <span className="satya-tag">{data.sector}</span>
        {data.assigneeName && <span><UserCheck size={14} className="inline mr-1" />Assigned to {data.assigneeName}</span>}
        <span className="satya-tag">Exception: {data.exceptionStatus || "open"}</span>
        <span>Records available at {new Date(view.observedBefore).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span>
        <button disabled={busy || user?.role === "auditor"} className="satya-button secondary" onClick={() => run(async () => { const job = await businessApi.reconcile(id); await waitForJob(job.id); await load(true); })}><RefreshCw size={16} className={busy ? "satya-spin" : undefined} />Check records again</button>
        <a className="satya-button secondary" href={businessApi.downloadReportUrl(id, "json")} target="_blank" rel="noreferrer"><Download size={15} />Export JSON</a>
        <a className="satya-button secondary" href={businessApi.downloadReportUrl(id, "csv")} target="_blank" rel="noreferrer"><Download size={15} />Export CSV</a>
        <Link className="satya-button secondary" href={`/chat?case=${encodeURIComponent(id)}`}><MessageSquare size={16} />Ask Satya</Link>
      </div>
      <div className="satya-metric-grid satya-money-grid">{[
        ["Balance in imported invoices", money(ledger.recordedOutstanding, ledger.currency), "Invoice postings, less linked payments"],
        ["Delivery-supported balance", money(ledger.supportedOutstanding, ledger.currency), "Based on eligible received goods"],
        ["Balance after record checks", money(ledger.canonicalOutstanding, ledger.currency), "Needs evidence if key records conflict"],
        ["Possible duplicate amount", money(ledger.disputedExposure, ledger.currency), "Disputed, not confirmed savings or fraud"],
      ].map(([label, value, detail]) => <article className="satya-metric" key={label}><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>)}</div>
      <div className="satya-tabs" role="tablist" aria-label="Investigation sections">{tabs.map((name, index) => <button id={`case-tab-${index}`} aria-controls={`case-panel-${index}`} role="tab" tabIndex={tab === name ? 0 : -1} aria-selected={tab === name} className={tab === name ? "active" : ""} key={name} onClick={() => setTab(name)} onKeyDown={(event) => { const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null; if (next !== null) { event.preventDefault(); setTab(tabs[next]); document.getElementById(`case-tab-${next}`)?.focus(); } }}>{name}</button>)}</div>
      <div role="tabpanel" id={`case-panel-${tabs.indexOf(tab)}`} aria-labelledby={`case-tab-${tabs.indexOf(tab)}`} tabIndex={0}>
        {tab === "Summary" && <div className="satya-two-column"><div>
          <DeliveryProgress businessCase={data} snapshot={view} onInspect={(recordId) => showEvidence(view.evidence.find((item) => item.recordId === recordId && /quantity$/.test(item.field)) || view.evidence.find((item) => item.recordId === recordId) || null)} />
          <Panel title={`Issues to review (${view.findings.length})`} detail="Read the issue, open its supporting records and check the suggested next step.">{view.findings.map((finding) => <article className={`satya-finding ${finding.severity}`} key={finding.id}><div className="satya-case-card-top"><h3>{evidenceLabel(finding.title)}</h3><span className={`satya-status ${finding.severity === "info" ? "ok" : "review"}`}>{evidenceLabel(finding.certainty)}</span></div><p>{finding.detail}</p>{finding.exposure && <p><strong>Amount to review: {money(finding.exposure.amount, finding.exposure.currency)}</strong></p>}<div className="satya-chat-sources">{finding.evidenceIds.map((evidenceId) => { const evidence = view.evidence.find((item) => item.id === evidenceId); return <button className="satya-evidence-chip" key={evidenceId} onClick={() => showEvidence(evidence || null)}><FileSearch size={15} />{evidence?.reference || evidenceId}</button>; })}</div><span className="satya-next">Next step: {evidenceLabel(finding.action)}</span></article>)}{view.findings.length === 0 && <div className="satya-notice"><CheckCircle2 size={18} className="inline mr-2" />No blocking issues were found in the records supplied.</div>}</Panel>
          {view.ambiguities.map((ambiguity) => <Panel key={ambiguity.id} title="Information still needed"><p>{ambiguity.neededEvidence}</p>{ambiguity.balanceScenarios && <div className="satya-notice warning">The supported balance could range from <strong>{money(ambiguity.balanceScenarios.minimum, ambiguity.balanceScenarios.currency)}</strong> to <strong>{money(ambiguity.balanceScenarios.maximum, ambiguity.balanceScenarios.currency)}</strong>.<p className="mt-2">{ambiguity.balanceScenarios.assumption}</p><p className="text-xs mt-2">These are possible outcomes under the stated assumption, not a guaranteed range.</p></div>}</Panel>)}
        </div><div>
          <Panel title="Record a decision" detail="Applies to the whole investigation. Unresolved issues may block approval.">{reasonField("decision-reason")}<div className="satya-action-grid">{actions.map((action) => <button key={action.value} className="satya-button secondary" disabled={busy || !!view?.simulation || reason.trim().length < 10 || (!manager && !analystActions.includes(action.value)) || (action.value === "APPROVE" && ledger.canonicalOutstanding === null)} onClick={() => decide(action.value)}>{action.label}</button>)}</div>{user?.role === "ops_analyst" && <p className="text-sm text-muted-foreground mt-3">You can escalate this investigation or request more information. A finance manager confirms duplicates, payment links, approvals and holds.</p>}{!canAct && <p className="text-sm text-muted-foreground mt-3">You can view the records. A finance manager is needed to save a decision.</p>}<p className="text-xs text-muted-foreground mt-3">Internal review only. These buttons do not send money or contact suppliers.</p></Panel>

          {manager && data.status !== "reconciled" && <Panel title="Assign / Reassign investigation" detail="Select a verified team member to assign responsibility for resolving this case.">
            <label htmlFor="assign-select" className="text-sm">Select team member</label>
            <select id="assign-select" className="satya-input mt-2" value={selectedAssigneeId} onChange={(e) => setSelectedAssigneeId(e.target.value)} disabled={busy}>
              <option value="">-- Choose verified user --</option>
              {assignableUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role.replaceAll("_", " ")}) - {u.email}</option>)}
            </select>
            <label htmlFor="assign-reason" className="text-sm mt-3 block">Why are you assigning this?</label>
            <textarea id="assign-reason" className="satya-input mt-2" rows={2} value={assignReason} onChange={(e) => setAssignReason(e.target.value)} placeholder="At least 10 characters explanation" disabled={busy} />
            <button className="satya-button secondary mt-3" disabled={busy || !selectedAssigneeId || assignReason.trim().length < 10} onClick={() => run(async () => {
              await businessApi.assign(id, { assigneeId: selectedAssigneeId, reason: assignReason.trim() });
              setAssignReason(""); setSelectedAssigneeId(""); await load(true); setNotice("Investigation assignment updated.");
            })}>Confirm Assignment</button>
          </Panel>}

          {(manager || (data.assigneeId && String(data.assigneeId) === String(user?.id))) && <Panel title="Exception Lifecycle Status" detail={`Current: ${data.exceptionStatus || "open"}`}>
            <label htmlFor="ex-notes" className="text-sm">Resolution notes / justification</label>
            <textarea id="ex-notes" className="satya-input mt-2" rows={2} value={exceptionNotes} onChange={(e) => setExceptionNotes(e.target.value)} placeholder="Provide rationale (10+ chars required for resolved/reopened)" disabled={busy} />
            <div className="satya-action-grid mt-3">
              {["in_progress", "awaiting_evidence", "resolved", "reopened"].map((st) => (
                <button key={st} className="satya-button secondary" disabled={busy || ((st === "resolved" || st === "reopened") && exceptionNotes.trim().length < 10)} onClick={() => run(async () => {
                  await businessApi.updateExceptionStatus(id, { status: st, notes: exceptionNotes.trim() });
                  setExceptionNotes(""); await load(true); setNotice(`Exception status updated to ${st}.`);
                })}>{st.replaceAll("_", " ").toUpperCase()}</button>
              ))}
            </div>
          </Panel>}

          <Panel title="Schedule Reminder" detail="Set an in-app reminder for investigation follow-up.">
            <label htmlFor="rem-date" className="text-sm">Due Date</label>
            <input id="rem-date" type="datetime-local" className="satya-input mt-2" value={reminderDue} onChange={(e) => setReminderDue(e.target.value)} disabled={busy} />
            <label htmlFor="rem-reason" className="text-sm mt-2 block">Reminder Reason</label>
            <input id="rem-reason" className="satya-input mt-2" value={reminderReason} onChange={(e) => setReminderReason(e.target.value)} placeholder="e.g. Check supplier credit note" disabled={busy} />
            <button className="satya-button secondary mt-3" disabled={busy || !reminderDue || reminderReason.trim().length < 5} onClick={() => run(async () => {
              await businessApi.createReminder(id, { dueAt: reminderDue, reason: reminderReason.trim() });
              setReminderDue(""); setReminderReason(""); await load(true); setNotice("Reminder scheduled.");
            })}><BellRing size={16} />Set Reminder</button>
            {reminders.length > 0 && <ul className="satya-list mt-3">{reminders.map(r => <li key={r.reminderId}>{new Date(r.dueAt).toLocaleDateString()} - {r.reason} ({r.recipientName || "General"})</li>)}</ul>}
          </Panel>

          <Panel title="View records from an earlier date" detail="See the information that was available before a date and time."><label htmlFor="cutoff" className="text-sm">Show records available before · India time</label><input id="cutoff" type="datetime-local" className="satya-input mt-2" value={cutoff} onChange={(event) => setCutoff(event.target.value)} /><button disabled={busy || !cutoff} className="satya-button secondary mt-3" onClick={() => run(async () => { const replay = await businessApi.replay(id, `${cutoff}:00+05:30`); setView({ ...replay, simulation:true }); })}><Clock3 size={16} />View earlier records</button><p className="text-xs text-muted-foreground mt-3">Uses today’s checks on older records. Your current records are unchanged.</p></Panel>
          <Panel title="Try a delivery scenario" detail="What would change if the remaining units arrived?"><button className="satya-button secondary" disabled={busy || Number(ledger.openDelivery) <= 0 || data.records.find((record) => record.id === data.poId)?.lines?.length !== 1} onClick={() => run(async () => { const po = data.records.find((record) => record.id === data.poId)!; const result = await businessApi.scenario(id, { id:`WHAT-IF-${Date.now()}`, type:"GRN", reference:"Simulated remaining delivery", source:"what_if_preview", supplier:data.supplier, currency:ledger.currency, poId:data.poId, occurredAt:view.observedBefore, observedAt:view.observedBefore, status:"posted", lines:[{ ...po.lines![0], quantity:ledger.openDelivery, acceptedQuantity:ledger.openDelivery, poLineId:po.lines![0].id }] }); setView({ ...result, simulation:true }); })}>Preview the remaining delivery</button><p className="text-xs text-muted-foreground mt-3">Preview only. No delivery, invoice or payment record is created.</p></Panel>
          <details className="satya-panel"><summary>What do these balances mean?</summary><dl className="satya-glossary"><dt>Imported invoice balance</dt><dd>The invoices recorded by the source system, less linked settled payments. Possible duplicates may still be included.</dd><dt>Delivery-supported balance</dt><dd>The amount supported by eligible received goods, after linked payments. This is not permission to pay.</dd><dt>Balance after record checks</dt><dd>The reconstructed balance. “Needs evidence” means a reliable figure cannot yet be confirmed.</dd><dt>Possible duplicate amount</dt><dd>An amount that may be recorded more than once. It is not proven fraud or confirmed savings.</dd></dl></details>
        </div></div>}
        {tab === "Records" && <Panel title="Original source records" detail="Records available at the date shown above. Select a record to inspect its original values."><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Reference</th><th>Source</th><th>Type</th><th>Amount</th><th>Recorded at · India time</th><th>Evidence</th></tr></thead><tbody>{data.records.filter((record) => Date.parse(record.observedAt) <= Date.parse(view.observedBefore)).map((record) => <tr key={record.id}><td><strong>{record.reference}</strong><span>{record.id}</span></td><td>{record.source.replaceAll("_", " ")}</td><td><span className="satya-tag">{recordTypes[record.type] || record.type.replaceAll("_", " ")}</span></td><td>{record.amount ? money(record.amount, record.currency) : "Quantity record"}</td><td>{new Date(record.observedAt).toLocaleString("en-IN", { timeZone:"Asia/Kolkata" })}</td><td><button onClick={() => openEvidence(record.id)} className="satya-evidence-chip"><FileSearch size={15} />View</button></td></tr>)}</tbody></table></div><div className="satya-notice">Tax amounts are shown as supplied. A tax identifier does not mean the record has been verified by the government.</div></Panel>}
        {tab === "Record connections" && <Panel title="How the records connect" detail="Follow the links from orders to deliveries, invoices and payments. A possible match does not confirm a payment.">{graphError && <div className="satya-notice warning">{graphError}</div>}<BusinessGraph graph={view.simulation ? view.graph : graph || view.graph} onSelect={openEvidence} /></Panel>}
        {tab === "Payments & matches" && <>
          <Panel title="Payments linked to invoices" detail="Only settled, linked amounts are shown here."><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Payment</th><th>Invoice</th><th>Amount applied</th><th>Link status</th></tr></thead><tbody>{view.paymentAllocations.map((item) => <tr key={`${item.paymentId}-${item.invoiceId}`}><td>{item.paymentId}</td><td>{item.invoiceId}</td><td>{money(item.amount, item.currency)}</td><td>{item.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>{!view.paymentAllocations.length && <p className="text-muted-foreground mt-3">No settled payments have been linked to an invoice.</p>}</Panel>
          <Panel title="Review possible matches" detail="Check the supporting records first. Add a reason before confirming a duplicate or linking a payment.">{reasonField("match-review-reason")}{view.duplicateCandidates.map((candidate) => <div className="satya-finding high" key={candidate.recordId}><h3>{candidate.recordId} may be the same invoice as {candidate.candidateOriginalId}</h3><p>The original records will remain visible after a confirmed duplicate is marked.</p><button disabled={cannotReview} className="satya-button secondary mt-3" onClick={() => decide("PLACE_ON_HOLD", undefined, { kind:"confirm_duplicate", recordId:candidate.recordId, originalId:candidate.candidateOriginalId })}>Confirm these are the same invoice</button></div>)}{view.unallocatedPayments.map((payment) => <div className="satya-finding" key={payment.paymentId}><h3>{payment.paymentId} · {money(payment.amount, payment.currency)} not yet linked</h3><p>Use the payment or remittance reference to confirm which invoice this transfer belongs to.</p><div className="satya-chat-sources">{payment.candidateInvoiceIds.map((invoiceId) => <button key={invoiceId} className="satya-button secondary" disabled={cannotReview} onClick={() => decide("REQUEST_CLARIFICATION", undefined, { kind:"allocate_payment", recordId:payment.paymentId, invoiceId })}>Link to {invoiceId}</button>)}</div>{!payment.candidateInvoiceIds.length && <p>No candidate invoice has been identified.</p>}</div>)}{!view.duplicateCandidates.length && !view.unallocatedPayments.length && <p className="text-muted-foreground mt-4">No possible duplicates or unlinked payments are listed.</p>}</Panel>
          <Panel title="Suggested record matches" detail="These are suggestions tested on demo data. A score is not a payment approval and does not change the balance."><div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Source line</th><th>Match score</th><th>Score type</th><th>Review</th></tr></thead><tbody>{view.matchSuggestions.map((item) => <tr key={`${item.recordId}-${item.lineId}`}><td>{item.recordId} / {item.lineId}</td><td>{item.probability === null ? `Score ${item.score.toFixed(2)}` : `${(item.probability * 100).toFixed(1)}%`}</td><td>{item.kind.replaceAll("_", " ")}</td><td>{data.records.find((record) => record.id === item.recordId)?.poId === data.poId || view.graph.edges.some((edge) => edge.source === item.recordId && edge.type === "CONFIRMED_MATCH") ? "Order link already recorded" : <button className="satya-evidence-chip" disabled={cannotReview} onClick={() => decide("REQUEST_CLARIFICATION", undefined, { kind:"link_invoice", recordId:item.recordId, poId:data.poId })}>Confirm order link</button>}</td></tr>)}</tbody></table></div>{!view.matchSuggestions.length && <p className="text-muted-foreground mt-3">No match suggestions are available for this investigation.</p>}</Panel>
        </>}

        {tab === "Anomalies & Evidence" && <>
          <Panel title={`Financial Anomalies (${data.anomalies?.length || 0})`} detail="Layered anomaly signals: duplicate invoice submissions, over-billing against PO, over-delivery, excess payment.">
            {data.anomalies?.map((anom) => (
              <article key={anom.id} className={`satya-finding ${anom.severity === "high" ? "high" : ""}`}>
                <div className="satya-case-card-top">
                  <h3>{anom.title}</h3>
                  <span className={`satya-status ${anom.severity === "high" ? "review" : "ok"}`}>{anom.confidence}</span>
                </div>
                <p>{anom.detail}</p>
                <p className="text-xs text-muted-foreground mt-1">Observed: <strong>{anom.observedValue}</strong> vs Baseline: <strong>{anom.baselineValue}</strong></p>
                <span className="satya-next">Action: {anom.action}</span>
              </article>
            ))}
            {(!data.anomalies || data.anomalies.length === 0) && <p className="text-muted-foreground">No financial anomalies detected for this order.</p>}
          </Panel>

          {data.evidenceCompleteness && <Panel title="Evidence Completeness Checklist" detail={`Completeness Ratio: ${(data.evidenceCompleteness.completenessRatio * 100).toFixed(0)}%`}>
            <div className="satya-table-wrap">
              <table className="satya-table">
                <thead><tr><th>Document / Record Requirement</th><th>Presence</th><th>Verification</th><th>Status</th></tr></thead>
                <tbody>
                  {data.evidenceCompleteness.checklist.map((item, idx) => (
                    <tr key={idx}>
                      <td><strong>{item.item}</strong></td>
                      <td>{item.present ? <span className="satya-status ok">Present</span> : <span className="satya-status review">Missing</span>}</td>
                      <td>{item.verified ? <span className="satya-status ok">Verified</span> : <span className="satya-status review">Unverified</span>}</td>
                      <td>{item.status === "complete" ? <span className="satya-status ok">Complete</span> : item.status === "missing" ? <span className="satya-status review">Missing</span> : <span className="satya-status">Info</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.evidenceCompleteness.missingItems.length > 0 && <div className="satya-notice warning mt-3">Missing essential evidence for approval: {data.evidenceCompleteness.missingItems.join(", ")}</div>}
          </Panel>}
        </>}

        {tab === "Documents" && <Panel title={`Source Documents (${documents.length})`} detail="Traceable evidence files associated with this transaction.">
          <div className="satya-table-wrap">
            <table className="satya-table">
              <thead><tr><th>Document Name</th><th>Type</th><th>Version</th><th>Verification Status</th><th>Verified By</th><th>Action</th></tr></thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td><strong>{doc.name}</strong><br /><small className="text-muted-foreground">{doc.id}</small></td>
                    <td><span className="satya-tag">{doc.documentType}</span></td>
                    <td>v{doc.version || 1}</td>
                    <td><span className={`satya-status ${doc.verificationStatus === "verified" ? "ok" : doc.verificationStatus === "rejected" ? "review" : ""}`}>{doc.verificationStatus.replaceAll("_", " ")}</span></td>
                    <td>{doc.verifiedBy || "—"}</td>
                    <td>
                      {manager && doc.verificationStatus !== "verified" && (
                        <div className="flex gap-2">
                          <button className="satya-evidence-chip" disabled={busy} onClick={() => run(async () => {
                            await businessApi.verifyDocument(doc.id, { status: "verified" });
                            await load(true);
                            setNotice(`Document ${doc.name} marked verified.`);
                          })}><Check size={14} /> Verify</button>
                          <button className="satya-evidence-chip" disabled={busy} onClick={() => run(async () => {
                            const r = prompt("Rejection reason:");
                            if (!r) return;
                            await businessApi.verifyDocument(doc.id, { status: "rejected", reason: r });
                            await load(true);
                            setNotice(`Document ${doc.name} rejected.`);
                          })}><X size={14} /> Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {documents.length === 0 && <p className="text-muted-foreground mt-3">No source documents uploaded for this case.</p>}
        </>}

        {tab === "Review history" && <Panel title="Decisions recorded for this order">{data.decisions?.length ? data.decisions.map((decision) => <article className="satya-finding" key={decision.id}><h3>{actions.find((action) => action.value === decision.action)?.label || decision.action.replaceAll("_", " ")}</h3><p>{decision.reason}</p>{decision.previousStatus && decision.newStatus && <p className="text-xs"><span className={`satya-status ${decision.previousStatus === "reconciled" ? "ok" : "review"}`}>{decision.previousStatus.replaceAll("_", " ")}</span> → <span className={`satya-status ${decision.newStatus === "reconciled" ? "ok" : "review"}`}>{decision.newStatus.replaceAll("_", " ")}</span></p>}<small>{decision.actorName} · {new Date(decision.createdAt).toLocaleString("en-IN", { timeZone:"Asia/Kolkata" })} IST · Internal review only</small></article>) : <p className="text-muted-foreground">No decisions have been saved yet. Finance managers can record a decision from the Summary tab.</p>}</Panel>}
      </div>
      {!!view.warnings.length && <div className="satya-notice"><strong>Record limitations</strong><ul className="satya-list mt-2">{view.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    </>}
    <Dialog.Root open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Overlay className="satya-evidence-overlay" /><Dialog.Content className="satya-drawer satya-evidence-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); focusTarget.current?.focus(); }}>{selected && <><Dialog.Close className="satya-drawer-close" aria-label="Close evidence"><X size={22} /></Dialog.Close><p className="satya-eyebrow">Source evidence</p><Dialog.Title asChild><h2>{selected.reference}</h2></Dialog.Title><Dialog.Description className="text-muted-foreground">The original value and the record it came from.</Dialog.Description><dl><dt>Record / source</dt><dd>{selected.recordId} · {selected.source.replaceAll("_", " ")}</dd><dt>Field</dt><dd>{selected.field.replaceAll("_", " ")}</dd><dt>{selected.rawValue === null ? "Calculated value, not an original source field" : "Original source value"}</dt><dd>{selected.rawValue ?? selected.derivedValue ?? "Not available"}</dd><dt>Where to find it</dt><dd>{selected.locator.kind === 'csv_cell' ? `CSV row ${selected.locator.row}, column ${selected.locator.column}` : selected.locator.pointer || "Stored calculation; see its input records"}</dd><dt>Where it came from</dt><dd>{selected.provenance.replaceAll("_", " ")}</dd><dt>Quality / verification limits</dt><dd>{selected.quality.replaceAll("_", " ")}</dd></dl>{selected.normalizedValue && <p className="satya-notice">Mapped value used in checks: {selected.normalizedValue}</p>}{sourceError && <p role="alert" className="satya-notice error">{sourceError}</p>}{sourceDocument && <details><summary>Original CSV · {sourceDocument.name}</summary><pre className="mt-4">{sourceDocument.content}</pre></details>}<details><summary>Original record data</summary><pre className="mt-4">{JSON.stringify(data?.records.find((record) => record.id === selected.recordId), null, 2) || "No original record is available in this view."}</pre></details></>}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </BusinessShell>;
}
