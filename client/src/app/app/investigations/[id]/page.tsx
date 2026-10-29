"use client";

// Investigation detail (/app/investigations/[id]) — docs/plan/06 §5.6.
// Answer first: the recommendation banner and the three balances, then the
// issues, the money trail, and the decisions behind it all.

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, FileSearch, FileDown, X, ArrowUpRight } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import dynamic from "next/dynamic";
const MoneyTrail = dynamic(() => import("@/components/v2/money-trail").then((m) => m.MoneyTrail), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-2)]" />,
});
import {
  Money, DateText, StatusBadge, CertaintyBadge, SeverityBadge,
  ActionButton, ErrorState,
} from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE_TERMS } from "@/content/copy/vocabulary";
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

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Investigation not found."} onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-80 w-full" /></div>;

  const { case: caseData, snapshot, documents, decisions } = data;
  const recommendation = snapshot.recommendation;
  const balances = snapshot.balances;
  const sortedFindings = [...snapshot.findings].sort(
    (a, b) => ["critical", "high", "medium", "low", "info"].indexOf(a.severity) - ["critical", "high", "medium", "low", "info"].indexOf(b.severity),
  );
  const ask = (about: string) => router.push(`/app/ask?about=${encodeURIComponent(about)}&case=${id}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">{caseData.title}</h1>
        <StatusBadge status={caseData.status} />
        <button
          type="button"
          onClick={async () => {
            const { downloadEvidencePack } = await import("@/components/v2/evidence-pack");
            await downloadEvidencePack(data);
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)]"
        >
          <FileDown size={13} aria-hidden="true" /> Evidence pack
        </button>
      </div>

      {/* recommendation banner */}
      <div className="rounded-[var(--radius-md)] border-l-4 border-[var(--sev-high)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
        <p className="text-base font-medium leading-relaxed text-[var(--ink)]">
          {recommendation.reasons.join(" ")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton action={recommendation.action} amount={recommendation.scope?.holdAmount} />
          {recommendation.scope?.approveAmount && (
            <ActionButton action="APPROVE" amount={recommendation.scope.approveAmount} />
          )}
          <ActionButton
            action="REQUEST_CLARIFICATION"
            onClick={() => ask("Draft a message to the supplier asking which invoice the ₹15,000 transfer is for")}
          />
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          These record your decision — the person who created a document cannot decide on it themselves.
        </p>
      </div>

      {/* three balances */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {balances && (
          <>
            <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-sm text-[var(--muted)]">{BALANCE_TERMS.evidenceSupportedPayable.label}</p>
              <p className="mt-2 text-[26px] font-semibold tnum text-[var(--confirmed)]"><Money value={balances.supported} /></p>
              <p className="mt-1 text-xs text-[var(--muted)]">{BALANCE_TERMS.evidenceSupportedPayable.tip}</p>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-sm text-[var(--muted)]">{BALANCE_TERMS.disputedExposure.label}</p>
              <p className="mt-2 text-[26px] font-semibold tnum text-[var(--sev-high)]"><Money value={balances.disputed} /></p>
              <p className="mt-1 text-xs text-[var(--muted)]">{BALANCE_TERMS.disputedExposure.tip}</p>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-sm text-[var(--muted)]">{BALANCE_TERMS.recordedPayable.label}</p>
              <p className="mt-2 text-[26px] font-semibold tnum text-[var(--ink)]"><Money value={balances.recorded} /></p>
              <p className="mt-1 text-xs text-[var(--muted)]">{BALANCE_TERMS.recordedPayable.tip}</p>
            </div>
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
          </div>
        </TabsContent>

        <TabsContent value="documents">
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
              </li>
            ))}
          </ul>
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
              Preview how balances and issues change if, say, the remaining 40 pumps arrive, or T03 turns out to pay INV-042.
              The scenario builder connects to <span className="font-code">POST /cases/:id/scenarios</span> once the engine is wired.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-2)]">If the remaining 40 pumps arrive…</button>
              <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-2)]">If T03 is for INV-042…</button>
              <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-2)]">If the second INV-041 is rejected…</button>
            </div>
            <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
              Preview — nothing saved.
            </p>
          </div>
        </TabsContent>
      </Tabs>
      {openEvidence && <EvidenceDrawer evidence={openEvidence} onClose={() => setOpenEvidence(null)} />}
    </div>
  );
}

