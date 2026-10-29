"use client";

// PO detail (/app/orders/[id]) — docs/plan/06 §5.2.

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
const downloadDocumentPdf = async (...args: Parameters<typeof import("@/components/v2/po-pdf").downloadDocumentPdf>) =>
  (await import("@/components/v2/po-pdf")).downloadDocumentPdf(...args);
import { FileDown, Pencil, OctagonX, MessageSquare, AlertCircle } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import dynamic from "next/dynamic";
const MoneyTrail = dynamic(() => import("@/components/v2/money-trail").then((m) => m.MoneyTrail), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-2)]" />,
});
import { Money, Qty, DateText, StatusBadge, ErrorState, FadeIn, Card } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function LifecycleBar({ label, value, max, tone }: { label: string; value: string; max: string; tone?: string }) {
  const pct = Number(max) > 0 ? Math.min(100, (Number(value) / Number(max)) * 100) : 0;
  return (
    <div className="min-w-20">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="tnum mt-0.5 text-sm font-medium text-[var(--ink)]">{value}</p>
      <span className="mt-1 block h-1 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: tone ?? "var(--accent)" }} />
      </span>
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["order", id], queryFn: () => v2.order(id) });
  const { data: graph } = useQuery({ queryKey: ["graph", data?.caseId], queryFn: () => v2.graph(data!.caseId), enabled: !!data?.caseId });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Order not found."} onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>;

  const { order, lifecycle, schedule, documents, history, caseId } = data;

  return (
    <FadeIn className="space-y-6">
      {/* header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-code text-xl font-semibold tracking-tight text-[var(--ink)]">{order.number}</h1>
              {order.revision > 0 && <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink-2)]">Revision R{order.revision}</span>}
              <StatusBadge status={order.status} />
            </div>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              {order.seller.name} · <Money value={{ amount: order.totals?.grand ?? "0", currency: order.currency }} /> · dated <DateText value={order.date} /> · FY {order.fy}
            </p>
            {order.seller.udyam && (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {order.seller.udyam.category} enterprise — payment within 45 days is a legal duty.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                try { await v2.documentAction(order.id, "amend"); } catch { /* mock mode — no-op */ }
              }}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)]"
            >
              <Pencil size={13} aria-hidden="true" /> Amend
            </button>
            <button
              type="button"
              onClick={async () => {
                try { await v2.documentAction(order.id, "short-close"); refetch(); } catch { /* mock mode — no-op */ }
              }}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)]"
            >
              <OctagonX size={13} aria-hidden="true" /> Short-close
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const model = await v2.renderModel(order.id);
                  await downloadDocumentPdf(model);
                } catch {
                  alert("The PDF could not be generated right now — try again in a moment.");
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)]"
            >
              <FileDown size={13} aria-hidden="true" /> Download PDF
            </button>
            <button
              type="button"
              onClick={() => router.push(`/app/ask?about=${encodeURIComponent(order.number)}`)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-strong)]"
            >
              <MessageSquare size={13} aria-hidden="true" /> Ask about this order
            </button>
          </div>
        </div>

        {/* line lifecycle */}
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          {lifecycle.map((line) => (
            <div key={line.lineNo} className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="min-w-52 flex-1">
                <p className="text-sm font-medium text-[var(--ink)]">#{line.lineNo} {line.description}</p>
              </div>
              <LifecycleBar label="Ordered" value={line.ordered} max={line.ordered} tone="var(--ink-2)" />
              <LifecycleBar label="Received" value={line.received} max={line.ordered} />
              <LifecycleBar label="Accepted" value={line.accepted} max={line.ordered} />
              <LifecycleBar label="Invoiced" value={line.invoiced} max={line.ordered} />
              <LifecycleBar label="Paid" value={line.paid} max={line.ordered} tone="var(--likely)" />
              <div className="min-w-20">
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Still open</p>
                <p className={cn("tnum mt-0.5 text-sm font-medium", Number(line.open) > 0 ? "text-[var(--sev-medium)]" : "text-[var(--muted)]")}>{line.open}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* delivery schedule */}
      <Card>
        <h2 className="text-sm font-semibold text-[var(--ink)]">Delivery schedule</h2>
        <ul className="mt-3 space-y-2">
          {schedule.map((batch) => (
            <li key={batch.batch} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-[var(--ink-2)]">{batch.batch} · <Qty value={batch.qty} /> units</span>
              <span className={cn("text-xs", batch.overdue ? "font-medium text-[var(--sev-critical)]" : "text-[var(--muted)]")}>
                due <DateText value={batch.dueDate} /> · received <Qty value={batch.receivedQty} />
                {batch.overdue ? " · overdue" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* tabs */}
      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="graph">Money trail</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

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
                {doc.finding && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--sev-high)]">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {doc.finding}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="graph">
          {graph ? <MoneyTrail graph={graph} /> : <Skeleton className="h-[420px] w-full" />}
          <p className="mt-3 text-xs text-[var(--muted)]">
            Case <span className="font-code">{caseId}</span> · solid lines are confirmed links, dotted/dashed ones need your decision.
          </p>
        </TabsContent>

        <TabsContent value="issues">
          <IssuesList caseId={caseId} />
        </TabsContent>

        <TabsContent value="history">
          <ol className="relative space-y-4 border-l border-[var(--line)] pl-5">
            {history.map((entry) => (
              <li key={entry.revision}>
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                <p className="text-sm text-[var(--ink)]">Revision R{entry.revision} — {entry.change}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{entry.by} · <DateText value={entry.at} withTime /></p>
              </li>
            ))}
          </ol>
        </TabsContent>
      </Tabs>
    </FadeIn>
  );
}

function IssuesList({ caseId }: { caseId: string }) {
  const { data } = useQuery({ queryKey: ["findings", caseId], queryFn: () => v2.findings({ caseId }) });
  const findings = data?.items ?? [];
  if (!findings.length) return <p className="text-sm text-[var(--muted)]">No open issues on this order.</p>;
  return (
    <ul className="space-y-3">
      {findings.map((finding) => (
        <li key={finding.id} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-sm font-medium text-[var(--ink)]">{finding.title}</p>
          <p className="mt-1 text-sm text-[var(--ink-2)]">{finding.explanation}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">What would settle this: {finding.whatResolvesIt}</p>
        </li>
      ))}
    </ul>
  );
}

