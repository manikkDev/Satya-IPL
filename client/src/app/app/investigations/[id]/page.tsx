"use client";

// Order check detail (/app/investigations/[id]).
// Answer first: Satya's recommended decision, why, and the three figures it
// rests on — with the decision buttons right there and what happens after.
// Below, tabs hold the evidence: issues, money trail, calculations,
// documents, decision history, what-if and follow-up.

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import {
  MessageSquare, FileSearch, FileDown, X, GitBranch, ChevronLeft, RefreshCw, ShoppingCart, CheckCircle2,
  ChevronDown, Eye, History, FlaskConical, ArrowRight,
} from "lucide-react";
import { ConfirmDialog } from "@/components/v2/confirm-dialog";
import { CaseWorkflow } from "@/components/v2/case-workflow";
import { DocPreviewModal } from "@/components/v2/doc-preview";
import { useSession } from "@/components/v2/session";
import { toPaise, formatMoney, formatQty } from "@/lib/format";
import { v2 } from "@/lib/api/v2";
import {
  Money, DateText, StatusBadge, CertaintyBadge, SeverityBadge, ErrorState, EmptyState, FadeIn, Card,
  PageHeader, Btn, InfoTip, Callout, ToneBadge, ResponsiveTable, RowActions, type Column } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE_TERMS, roleLabel } from "@/content/copy/vocabulary";
import {
  findingLabel, findingSettle, tidyText, RECOMMENDATION_HEADLINE, DECISION_VERB, DECISION_AFTER, decisionDone,
} from "@/content/copy/findings";
import { docTypeLabel } from "@/components/pages/documents/labels";
import { splitCaseTitle } from "@/components/pages/shared/case-title";
import { pageTabsList, pageTabsTrigger, tabCount } from "@/components/pages/shared/page-tabs";
import type { Finding, Evidence } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const MoneyTrail = dynamic(() => import("@/components/v2/money-trail").then((m) => m.MoneyTrail), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-2)]" />,
});

type CaseDoc = { id: string; type?: string; number?: string; date?: string; status: string; amount?: unknown; finding?: string; payment?: { utr?: string } };
type DecisionRow = { id: string; action: string; reason: string; actor: string; role: string; createdAt: string; scope?: unknown };
type FindingRow = Finding & { status?: string };

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];
const isPositive = (v: unknown) => toPaise(v as Parameters<typeof toPaise>[0]) > BigInt(0);

/* ---------- evidence ---------- */

