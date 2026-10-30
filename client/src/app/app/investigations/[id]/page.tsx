"use client";

// Investigation detail (/app/investigations/[id]) — docs/plan/06 §5.6.
// Answer first: the recommendation banner and the three balances, then the
// issues, the money trail, and the decisions behind it all.

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, FileSearch, FileDown, X, ArrowUpRight, GitBranch } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import dynamic from "next/dynamic";
const MoneyTrail = dynamic(() => import("@/components/v2/money-trail").then((m) => m.MoneyTrail), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-2)]" />,
});
import {
  Money, DateText, StatusBadge, CertaintyBadge, SeverityBadge,
  ActionButton, ErrorState, EmptyState, FadeIn, Card, PageHeader,
} from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE_TERMS } from "@/content/copy/vocabulary";
import { DocPreviewModal } from "@/components/v2/doc-preview";
import type { Finding, Evidence } from "@/lib/api/types";

function EvidenceDrawer({ evidence, onClose }: { evidence: Evidence; onClose: () => void }) {
  return (
    <aside
      role="dialog"
      aria-label="Evidence detail"
      className="fixed inset-y-0 right-0 z-40 w-80 border-l border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-2)]"
    >
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Evidence</h2>
        <button type="button" onClick={onClose} aria-label="Close evidence" className="text-[var(--muted)] hover:text-[var(--ink)]">
          <X size={16} />
        </button>
      </div>
      <dl className="mt-4 space-y-3 text-xs">
        <div><dt className="text-[var(--muted)]">Document</dt><dd className="mt-0.5 font-medium text-[var(--ink)]">{evidence.documentType} · <span className="font-code">{evidence.documentId}</span></dd></div>
        <div><dt className="text-[var(--muted)]">Field</dt><dd className="mt-0.5 font-code text-[var(--ink)]">{evidence.field}</dd></div>
        {evidence.value && <div><dt className="text-[var(--muted)]">Value read</dt><dd className="tnum mt-0.5 font-medium text-[var(--ink)]">{evidence.value}</dd></div>}
        {evidence.locator?.quote && (
          <div>
            <dt className="text-[var(--muted)]">Source text</dt>
            <dd className="mt-1 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-3 py-2 font-code text-[11px] leading-relaxed text-[var(--accent-strong)]">“{evidence.locator.quote}”</dd>
          </div>
        )}
        <div>
          <dt className="text-[var(--muted)]">Where it was found</dt>
          <dd className="mt-0.5 text-[var(--ink-2)]">
            {evidence.locator.kind === "pdf_text" && `PDF text${evidence.locator.page ? `, page ${evidence.locator.page}` : ""}`}
            {evidence.locator.kind === "pdf_region" && `PDF region${evidence.locator.page ? `, page ${evidence.locator.page}` : ""}`}
            {evidence.locator.kind === "csv_cell" && `CSV cell${evidence.locator.row ? ` row ${evidence.locator.row}` : ""}${evidence.locator.column ? `, ${evidence.locator.column}` : ""}`}
            {evidence.locator.kind === "json_path" && <span className="font-code">{evidence.locator.path}</span>}
            {evidence.locator.kind === "qr_field" && "Verified e-invoice QR"}
            {evidence.locator.kind === "manual" && "Entered by hand"}
          </dd>
        </div>
        <div><dt className="text-[var(--muted)]">Observed</dt><dd className="mt-0.5 text-[var(--ink-2)]"><DateText value={evidence.observedAt} withTime /></dd></div>
      </dl>
      <a
        href={`/app/documents/${evidence.documentId}`}
        className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
      >
        Open document <ArrowUpRight size={12} />
      </a>
    </aside>
  );
}

function exposureText(finding: Finding): string | null {
  if (!finding.exposure) return null;
  if ("amount" in finding.exposure) return `≈ ${finding.exposure.amount} at risk`;
  return null;
}