function EvidenceDrawer({ evidence, doc, onClose, onPreview }: { evidence: Evidence; doc?: CaseDoc; onClose: () => void; onPreview: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const loc = evidence.locator ?? { kind: "manual" };
  return (
    <aside role="dialog" aria-label="Evidence detail" className="fixed inset-y-0 right-0 z-40 w-full max-w-sm border-l border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-3)]">
      <div className="flex items-start justify-between">
        <h2 className="text-[17px] font-semibold text-[var(--ink)]">Evidence</h2>
        <button type="button" onClick={onClose} aria-label="Close evidence" className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
          <X size={17} />
        </button>
      </div>
      <dl className="mt-5 space-y-4 text-[15px]">
        <div>
          <dt className="text-[13px] text-[var(--muted)]">Document</dt>
          <dd className="mt-0.5 font-medium text-[var(--ink)]">{docTypeLabel(doc?.type ?? evidence.documentType)} {doc?.number ?? ""}</dd>
        </div>
        {evidence.field ? (
          <div>
            <dt className="text-[13px] text-[var(--muted)]">Field</dt>
            <dd className="mt-0.5 text-[var(--ink)]">{evidence.field.split(".").pop()?.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}</dd>
          </div>
        ) : null}
        {evidence.value ? (
          <div><dt className="text-[13px] text-[var(--muted)]">Value read</dt><dd className="tnum mt-0.5 font-medium text-[var(--ink)]">{evidence.value}</dd></div>
        ) : null}
        {loc.quote ? (
          <div>
            <dt className="text-[13px] text-[var(--muted)]">Source text</dt>
            <dd className="mt-1 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-3 py-2 text-[14px] leading-relaxed text-[var(--accent-strong)]">“{loc.quote}”</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[13px] text-[var(--muted)]">Where it was found</dt>
          <dd className="mt-0.5 text-[var(--ink-2)]">
            {loc.kind === "pdf_text" && `PDF text${loc.page ? `, page ${loc.page}` : ""}`}
            {loc.kind === "pdf_region" && `PDF region${loc.page ? `, page ${loc.page}` : ""}`}
            {loc.kind === "csv_cell" && `Spreadsheet${loc.row ? ` row ${loc.row}` : ""}${loc.column ? `, column ${loc.column}` : ""}`}
            {loc.kind === "json_path" && "Imported record"}
            {loc.kind === "qr_field" && "Verified e-invoice QR"}
            {loc.kind === "manual" && "Entered in Satya"}
          </dd>
        </div>
        {evidence.observedAt ? <div><dt className="text-[13px] text-[var(--muted)]">Recorded</dt><dd className="mt-0.5 text-[var(--ink-2)]"><DateText value={evidence.observedAt} withTime /></dd></div> : null}
      </dl>
      <Btn variant="secondary" size="sm" icon={Eye} className="mt-6" onClick={onPreview}>Preview document</Btn>
    </aside>
  );
}

/* ---------- one issue ---------- */

function IssueCard({
  finding, docs, canDecide, onAsk, onEvidence, onPreview, onResolve,
}: {
  finding: FindingRow;
  docs: Map<string, CaseDoc>;
  canDecide: boolean;
  onAsk: () => void;
  onEvidence: (e: Evidence) => void;
  onPreview: (docId: string) => void;
  onResolve: () => void;
}) {
  const resolved = finding.status && finding.status !== "open";
  const label = findingLabel(finding.code, finding.title);
  const detail = tidyText(finding.explanation || finding.title);
  const exposure = finding.exposure && "amount" in finding.exposure && isPositive(finding.exposure) ? finding.exposure : null;
  // one chip per document, not per field
  const evidenceDocs = [...new Map(finding.evidence.filter((e) => e.documentId).map((e) => [e.documentId, e])).values()];

  return (
    <article className={cn("rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5", resolved && "opacity-75")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {resolved ? <ToneBadge tone="good">{finding.status === "accepted_risk" ? "Risk accepted" : "Resolved"}</ToneBadge> : <SeverityBadge severity={finding.severity} />}
            <CertaintyBadge certainty={finding.certainty} short />
          </div>
          <h3 className="mt-3 text-[17px] font-semibold leading-snug text-[var(--ink)]">{label}</h3>
          {detail && detail !== label ? <p className="mt-1 text-[15px] leading-relaxed text-[var(--ink-2)]">{detail}</p> : null}
        </div>
        {exposure ? (
          <div className="shrink-0 sm:text-right">
            <p className="text-[13px] text-[var(--muted)]">At stake</p>
            <p className="text-[19px] font-semibold text-[var(--ink)] tnum"><Money value={exposure} /></p>
          </div>
        ) : null}
      </div>

      {finding.candidates?.length ? (
        <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <p className="text-[14px] font-medium text-[var(--ink)]">This could be more than one thing — Satya won’t guess:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-[var(--ink-2)]">
            {finding.candidates.map((c) => <li key={c.documentId}>{tidyText(c.why)}</li>)}
          </ul>
        </div>
      ) : null}

      {!resolved ? (
        <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-2)]">
          <span className="font-medium text-[var(--ink)]">What would settle it: </span>
          {findingSettle(finding.code, finding.whatResolvesIt)}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
        {evidenceDocs.slice(0, 4).map((e) => {
          const doc = docs.get(e.documentId);
          const hasDetail = !!(e.field || e.locator?.quote);
          return (
            <button
              key={e.documentId}
              type="button"
              onClick={() => (hasDetail ? onEvidence(e) : onPreview(e.documentId))}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3 text-[13px] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink)]"
            >
              <FileSearch size={14} aria-hidden="true" />
              {doc ? `${docTypeLabel(doc.type)} ${doc.number ?? ""}`.trim() : "Source document"}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <Btn variant="ghost" size="sm" icon={MessageSquare} onClick={onAsk}>Ask Satya</Btn>
          {!resolved && canDecide && finding.id && !finding.id.includes(":") ? (
            <Btn variant="secondary" size="sm" icon={CheckCircle2} onClick={onResolve}>Mark settled</Btn>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* ---------- page ---------- */

export default function InvestigationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["case", id], queryFn: () => v2.case(id) });
  const [tab, setTab] = useState("issues");
  const { data: graph } = useQuery({ queryKey: ["graph", id], queryFn: () => v2.graph(id), enabled: !!data && tab === "graph" });

  const [openEvidence, setOpenEvidence] = useState<Evidence | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const [pendingFinding, setPendingFinding] = useState<FindingRow | null>(null);
  const [lastDecided, setLastDecided] = useState<string | null>(null);
  const [showAfter, setShowAfter] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const [scenarioBusy, setScenarioBusy] = useState<string | null>(null);
  const [scenarioResult, setScenarioResult] = useState<{ label: string; data: Record<string, unknown> } | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  useEffect(() => {
    if (!checking) { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [checking]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const canDecide = hasPermission("finding.decide");
  const canCheck = canDecide || hasPermission("case.reconcile") || hasPermission("po.create");

  const decide = async (action: string, reason: string, findingId?: string) => {
    try {
      const revision = (data?.case as { revision?: number } | undefined)?.revision;
      const body: Parameters<typeof v2.caseDecision>[1] = {
        action, reason, expectedRevision: typeof revision === "number" && !findingId ? revision : undefined, snapshotId: null,
      };
      if (findingId) Object.assign(body, { findingId });
      await v2.caseDecision(id, body);
      toast.success(findingId ? "Issue marked as settled" : "Decision recorded");
      if (!findingId) setLastDecided(action);
      await refetch();
      // the re-check runs in the background; pick up its result shortly
      setTimeout(() => { if (alive.current) void refetch(); }, 4000);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not record the decision.";
      toast.error(message);
      throw e;
    }
  };

  const runScenario = async (label: string, changes: Record<string, unknown>[]) => {
    setScenarioBusy(label); setScenarioResult(null); setScenarioError(null);
    try {
      const { job } = await v2.caseScenario(id, changes);
      if (!job?.id) throw new Error("The checking engine did not start the scenario.");
      for (let i = 0; i < 40 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await v2.job(job.id);
        if (j.status === "completed") {
          const snap = await v2.caseSnapshot(id, (j.result as { snapshotId?: string })?.snapshotId || undefined);
          setScenarioResult({ label, data: snap as Record<string, unknown> });
          return;
        }
        if (j.status === "dead") throw new Error(j.error || "The scenario failed — try again.");
      }
      throw new Error("Still running — try again in a moment.");
    } catch (e) {
      setScenarioError(e instanceof Error ? e.message : "Could not run the scenario.");
    } finally { setScenarioBusy(null); }
  };

  const autoRan = useRef(false);
  const runCheck = async () => {
    setChecking(true); setCheckError(null); setJobStatus("queued");
    try {
      const { job } = await v2.reconcileCase(id);
      if (job?.id) {
        for (let i = 0; i < 60 && alive.current; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          if (!alive.current) return;
          const j = await v2.job(job.id);
          setJobStatus(j.status);
          if (j.status === "completed") {
            await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["graph", id] })]);
            toast.success("Check finished");
            return;
          }
          if (j.status === "dead" || j.status === "failed") throw new Error(j.error || "The check failed — try again.");
        }
        if (alive.current) throw new Error("The check is still running — refresh in a moment.");
        return;
      }
      await refetch();
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "Could not start the check.");
    } finally {
      setChecking(false);
    }
  };

  // A never-checked case is checked once on first open — only for users
  // allowed to run checks (read-only auditors just see the prompt).
  useEffect(() => {
    if (!autoRan.current && data && !data.snapshot && !checking && canCheck) {
      autoRan.current = true;
      void runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, checking, canCheck]);

  const docs = useMemo(() => (data?.documents ?? []) as unknown as CaseDoc[], [data]);
  const docMap = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const findings = useMemo<FindingRow[]>(() => {
    const live = ((data as { findings?: FindingRow[] } | undefined)?.findings ?? []) as FindingRow[];
    const snap = (data?.snapshot?.findings ?? []) as FindingRow[];
    const list = live.length ? live : snap;
    return [...list].sort((a, b) => {
      const ao = !a.status || a.status === "open" ? 0 : 1;
      const bo = !b.status || b.status === "open" ? 0 : 1;
      return ao - bo || SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);
    });
  }, [data]);

  if (error) return <ErrorState message={error instanceof Error ? error.message : "This check could not be found."} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-5 w-28" />
        <div className="space-y-2"><Skeleton className="h-4 w-56" /><Skeleton className="h-8 w-96 max-w-full" /><Skeleton className="h-4 w-80 max-w-full" /></div>
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { case: caseData, snapshot } = data;
  const decisions = (data.decisions ?? []) as unknown as DecisionRow[];
  const { supplier, reference } = splitCaseTitle(caseData.title, id);
  const orderDoc = docs.find((d) => d.type === "PO");
  const ask = (about: string) => router.push(`/app/ask?about=${encodeURIComponent(about)}&case=${id}`);

  const back = (
    <Link href="/app/investigations" className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--muted)] hover:text-[var(--ink)]">
      <ChevronLeft size={16} aria-hidden="true" /> To review
    </Link>
  );

  if (!snapshot) {
    return (
      <FadeIn className="space-y-6">
        {back}
        <PageHeader eyebrow={reference || "Order check"} title={supplier} description="Satya hasn’t checked this order yet." />
        <Card className="flex flex-col items-center py-12 text-center">
          {checking ? (
            <>
              <div className="relative h-14 w-14">
                <div className="absolute inset-0 rounded-full border-2 border-[var(--accent)]/15" />
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--accent)] [animation-duration:1.1s]" />
                <div className="absolute inset-2.5 grid place-items-center rounded-full bg-[var(--accent-soft)]/60">
                  <GitBranch size={16} className="text-[var(--accent-strong)]" aria-hidden="true" />
                </div>
              </div>
              <p className="mt-4 text-[17px] font-semibold text-[var(--ink)]">
                {jobStatus === "running" ? "Lining up the records" : "Starting the check"}… <span className="tnum font-normal text-[var(--muted)]">{elapsed}s</span>
              </p>
              <p className="mt-1.5 max-w-sm text-[15px] text-[var(--muted)]">Usually a few seconds. On a cold start the checking engine can take up to a minute.</p>
            </>
          ) : (
            <>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-2)]"><FileSearch size={22} className="text-[var(--ink-2)]" aria-hidden="true" /></div>
              <p className="mt-4 text-[17px] font-semibold text-[var(--ink)]">Run the check to see what doesn’t add up</p>
              <p className="mt-1.5 max-w-md text-[15px] text-[var(--muted)]">Satya lines up this order’s deliveries, bills and payments and lists anything that disagrees, with the evidence.</p>
              {canCheck ? <Btn className="mt-5" icon={RefreshCw} onClick={runCheck}>Run check</Btn> : <p className="mt-4 text-[14px] text-[var(--muted)]">Your role can view checks but not run them.</p>}
            </>
          )}
          {checkError ? <p className="mt-4 text-[14px] text-[var(--sev-critical)]">{checkError}</p> : null}
        </Card>
      </FadeIn>
    );
  }

  /* ---------- the recommendation ---------- */
  const rec = snapshot.recommendation as { action?: string; scope?: { holdAmount?: unknown; approveAmount?: unknown } } | null;
  const balances = snapshot.balances;
  const open = findings.filter((f) => !f.status || f.status === "open");
  const settled = findings.filter((f) => f.status && f.status !== "open");
  const serious = open.filter((f) => f.severity === "critical" || f.severity === "high");
  const recAction = rec?.action ?? (open.length ? "REVIEW" : "APPROVE");
  const headline =
    recAction === "APPROVE" && open.length
      ? `Can be approved once you’ve looked at ${open.length === 1 ? "one issue" : `${open.length} issues`}`
      : RECOMMENDATION_HEADLINE[recAction] ?? "Review the issues and decide";
  const labels = [...new Set(open.map((f) => findingLabel(f.code, f.title)))];
  const why = open.length
    ? `${open.length === 1 ? "1 open issue" : `${open.length} open issues`}${serious.length ? ` (${serious.length} serious)` : ""}: ${labels.slice(0, 2).map((l, i) => (i ? l.charAt(0).toLowerCase() + l.slice(1) : l)).join("; ")}${labels.length > 2 ? `; and ${labels.length - 2} more` : ""}.`
    : "The order, deliveries, bills and payments agree.";
  const tone = recAction === "APPROVE" && !serious.length ? "var(--confirmed)" : serious.length ? "var(--sev-high)" : "var(--sev-medium)";
  const supportedAmount = balances?.supported;
  // "Review" means a person must judge it — so the buttons offer the actual
  // judgements, led by asking the supplier (the usual first step).
  const primary = recAction === "REVIEW" ? "REQUEST_CLARIFICATION" : recAction;
  const secondary = primary === "REQUEST_CLARIFICATION" ? "PLACE_ON_HOLD" : "REQUEST_CLARIFICATION";
  const otherDecisions = ["APPROVE", "REQUEST_CLARIFICATION", "PLACE_ON_HOLD", "ESCALATE"].filter((a) => a !== primary && a !== secondary);
  const lastDecision = decisions[0];
  const allZero = balances && [balances.supported, balances.disputed, balances.recorded].every((v) => !isPositive(v));

  const figures = balances
    ? [
        { label: "Safe to pay", tip: BALANCE_TERMS.evidenceSupportedPayable.tip, value: balances.supported, strong: true },
        { label: "Under question", tip: BALANCE_TERMS.disputedExposure.tip, value: balances.disputed, warn: isPositive(balances.disputed) },
        { label: "Unpaid in books", tip: BALANCE_TERMS.recordedPayable.tip, value: balances.recorded },
      ]
    : [];

  /* ---------- documents table ---------- */
  const docColumns: Column<CaseDoc>[] = [
    {
      key: "doc", header: "Document", primary: true,
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--ink)]">{d.number || "Unnumbered"}</p>
          <p className="text-[13px] text-[var(--muted)]">{docTypeLabel(d.type)}</p>
        </div>
      ),
    },
    { key: "date", header: "Date", cell: (d) => <DateText value={d.date} /> },
    { key: "amount", header: "Amount", align: "right", cell: (d) => (d.amount ? <Money value={d.amount as never} /> : <span className="text-[var(--muted)]">—</span>) },
    { key: "status", header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
  ];

  /* ---------- what-if ---------- */
  const firstInvoice = docs.find((d) => d.type === "INVOICE_IN");
  const firstPayment = docs.find((d) => d.type === "PAYMENT_OUT");
  const scenarios: { label: string; hint: string; changes: Record<string, unknown>[] }[] = [];
  if (firstInvoice) {
    scenarios.push({
      label: `If invoice ${firstInvoice.number || ""} is rejected`.replace(/\s+/g, " "),
      hint: "As if the bill were cancelled — what would you still owe?",
      changes: [{ op: "remove_document", documentId: firstInvoice.id }],
    });
  }
  if (firstInvoice && firstPayment) {
    scenarios.push({
      label: `If payment ${firstPayment.payment?.utr || firstPayment.number || ""} settles invoice ${firstInvoice.number || ""}`.replace(/\s+/g, " "),
      hint: "As if the supplier confirmed the payment was for this bill.",
      changes: [{ op: "add_link", link: { fromId: firstPayment.id, toId: firstInvoice.id, kind: "SETTLES", certainty: "CONFIRMED", basis: "reference" } }],
    });
  }
  const scenarioSnap = (scenarioResult?.data?.snapshot ?? null) as { balances?: Record<string, string>; findings?: unknown[] } | null;
  const sb = scenarioSnap?.balances;

  return (
    <FadeIn className="space-y-8">
      <div className="space-y-4">
        {back}
        <PageHeader
          eyebrow={reference || "Order check"}
          title={<span className="inline-flex flex-wrap items-center gap-3">{supplier} <StatusBadge status={caseData.status} /></span>}
          description={open.length ? `${open.length === 1 ? "1 issue needs" : `${open.length} issues need`} a decision.` : "No open issues on this order."}
          actions={
            <>
              <Btn
                variant="secondary"
                icon={FileDown}
                onClick={async () => {
                  const { downloadEvidencePack } = await import("@/components/v2/evidence-pack");
                  await downloadEvidencePack(data);
                }}
              >
                Evidence pack
              </Btn>
              <RowActions
                label={supplier}
                items={[
                  ...(canCheck ? [{ label: checking ? "Checking…" : "Re-run the check", icon: RefreshCw, onSelect: () => void runCheck(), disabled: checking }] : []),
                  ...(orderDoc ? [{ label: "Open the order", icon: ShoppingCart, href: `/app/orders/${orderDoc.id}` }] : []),
                  { label: "Ask Satya about this order", icon: MessageSquare, onSelect: () => ask(supplier) },
                ]}
              />
            </>
          }
        />
      </div>

      {/* ---------- recommended decision ---------- */}
      <section aria-labelledby="rec-title" className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]" style={{ boxShadow: `inset 3px 0 0 ${tone}, var(--shadow-1)` }}>
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: tone }}>Satya recommends</p>
            <h2 id="rec-title" className="mt-1 text-[21px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ink)]">{headline}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{why}</p>

            {canDecide ? (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Btn onClick={() => setPendingDecision(primary)}>
                  {DECISION_VERB[primary] ?? "Decide"}
                  {primary === "APPROVE" && supportedAmount && isPositive(supportedAmount) ? ` ${formatMoney(supportedAmount)}` : ""}
                </Btn>
                <Btn variant="secondary" onClick={() => setPendingDecision(secondary)}>{DECISION_VERB[secondary]}</Btn>
                <RowActions
                  label="this decision"
                  items={otherDecisions.map((a) => ({ label: DECISION_VERB[a] ?? a, onSelect: () => setPendingDecision(a) }))}
                />
              </div>
            ) : (
              <p className="mt-5 text-[14px] text-[var(--muted)]">Your role can view this check but not record decisions.</p>
            )}

            <button
              type="button"
              onClick={() => setShowAfter((v) => !v)}
              aria-expanded={showAfter}
              className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-[var(--muted)] hover:text-[var(--ink)]"
            >
              What happens when I decide? <ChevronDown size={15} className={cn("transition-transform", showAfter && "rotate-180")} aria-hidden="true" />
            </button>
            {showAfter ? (
              <div className="rise mt-2 max-w-2xl space-y-1.5 text-[14px] leading-relaxed text-[var(--ink-2)]">
                <p>{DECISION_AFTER[primary] ?? DECISION_AFTER.REVIEW}</p>
                <p className="text-[var(--muted)]">Every decision needs a reason and is kept in the History tab. Someone who created a document can’t decide on it themselves.</p>
              </div>
            ) : null}
          </div>

          {figures.length ? (
            <dl className="grid grid-cols-1 gap-3 border-t border-[var(--line)] pt-5 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              {figures.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-3 sm:block lg:flex">
                  <dt className="flex items-center gap-1 text-[14px] text-[var(--muted)]">{f.label} <InfoTip label={`About ${f.label}`}>{f.tip}</InfoTip></dt>
                  <dd className={cn("tnum text-[17px] font-semibold sm:mt-1 lg:mt-0", f.warn ? "text-[var(--sev-high)]" : "text-[var(--ink)]")}>
                    <Money value={f.value} />
                  </dd>
                </div>
              ))}
              {allZero ? <p className="text-[13px] leading-snug text-[var(--muted)] sm:col-span-3 lg:col-span-1">Nothing delivered, billed or paid yet — these fill in as records arrive.</p> : null}
            </dl>
          ) : null}
        </div>

        {lastDecided ? (
          <div className="border-t border-[var(--line)] px-5 py-4 sm:px-6">
            <Callout
              tone="success"
              title={`${decisionDone(lastDecided)} — saved to the history`}
              action={
                lastDecided === "REQUEST_CLARIFICATION" || lastDecided === "REVIEW" || lastDecided === "ESCALATE" ? (
                  <Btn size="sm" variant="secondary" onClick={() => setTab("followup")}>Go to Follow-up</Btn>
                ) : lastDecided === "APPROVE" ? (
                  <Link href="/app/payments" className="inline-flex h-9 items-center gap-1 text-[14px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Plan payment <ArrowRight size={14} /></Link>
                ) : null
              }
            >
              <p className="text-[14px]">{DECISION_AFTER[lastDecided] ?? ""}</p>
            </Callout>
          </div>
        ) : lastDecision ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--line)] px-5 py-3 text-[14px] text-[var(--muted)] sm:px-6">
            <History size={15} aria-hidden="true" />
            <span>
              Last decision: <span className="font-medium text-[var(--ink-2)]">{decisionDone(lastDecision.action)}</span> by {lastDecision.actor} · <DateText value={lastDecision.createdAt} />
            </span>
            <button type="button" onClick={() => setTab("decisions")} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">See history</button>
          </div>
        ) : null}
      </section>

      {/* ---------- evidence tabs ---------- */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={pageTabsList}>
          <TabsTrigger value="issues" className={pageTabsTrigger}>Issues{open.length ? <span className={tabCount}>{open.length}</span> : null}</TabsTrigger>
          <TabsTrigger value="graph" className={pageTabsTrigger}>Money trail</TabsTrigger>
          <TabsTrigger value="calculations" className={pageTabsTrigger}>Calculations</TabsTrigger>
          <TabsTrigger value="documents" className={pageTabsTrigger}>Documents<span className={tabCount}>{docs.length}</span></TabsTrigger>
          <TabsTrigger value="decisions" className={pageTabsTrigger}>History{decisions.length ? <span className={tabCount}>{decisions.length}</span> : null}</TabsTrigger>
          <TabsTrigger value="whatif" className={pageTabsTrigger}>What-if</TabsTrigger>
          <TabsTrigger value="followup" className={pageTabsTrigger}>Follow-up</TabsTrigger>
        </TabsList>

        <TabsContent value="issues" className="mt-6">
          {open.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No open issues" body="Everything on this order agrees. Settled issues stay below for the record." />
          ) : (
            <div className="space-y-4">
              {open.map((f) => (
                <IssueCard
                  key={f.id}
                  finding={f}
                  docs={docMap}
                  canDecide={canDecide}
                  onAsk={() => ask(findingLabel(f.code, f.title))}
                  onEvidence={setOpenEvidence}
                  onPreview={setPreviewDocId}
                  onResolve={() => setPendingFinding(f)}
                />
              ))}
            </div>
          )}
          {settled.length ? (
            <div className="mt-6">
              <button type="button" onClick={() => setShowSettled((v) => !v)} aria-expanded={showSettled}
                className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--muted)] hover:text-[var(--ink)]">
                {showSettled ? "Hide" : "Show"} {settled.length} settled issue{settled.length === 1 ? "" : "s"}
                <ChevronDown size={15} className={cn("transition-transform", showSettled && "rotate-180")} aria-hidden="true" />
              </button>
              {showSettled ? (
                <div className="mt-3 space-y-3">
                  {settled.map((f) => (
                    <IssueCard key={f.id} finding={f} docs={docMap} canDecide={false} onAsk={() => ask(findingLabel(f.code, f.title))}
                      onEvidence={setOpenEvidence} onPreview={setPreviewDocId} onResolve={() => undefined} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="graph" className="mt-6">
          <p className="mb-4 text-[15px] text-[var(--muted)]">How the order, deliveries, bills and payments connect. Click any document or link to see why Satya connected them.</p>
          {graph ? <MoneyTrail graph={graph} onAskAbout={ask} /> : <Skeleton className="h-[420px] w-full" />}
        </TabsContent>

        <TabsContent value="calculations" className="mt-6 space-y-6">
          {Array.isArray(snapshot.ledger) && snapshot.ledger.length > 0 ? (
            <Card pad={false}>
              <div className="px-5 pb-3 pt-5 sm:px-6">
                <h3 className="text-[17px] font-semibold text-[var(--ink)]">Each order line, step by step</h3>
                <p className="mt-1 text-[14px] text-[var(--muted)]">Ordered → received → accepted at quality check → billed. A bill for more than was accepted is what raises an issue.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[15px]">
                  <thead>
                    <tr className="border-y border-[var(--line)] bg-[var(--surface-2)] text-[13px] text-[var(--muted)]">
                      <th className="px-5 py-2.5 font-semibold sm:px-6">Order line</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Ordered</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Received</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Accepted</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Billed qty</th>
                      <th className="px-5 py-2.5 text-right font-semibold sm:px-6">Billed value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(snapshot.ledger as Record<string, string>[]).map((row, i) => {
                      const over = Number(row.invoicedQty || 0) > Number(row.accepted || 0);
                      return (
                        <tr key={i} className="border-b border-[var(--line)] last:border-0">
                          <td className="px-5 py-3 text-[var(--ink-2)] sm:px-6">Line {row.poLineNo || i + 1}</td>
                          <td className="px-4 py-3 text-right tnum">{formatQty(row.ordered || "0")}</td>
                          <td className="px-4 py-3 text-right tnum">{formatQty(row.received || "0")}</td>
                          <td className="px-4 py-3 text-right tnum">{formatQty(row.accepted || "0")}</td>
                          <td className={cn("px-4 py-3 text-right tnum", over && "font-semibold text-[var(--sev-high)]")}>{formatQty(row.invoicedQty || "0")}</td>
                          <td className="px-5 py-3 text-right tnum text-[var(--ink)] sm:px-6">{isPositive(row.invoicedValue) ? <Money value={row.invoicedValue} /> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
          {open.filter((f) => f.calculation?.length).map((f) => (
            <Card key={f.id}>
              <h3 className="text-[17px] font-semibold text-[var(--ink)]">{findingLabel(f.code, f.title)}</h3>
              <ol className="mt-3 divide-y divide-[var(--line)]">
                {f.calculation.map((step, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-4 py-2 text-[15px] text-[var(--ink-2)]">
                    <span>{i + 1}. {tidyText(step.step)}</span>
                    {step.value ? <span className="tnum font-medium text-[var(--ink)]">{tidyText(step.value)}</span> : null}
                  </li>
                ))}
              </ol>
            </Card>
          ))}
          {!(Array.isArray(snapshot.ledger) && snapshot.ledger.length) && open.every((f) => !f.calculation?.length) ? (
            <EmptyState icon={FileSearch} title="No calculations for this check" body="Line-by-line quantities appear once the order has deliveries or bills." />
          ) : null}
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          {docs.length === 0 ? (
            <EmptyState title="No documents linked yet" body="The order’s deliveries, bills and payments appear here as they are recorded." actionLabel="Upload a document" actionHref="/app/documents" />
          ) : (
            <ResponsiveTable
              caption="Documents in this check"
              columns={docColumns}
              rows={docs}
              rowKey={(d) => d.id}
              actions={(d) => (
                <RowActions
                  label={d.number ?? "this document"}
                  primary={{ label: "Preview", icon: Eye, onSelect: () => setPreviewDocId(d.id) }}
                  items={d.type === "PO" ? [{ label: "Open the order", icon: ShoppingCart, href: `/app/orders/${d.id}` }] : []}
                />
              )}
            />
          )}
        </TabsContent>

        <TabsContent value="decisions" className="mt-6">
          {decisions.length === 0 ? (
            <EmptyState icon={History} title="No decisions yet" body="When someone approves, holds or asks for clarification, it is recorded here with their reason — your audit trail." />
          ) : (
            <Card>
              <ol className="relative space-y-6 border-l border-[var(--line)] pl-6">
                {decisions.map((d) => (
                  <li key={d.id} className="relative">
                    <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" aria-hidden="true" />
                    <p className="text-[15px] font-semibold text-[var(--ink)]">
                      {decisionDone(d.action)}
                      {d.scope && typeof d.scope === "object" && "amount" in (d.scope as object) ? <> · <Money value={d.scope as never} /></> : null}
                    </p>
                    {d.reason ? <p className="mt-1 text-[15px] leading-relaxed text-[var(--ink-2)]">“{d.reason}”</p> : null}
                    <p className="mt-1 text-[13px] text-[var(--muted)]">{d.actor} · {roleLabel(d.role)} · <DateText value={d.createdAt} withTime /></p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="whatif" className="mt-6 space-y-4">
          <Card>
            <h3 className="flex items-center gap-2 text-[17px] font-semibold text-[var(--ink)]"><FlaskConical size={18} className="text-[var(--muted)]" aria-hidden="true" /> Try a what-if</h3>
            <p className="mt-1 text-[15px] text-[var(--muted)]">See how the figures would change before you act. Nothing is saved.</p>
            {scenarios.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {scenarios.map((s) => (
                  <button key={s.label} type="button" disabled={!!scenarioBusy} onClick={() => runScenario(s.label, s.changes)}
                    className="rounded-[var(--radius-md)] border border-[var(--line-strong)] p-4 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-2)]/60 disabled:opacity-50">
                    <p className="text-[15px] font-medium text-[var(--ink)]">{scenarioBusy === s.label ? "Running…" : `${s.label}…`}</p>
                    <p className="mt-1 text-[14px] text-[var(--muted)]">{s.hint}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-[15px] text-[var(--muted)]">What-ifs need a bill or a payment on this order to act on.</p>
            )}
            {scenarioError ? <p className="mt-3 text-[14px] text-[var(--sev-critical)]">{scenarioError}</p> : null}
          </Card>
          {scenarioResult && balances ? (
            <Card className="rise">
              <p className="text-[13px] font-semibold text-[var(--muted)]">Result — not saved</p>
              <h3 className="mt-1 text-[17px] font-semibold text-[var(--ink)]">{scenarioResult.label}</h3>
              <table className="mt-4 w-full text-[15px]">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-[13px] text-[var(--muted)]">
                    <th className="py-2 font-semibold"> </th><th className="py-2 text-right font-semibold">Now</th><th className="py-2 text-right font-semibold">If this happened</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Safe to pay", now: balances.supported, then: sb?.supportedOutstanding ?? sb?.evidenceSupportedPayable },
                    { label: "Under question", now: balances.disputed, then: sb?.disputedOutstanding ?? sb?.disputedExposure },
                    { label: "Unpaid in books", now: balances.recorded, then: sb?.recordedOutstanding ?? sb?.recordedPayable },
                  ].map((r) => (
                    <tr key={r.label} className="border-b border-[var(--line)] last:border-0">
                      <td className="py-2.5 text-[var(--ink-2)]">{r.label}</td>
                      <td className="py-2.5 text-right tnum text-[var(--muted)]"><Money value={r.now} /></td>
                      <td className="py-2.5 text-right tnum font-semibold text-[var(--ink)]"><Money value={r.then ?? "0"} /></td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2.5 text-[var(--ink-2)]">Open issues</td>
                    <td className="py-2.5 text-right tnum text-[var(--muted)]">{open.length}</td>
                    <td className="py-2.5 text-right tnum font-semibold text-[var(--ink)]">{scenarioSnap?.findings?.length ?? 0}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="followup" className="mt-6">
          <CaseWorkflow
            caseId={id}
            caseTitle={caseData.title || id}
            assignee={(caseData as { assignee?: string | null }).assignee ?? null}
            priority={(caseData as { priority?: string | null }).priority ?? null}
            supplier={(() => {
              const withSeller = (docs as { seller?: { name?: string; supplierId?: string }; supplierId?: string }[]).find((d) => d.seller?.name);
              return withSeller ? { id: withSeller.supplierId ?? withSeller.seller?.supplierId, name: withSeller.seller?.name } : null;
            })()}
          />
        </TabsContent>
      </Tabs>

      {openEvidence ? (
        <EvidenceDrawer
          evidence={openEvidence}
          doc={docMap.get(openEvidence.documentId)}
          onClose={() => setOpenEvidence(null)}
          onPreview={() => { setPreviewDocId(openEvidence.documentId); setOpenEvidence(null); }}
        />
      ) : null}
      {previewDocId ? <DocPreviewModal documentId={previewDocId} onClose={() => setPreviewDocId(null)} /> : null}

      <ConfirmDialog
        open={pendingDecision !== null}
        onOpenChange={(o) => !o && setPendingDecision(null)}
        tone={pendingDecision === "PLACE_ON_HOLD" || pendingDecision === "REJECT" ? "danger" : "primary"}
        requireReason
        title={`${DECISION_VERB[pendingDecision ?? ""] ?? "Record decision"}?`}
        description={DECISION_AFTER[pendingDecision ?? ""] ?? "Your decision and reason are saved to this check’s history."}
        confirmLabel={DECISION_VERB[pendingDecision ?? ""] ?? "Record decision"}
        onConfirm={(reason) => decide(pendingDecision as string, reason)}
      />
      <ConfirmDialog
        open={pendingFinding !== null}
        onOpenChange={(o) => !o && setPendingFinding(null)}
        requireReason
        reasonLabel="How was it settled? (saved to the history)"
        title={`Mark “${pendingFinding ? findingLabel(pendingFinding.code, pendingFinding.title) : ""}” as settled?`}
        description="Use this when the issue is sorted outside Satya — for example the supplier confirmed it, or the difference is acceptable. It moves to Settled issues and stays on the record."
        confirmLabel="Mark settled"
        onConfirm={(reason) => decide("APPROVE", reason, pendingFinding?.id)}
      />
    </FadeIn>
  );
}