function FindingCard({ finding, onAsk, onEvidence }: { finding: Finding; onAsk: () => void; onEvidence: (e: Evidence) => void }) {
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <CertaintyBadge certainty={finding.certainty} />
        {exposureText(finding) && finding.exposure && "amount" in finding.exposure ? (
          <span className="text-xs font-medium text-[var(--sev-high)]">
            <Money value={finding.exposure} /> at risk
          </span>
        ) : null}
        {finding.harmlessVariance ? <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--muted)]">harmless variance</span> : null}
      </div>
      <h3 className="mt-2.5 text-sm font-semibold text-[var(--ink)]">{finding.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-2)]">{finding.explanation}</p>
      {finding.candidates?.length ? (
        <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--unclear-soft)] p-3">
          <p className="text-xs font-medium text-[var(--unclear)]">It could be more than one thing — Satya will not guess:</p>
          <ul className="mt-1.5 space-y-1">
            {finding.candidates.map((candidate) => (
              <li key={candidate.documentId} className="text-xs text-[var(--ink-2)]">• {candidate.why}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-[var(--ink-2)]"><span className="font-medium">What would settle this:</span> {finding.whatResolvesIt}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {finding.evidence.slice(0, 4).map((evidence) => (
          <button
            key={evidence.id}
            type="button"
            onClick={() => onEvidence(evidence)}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
          >
            <FileSearch size={11} aria-hidden="true" /> {evidence.documentType} · {evidence.field}
          </button>
        ))}
        <button type="button" onClick={onAsk} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
          <Sparkles size={12} aria-hidden="true" /> Ask Satya about this
        </button>
      </div>
    </article>
  );
}

export default function InvestigationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["case", id], queryFn: () => v2.case(id) });
  const { data: graph } = useQuery({
    queryKey: ["graph", id],
    queryFn: () => v2.graph(id),
    enabled: !!data,
  });
  const [openEvidence, setOpenEvidence] = useState<Evidence | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const CHECK_STEPS = ["Reading the documents", "Linking the money trail", "Asking the engine", "Scoring findings"];
  const [checkStep, setCheckStep] = useState(0);
  useEffect(() => {
    if (!checking) { setCheckStep(0); return; }
    const t = setInterval(() => setCheckStep((s) => (s + 1) % CHECK_STEPS.length), 1400);
    return () => clearInterval(t);
  }, [checking]);

  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState<string | null>(null);
  const [scenarioResult, setScenarioResult] = useState<Record<string, unknown> | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const decide = async (action: string) => {
    setDeciding(true); setDecideError(null);
    try {
      const reason = action === "APPROVE" ? "Approved from the investigation workbench." : action === "REQUEST_CLARIFICATION" ? "Clarification requested from the investigation workbench." : `Decision recorded: ${action.replaceAll("_", " ").toLowerCase()}.`;
      await v2.caseDecision(id, { action, reason, expectedRevision: data?.case?.revision, snapshotId: null });
      await refetch();
    } catch (e) {
      setDecideError(e instanceof Error ? e.message : "Could not record the decision.");
    } finally { setDeciding(false); }
  };

  const runScenario = async (label: string, changes: Record<string, unknown>[]) => {
    setScenarioBusy(label); setScenarioResult(null); setScenarioError(null);
    try {
      const { job } = await v2.caseScenario(id, changes);
      if (!job?.id) throw new Error("The engine did not start the scenario.");
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await v2.job(job.id);
        if (j.status === "completed") {
          const snap = await v2.caseSnapshot(id, (j.result as { snapshotId?: string })?.snapshotId || undefined);
          setScenarioResult(snap as unknown as Record<string, unknown>);
          return;
        }
        if (j.status === "dead") throw new Error(j.error || "The scenario failed — try again.");
      }
      throw new Error("Still running — refresh in a moment.");
    } catch (e) {
      setScenarioError(e instanceof Error ? e.message : "Could not run the scenario.");
    } finally { setScenarioBusy(null); }
  };

  const runCheck = async () => {
    setChecking(true); setCheckError(null);
    try {
      const { job } = await v2.reconcileCase(id);
      if (job?.id) {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const j = await v2.job(job.id);
          if (j.status === "completed") { await refetch(); return; }
          if (j.status === "dead") throw new Error(j.error || "The check failed — try again.");
        }
        throw new Error("The check is still running — refresh in a moment.");
      }
      await refetch();
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "Could not start the check.");
    } finally {
      setChecking(false);
    }
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Investigation not found."} onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-80 w-full" /></div>;

  const { case: caseData, snapshot, documents, decisions } = data;
  if (!snapshot) {
    return (
      <FadeIn className="space-y-5">
        <PageHeader title={caseData.title || id} description="This check has not been reconciled yet — run the check to build evidence." />
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--line)] bg-[var(--surface)] py-14 text-center">
          <FileSearch size={26} className="text-[var(--muted)]" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">{checking ? "Checking…" : "No findings yet"}</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--muted)]">
              {checking
                ? "The engine is reconstructing this case — usually a few seconds."
                : "Satya has not checked this case yet. Run the check to see findings, balances and the money trail."}
            </p>
          </div>
          {!checking && (
            <button
              type="button"
              onClick={runCheck}
              className="mt-1 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)]"
            >
              Run check
            </button>
          )}
          {checking && (
            <div className="flex flex-col items-center gap-3 pt-1">
              <div className="relative h-14 w-14">
                <div className="absolute inset-0 rounded-full border-2 border-[var(--accent)]/15" />
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--accent)] [animation-duration:1.1s]" />
                <div className="absolute inset-2.5 grid place-items-center rounded-full bg-[var(--accent-soft)]/60">
                  <GitBranch size={16} className="animate-pulse text-[var(--accent-strong)]" aria-hidden="true" />
                </div>
              </div>
              <p className="text-sm font-medium text-[var(--ink)]">{CHECK_STEPS[checkStep]}…</p>
              <div className="flex gap-1.5">
                {CHECK_STEPS.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i <= checkStep ? "w-6 bg-[var(--accent)]" : "w-3 bg-[var(--surface-2)]"}`} />
                ))}
              </div>
              <p className="text-[11px] text-[var(--muted)]">The engine is reconstructing this case — usually a few seconds.</p>
            </div>
          )}
          {checkError && <p className="text-xs text-[var(--sev-critical)]">{checkError}</p>}
        </div>
      </FadeIn>
    );
  }
  const recommendation = snapshot.recommendation;
  const balances = snapshot.balances;
  const sortedFindings = [...snapshot.findings].sort(
    (a, b) => ["critical", "high", "medium", "low", "info"].indexOf(a.severity) - ["critical", "high", "medium", "low", "info"].indexOf(b.severity),
  );
  const ask = (about: string) => router.push(`/app/ask?about=${encodeURIComponent(about)}&case=${id}`);

  return (
    <FadeIn className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">{caseData.title}</h1>
        <StatusBadge status={caseData.status} />
        <button
          type="button"
          onClick={async () => {
            const { downloadEvidencePack } = await import("@/components/v2/evidence-pack");
            await downloadEvidencePack(data);
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--ink)]"
        >
          <FileDown size={13} aria-hidden="true" /> Evidence pack
        </button>
      </div>

      {/* recommendation banner */}
      <div className="glow-accent relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] border-l-4 border-l-[var(--sev-high)] bg-[var(--surface)] p-5 shadow-[var(--shadow-2)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--sev-high)]">Recommended next step</p>
        <p className="mt-2 text-base font-medium leading-relaxed text-[var(--ink)]">
          {recommendation?.reasons?.length ? recommendation.reasons.join(" ") : "Review the issues below and decide the next step."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {recommendation?.action && <ActionButton action={recommendation.action} amount={recommendation.scope?.holdAmount} onClick={() => decide(recommendation.action)} disabled={deciding} />}
          {recommendation?.scope?.approveAmount && (
            <ActionButton action="APPROVE" amount={recommendation.scope.approveAmount} onClick={() => decide("APPROVE")} disabled={deciding} />
          )}
          <ActionButton
            action="REQUEST_CLARIFICATION"
            onClick={() => decide("REQUEST_CLARIFICATION")}
            disabled={deciding}
          />
        </div>
        {decideError && <p className="mt-2 text-xs text-[var(--sev-critical)]">{decideError}</p>}
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          These record your decision — the person who created a document cannot decide on it themselves.
        </p>
      </div>

      {/* three balances */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {balances && (
          <>
            {[
              { label: BALANCE_TERMS.evidenceSupportedPayable.label, tip: BALANCE_TERMS.evidenceSupportedPayable.tip, value: balances.supported, tone: "var(--confirmed)" },
              { label: BALANCE_TERMS.disputedExposure.label, tip: BALANCE_TERMS.disputedExposure.tip, value: balances.disputed, tone: "var(--sev-high)" },
              { label: BALANCE_TERMS.recordedPayable.label, tip: BALANCE_TERMS.recordedPayable.tip, value: balances.recorded, tone: "var(--ink)" },
            ].map((balance) => (
              <Card key={balance.label} hover className="relative overflow-hidden">
                <span className="absolute inset-x-5 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${balance.tone}, transparent)` }} aria-hidden="true" />
                <p className="text-[13px] text-[var(--muted)]">{balance.label}</p>
                <p className="mt-2.5 text-[26px] font-semibold tnum tracking-tight" style={{ color: balance.tone }}>
                  <Money value={balance.value} />
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{balance.tip}</p>
              </Card>
            ))}
          </>
        )}
      </div>

      <Tabs defaultValue="summary">
        <TabsList className="flex-wrap">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="graph">Money trail</TabsTrigger>
          <TabsTrigger value="calculations">Calculations</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="decisions">Decisions & audit</TabsTrigger>
          <TabsTrigger value="whatif">What-if</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="space-y-3">
            {sortedFindings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} onAsk={() => ask(finding.title)} onEvidence={setOpenEvidence} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="graph">
          {graph ? <MoneyTrail graph={graph} onAskAbout={ask} /> : <Skeleton className="h-[420px] w-full" />}
        </TabsContent>

        <TabsContent value="calculations">
          <div className="space-y-4">
            {Array.isArray(snapshot.ledger) && snapshot.ledger.length > 0 && (
              <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-semibold text-[var(--ink)]">Per order line — the math</h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">What was ordered, what arrived, what was accepted and what got billed.</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
                        <th className="py-2 pr-4 font-medium">Order line</th>
                        <th className="py-2 pr-4 text-right font-medium">Ordered</th>
                        <th className="py-2 pr-4 text-right font-medium">Received</th>
                        <th className="py-2 pr-4 text-right font-medium">Accepted</th>
                        <th className="py-2 pr-4 text-right font-medium">Invoiced</th>
                        <th className="py-2 text-right font-medium">Billed value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.ledger.map((row: Record<string, string>, i: number) => {
                        const po = documents.find((d) => d.id === row.poId);
                        const billed = Number(row.invoicedValue || 0);
                        return (
                          <tr key={i} className="border-b border-[var(--line)]/60 last:border-0">
                            <td className="py-2.5 pr-4 font-code text-xs text-[var(--ink-2)]">{po?.number || row.poId}{row.poLineNo ? ` · line ${row.poLineNo}` : ""}</td>
                            <td className="py-2.5 pr-4 text-right tnum">{row.ordered || "0"}</td>
                            <td className="py-2.5 pr-4 text-right tnum">{row.received || "0"}</td>
                            <td className="py-2.5 pr-4 text-right tnum">{row.accepted || "0"}</td>
                            <td className="py-2.5 pr-4 text-right tnum">{row.invoicedQty || "0"}</td>
                            <td className={`py-2.5 text-right tnum${billed > 0 ? " text-[var(--ink)] font-medium" : ""}`}>{billed ? <Money value={row.invoicedValue} /> : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {sortedFindings.filter((f) => f.calculation.length).map((finding) => (
              <div key={finding.id} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-semibold text-[var(--ink)]">{finding.title}</h3>
                <ol className="mt-2 space-y-1.5">
                  {finding.calculation.map((step, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm text-[var(--ink-2)]">
                      <span>{i + 1}. {step.step}{step.formula ? <span className="font-code text-xs text-[var(--muted)]"> · {step.formula}</span> : null}</span>
                      {step.value ? <span className="tnum font-medium text-[var(--ink)]">{step.value}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {sortedFindings.every((f) => !f.calculation.length) && (
              <p className="text-sm text-[var(--muted)]">No calculation steps recorded for this snapshot.</p>
            )}
            {Array.isArray(snapshot.lines) && snapshot.lines.length > 0 && (
              <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-semibold text-[var(--ink)]">Order line lifecycle</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]">
                        <th className="py-2 pr-3">Line</th><th className="pr-3">Ordered</th><th className="pr-3">Received</th>
                        <th className="pr-3">Accepted</th><th className="pr-3">Invoiced</th><th className="pr-3">Paid</th><th>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.lines.map((line) => (
                        <tr key={line.lineNo} className="border-b border-[var(--line)] last:border-0 text-[var(--ink-2)]">
                          <td className="tnum py-2 pr-3 font-code text-xs">{line.lineNo}</td>
                          <td className="tnum pr-3">{line.ordered}</td>
                          <td className="tnum pr-3">{line.received}</td>
                          <td className="tnum pr-3">{line.accepted}</td>
                          <td className="tnum pr-3">{line.invoiced}</td>
                          <td className="tnum pr-3">{line.paid}</td>
                          <td className="tnum">{line.open}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="documents">
          {documents.length === 0 ? (
            <EmptyState title="No documents linked" body="Subject documents appear here once this case has been built." />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => (
                <li key={doc.id} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--ink)]">{doc.number}</p>
                    <StatusBadge status={doc.status} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{doc.type} · <DateText value={doc.date} /></p>
                  {doc.amount && <p className="tnum mt-2 text-sm font-medium text-[var(--ink)]"><Money value={doc.amount} /></p>}
                  {doc.finding && <p className="mt-2 text-xs text-[var(--sev-high)]">{doc.finding}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {doc.type === "PO" && (
                      <Link href={`/app/orders/${doc.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
                        Open order <ArrowUpRight size={12} />
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setPreviewDocId(doc.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      <FileDown size={12} /> Preview
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="decisions">
          <ol className="relative space-y-4 border-l border-[var(--line)] pl-5">
            {decisions.map((decision) => (
              <li key={decision.id}>
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                <p className="text-sm text-[var(--ink)]">
                  {decision.action.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                  {"scope" in decision && decision.scope ? <> · <Money value={decision.scope} /></> : null}
                </p>
                <p className="mt-0.5 text-sm text-[var(--ink-2)]">{decision.reason}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{decision.actor} · {decision.role.replaceAll("_", " ")} · <DateText value={decision.createdAt} withTime /></p>
              </li>
            ))}
          </ol>
        </TabsContent>

        <TabsContent value="whatif">
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--line)] bg-[var(--surface)] p-6">
            <p className="text-sm font-medium text-[var(--ink)]">Try a scenario — nothing is saved</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Preview how balances and issues change under different realities — nothing is saved. Pick a scenario and the engine re-checks the case as if it were true.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {documents.filter((d) => d.type === "INVOICE_IN").slice(0, 1).map((inv) => (
                <button key="reject" type="button" disabled={!!scenarioBusy} onClick={() => runScenario(`Reject ${inv.number || inv.id}`, [{ op: "remove_document", documentId: inv.id }])}
                  className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/60 disabled:opacity-50">
                  {scenarioBusy ? scenarioBusy : `If ${inv.number || "the invoice"} is rejected…`}
                </button>
              ))}
              {documents.filter((d) => d.type === "PAYMENT_OUT").slice(0, 1).map((pay) => documents.filter((d) => d.type === "INVOICE_IN").slice(0, 1).map((inv) => (
                <button key="settle" type="button" disabled={!!scenarioBusy} onClick={() => runScenario("Apply payment to invoice", [{ op: "add_link", link: { fromId: pay.id, toId: inv.id, kind: "SETTLES", certainty: "CONFIRMED", basis: "reference" } }])}
                  className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/60 disabled:opacity-50">
                  If {(pay as { payment?: { utr?: string } }).payment?.utr || pay.number || "the transfer"} covers {inv.number || "the invoice"}…
                </button>
              )))}
              {documents.filter((d) => d.type === "PO").slice(0, 1).map((po) => documents.filter((d) => d.type === "INVOICE_IN").slice(0, 1).map((inv) => (
                <button key="dup" type="button" disabled={!!scenarioBusy} onClick={() => runScenario("Remove the invoice", [{ op: "remove_document", documentId: inv.id }])}
                  className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/60 disabled:opacity-50">
                  If {po.number || "the order"} was never billed…
                </button>
              )))}
              {!documents.some((d) => d.type === "INVOICE_IN") && !documents.some((d) => d.type === "PAYMENT_OUT") && (
                <p className="text-xs text-[var(--muted)]">No invoices or payments in this case yet — scenarios need documents to act on.</p>
              )}
            </div>
            {scenarioError && <p className="mt-3 text-xs text-[var(--sev-critical)]">{scenarioError}</p>}
            {scenarioBusy && <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">Running “{scenarioBusy}”…</p>}
            {scenarioResult && (() => {
              const b = (scenarioResult.snapshot as Record<string, unknown> | undefined)?.balances as Record<string, string> | undefined;
              const f = (scenarioResult.snapshot as Record<string, unknown> | undefined)?.findings as unknown[] | undefined;
              return (
                <div className="mt-4 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--ink-2)]">
                  <p className="font-medium text-[var(--ink)]">Scenario result — not saved</p>
                  <p className="mt-1">
                    Owed: <Money value={b?.evidenceSupportedPayable || b?.recordedPayable || "0"} /> · Recorded: <Money value={b?.recordedPayable || "0"} /> · Under question: <Money value={b?.disputedExposure || "0"} /> · Findings: {f?.length ?? 0}
                  </p>
                </div>
              );
            })()}
          </div>
        </TabsContent>
      </Tabs>
      {openEvidence && <EvidenceDrawer evidence={openEvidence} onClose={() => setOpenEvidence(null)} />}
      {previewDocId && <DocPreviewModal documentId={previewDocId} onClose={() => setPreviewDocId(null)} />}
    </FadeIn>
  );
}

