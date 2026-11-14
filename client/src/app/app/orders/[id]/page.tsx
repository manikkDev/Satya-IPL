"use client";

// PO detail (/app/orders/[id]) — docs/plan/06 §5.2.

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Pencil, OctagonX, MessageSquare, AlertCircle, Eye, ShoppingCart, Truck, ClipboardCheck, FileText, IndianRupee, FilePlus2, Send, CheckCircle2, XCircle, FileEdit, Gavel, CircleDot } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import dynamic from "next/dynamic";
const MoneyTrail = dynamic(() => import("@/components/v2/money-trail").then((m) => m.MoneyTrail), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-2)]" />,
});
const DocPreviewModal = dynamic(() => import("@/components/v2/doc-preview").then((m) => m.DocPreviewModal), { ssr: false });
import { PoSheet } from "@/components/v2/po-sheet";
import { Money, Qty, DateText, StatusBadge, SeverityBadge, ErrorState, FadeIn, Card, CardTitle, Btn, Progress } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "ordered", label: "Ordered", icon: ShoppingCart },
  { key: "received", label: "Received", icon: Truck },
  { key: "accepted", label: "Accepted", icon: ClipboardCheck },
  { key: "invoiced", label: "Invoiced", icon: FileText },
  { key: "paid", label: "Paid", icon: IndianRupee },
] as const;

function StageCell({ label, icon: Icon, value, max, tone }: { label: string; icon: typeof ShoppingCart; value: string; max: string; tone?: string }) {
  const pct = Number(max) > 0 ? Math.min(100, (Number(value) / Number(max)) * 100) : 0;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
        <Icon size={12} aria-hidden="true" /> {label}
      </div>
      <p className="tnum mt-1 text-base font-semibold" style={{ color: tone ?? "var(--ink)" }}>{value}</p>
      <Progress value={pct} tone={tone ?? "var(--accent)"} className="mt-1.5 h-[4px]" />
      <p className="tnum mt-1 text-[10px] text-[var(--muted)]">{Number(max) > 0 ? `${Math.round(pct)}%` : "—"}</p>
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["order", id], queryFn: () => v2.order(id) });
  const { data: graph } = useQuery({ queryKey: ["graph", data?.caseId], queryFn: () => v2.graph(data!.caseId), enabled: !!data?.caseId });
  const { data: model } = useQuery({ queryKey: ["renderModel", data?.order?.id], queryFn: () => v2.renderModel(data!.order.id), enabled: !!data?.order?.id });
  const { data: findings } = useQuery({ queryKey: ["findings", data?.caseId], queryFn: () => v2.findings({ caseId: data!.caseId }), enabled: !!data?.caseId });
  const { data: activity } = useQuery({ queryKey: ["order-activity", data?.order?.id], queryFn: () => v2.orderActivity(data!.order.id), enabled: !!data?.order?.id });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Order not found."} onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-80 w-full" /></div>;

  const { order, lifecycle, schedule, documents, history, caseId } = data;
  const issueCount = findings?.items?.length ?? 0;

  const sums = {
    ordered: lifecycle.reduce((s, l) => s + Number(l.ordered ?? 0), 0),
    received: lifecycle.reduce((s, l) => s + Number(l.received ?? 0), 0),
    accepted: lifecycle.reduce((s, l) => s + Number(l.accepted ?? 0), 0),
    invoiced: lifecycle.reduce((s, l) => s + Number(l.invoiced ?? 0), 0),
    paid: lifecycle.reduce((s, l) => s + Number(l.paid ?? 0), 0),
    open: lifecycle.reduce((s, l) => s + Number(l.open ?? 0), 0),
  };
  const grand = Number(order.totals?.grand ?? order.lines?.reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.rate ?? 0), 0) ?? 0);
  const pct = (n: number) => (sums.ordered ? Math.min(100, Math.round((n / sums.ordered) * 100)) : 0);
  const kpis = [
    { label: "Order value", value: <Money value={{ amount: String(grand), currency: order.currency ?? "INR" }} />, note: `${order.lines?.length ?? 0} line${(order.lines?.length ?? 0) === 1 ? "" : "s"} · ${sums.ordered} units`, tone: undefined as string | undefined },
    { label: "Delivered", value: `${pct(sums.received)}%`, note: `${sums.received} of ${sums.ordered} units received`, tone: sums.received > 0 ? "var(--accent)" : undefined },
    { label: "Invoiced", value: `${pct(sums.invoiced)}%`, note: `${sums.invoiced} units billed`, tone: sums.invoiced > sums.received ? "var(--sev-high)" : undefined },
    { label: "Paid", value: `${pct(sums.paid)}%`, note: `${sums.paid} units settled`, tone: sums.paid > 0 ? "var(--confirmed)" : undefined },
    { label: "Still open", value: String(sums.open), note: issueCount ? `${issueCount} issue${issueCount === 1 ? "" : "s"} to settle` : "units yet to arrive", tone: issueCount ? "var(--sev-high)" : sums.open > 0 ? "var(--sev-medium)" : "var(--confirmed)" },
  ];

  return (
    <FadeIn className="space-y-5">
      {/* header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Purchase order{order.fy ? ` · FY ${order.fy}` : ""}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="font-code text-xl font-semibold tracking-tight text-[var(--ink)]">{order.number}</h1>
              {order.revision > 0 && <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink-2)]">R{order.revision}</span>}
              <StatusBadge status={order.status} />
            </div>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              {order.seller?.name} · dated <DateText value={order.date} /> ·{" "}
              <Money value={{ amount: String(grand), currency: order.currency ?? "INR" }} />
            </p>
            {order.seller?.udyam && (
              <p className="mt-1 text-xs text-[var(--likely)]">
                {order.seller.udyam.category} enterprise — payment within 45 days is a legal duty.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="outline" size="sm" icon={Eye} onClick={() => setPreviewDocId(order.id)}>Preview</Btn>
            <Btn
              variant="secondary" size="sm" icon={FileDown}
              onClick={async () => {
                try {
                  const m = model ?? (await v2.renderModel(order.id));
                  const { downloadDocumentPdf } = await import("@/components/v2/po-pdf");
                  await downloadDocumentPdf(m);
                } catch {
                  alert("The PDF could not be generated right now — try again in a moment.");
                }
              }}
            >
              PDF
            </Btn>
            <Btn variant="secondary" size="sm" icon={Pencil} onClick={async () => { try { await v2.documentAction(order.id, "amend"); } catch { /* mock mode — no-op */ } }}>Amend</Btn>
            <Btn variant="secondary" size="sm" icon={OctagonX} onClick={async () => { try { await v2.documentAction(order.id, "short-close"); refetch(); } catch { /* mock mode — no-op */ } }}>Short-close</Btn>
            <Btn size="sm" icon={MessageSquare} onClick={() => router.push(`/app/ask?about=${encodeURIComponent(order.number)}`)}>Ask about this order</Btn>
          </div>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label} pad={false} className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{k.label}</p>
            <p className="tnum mt-1.5 text-xl font-semibold tracking-tight" style={{ color: k.tone ?? "var(--ink)" }}>{k.value}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{k.note}</p>
          </Card>
        ))}
      </div>

      {/* fulfilment per line */}
      <Card>
        <CardTitle hint={`${lifecycle.length} line${lifecycle.length === 1 ? "" : "s"}`}>Fulfilment — ordered to paid</CardTitle>
        <div className="space-y-5">
          {lifecycle.map((line) => (
            <div key={line.lineNo} className="rounded-[var(--radius-sm)] border border-[var(--line)] p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-[var(--ink)]"><span className="tnum text-[var(--muted)]">#{line.lineNo}</span> {line.description}</p>
                <p className={cn("tnum text-xs", Number(line.open) > 0 ? "font-medium text-[var(--sev-medium)]" : "text-[var(--muted)]")}>
                  {Number(line.open) > 0 ? `${line.open} still open` : "fully delivered"}
                </p>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-4">
                {STAGES.map((st) => (
                  <StageCell
                    key={st.key} label={st.label} icon={st.icon}
                    value={String(line[st.key as keyof typeof line] ?? "0")} max={line.ordered}
                    tone={st.key === "ordered" ? "var(--ink-2)" : st.key === "paid" ? "var(--confirmed)" : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents{documents.length ? ` · ${documents.length}` : ""}</TabsTrigger>
          <TabsTrigger value="graph">Money trail</TabsTrigger>
          <TabsTrigger value="issues">Issues{issueCount ? ` · ${issueCount}` : ""}</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {model ? <PoSheet model={model} /> : <Skeleton className="h-[560px] w-full" />}
          <Card>
            <CardTitle hint={schedule.length ? `${schedule.length} batch${schedule.length === 1 ? "" : "es"}` : undefined}>Delivery schedule</CardTitle>
            {schedule.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">No dated batches on this order — delivery dates sit on the document above.</p>
            ) : (
              <ul className="space-y-2">
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
            )}
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          {documents.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">No receipts, invoices or payments are linked to this order yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => setPreviewDocId(doc.id)}
                    className="w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--surface-2)]/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-code text-sm font-medium text-[var(--ink)]">{doc.number}</p>
                      <StatusBadge status={doc.status} />
                    </div>
                    <p className="mt-1 text-xs capitalize text-[var(--muted)]">{doc.type.replaceAll("_", " ").toLowerCase()} · <DateText value={doc.date} /></p>
                    {doc.amount && <p className="tnum mt-2 text-sm font-medium text-[var(--ink)]"><Money value={doc.amount} /></p>}
                    {doc.finding && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--sev-high)]">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {doc.finding}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
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

        <TabsContent value="activity">
          <ActivityTrail activity={activity} history={history} />
        </TabsContent>
      </Tabs>

      {previewDocId && <DocPreviewModal documentId={previewDocId} onClose={() => setPreviewDocId(null)} />}
    </FadeIn>
  );
}

/* ---------- issues ---------- */

function IssuesList({ caseId }: { caseId: string }) {
  const { data } = useQuery({ queryKey: ["findings", caseId], queryFn: () => v2.findings({ caseId }) });
  const findings = data?.items ?? [];
  if (!findings.length) return <p className="py-6 text-center text-sm text-[var(--muted)]">No open issues on this order.</p>;
  return (
    <ul className="space-y-3">
      {findings.map((finding) => (
        <li key={finding.id} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--ink)]">{finding.title}</p>
            <SeverityBadge severity={finding.severity} />
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-2)]">{finding.explanation}</p>
          {finding.whatResolvesIt ? <p className="mt-2 text-xs text-[var(--muted)]">What would settle this: {finding.whatResolvesIt}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/* ---------- activity trail ---------- */

const EVENT_META: Record<string, { icon: typeof Send; label: string; tone?: string }> = {
  draft: { icon: FilePlus2, label: "Created as draft" },
  patch: { icon: Pencil, label: "Edited" },
  compute: { icon: CircleDot, label: "Totals computed" },
  submit: { icon: Send, label: "Submitted for approval" },
  approve: { icon: CheckCircle2, label: "Approved", tone: "var(--confirmed)" },
  reject: { icon: XCircle, label: "Rejected", tone: "var(--sev-critical)" },
  issue: { icon: Send, label: "Issued to supplier", tone: "var(--accent)" },
  amend: { icon: FileEdit, label: "Amendment drafted" },
  "short close": { icon: OctagonX, label: "Short-closed", tone: "var(--sev-medium)" },
  cancel: { icon: XCircle, label: "Cancelled", tone: "var(--sev-critical)" },
};

type Activity = NonNullable<Awaited<ReturnType<typeof v2.orderActivity>>>;

function ActivityTrail({ activity, history }: { activity: Activity | undefined; history: { revision: number; at: string; by: string; change: string }[] }) {
  if (!activity) return <Skeleton className="h-64 w-full" />;
  type Entry = { key: string; at?: string; icon: typeof Send; tone?: string; title: string; body?: string; who?: string };
  const entries: Entry[] = [];

  const who = (role?: string, actor?: string) => {
    const r = role && role !== "*" ? role.replaceAll("_", " ") : null;
    const a = actor ? (actor.length > 14 ? `…${actor.slice(-6)}` : actor) : null;
    return [r, a].filter(Boolean).join(" · ") || undefined;
  };
  const audited = new Set((activity.audit ?? []).map((a) => a.event));
  for (const a of activity.audit ?? []) {
    const meta = EVENT_META[a.event] ?? { icon: CircleDot, label: a.event };
    // If the same action also lives in approvals[], surface its comment here.
    const note = (activity.approvals ?? []).find((ap) => ap.action === a.event && ap.comment)?.comment;
    entries.push({ key: `audit-${a.id}`, at: a.at, icon: meta.icon, tone: meta.tone, title: meta.label, body: note ?? a.action, who: who(a.actorRole, a.actor) });
  }
  for (const ap of activity.approvals ?? []) {
    if (ap.action && audited.has(ap.action)) continue; // audit row already carries it
    const meta = EVENT_META[ap.action ?? "approve"] ?? EVENT_META.approve;
    entries.push({ key: `ap-${ap.at}-${ap.action}`, at: ap.at, icon: meta.icon, tone: meta.tone, title: meta.label, body: ap.comment, who: who(ap.role, ap.actor) });
  }
  for (const d of activity.decisions ?? []) {
    entries.push({ key: `dec-${d.id}`, at: d.createdAt, icon: Gavel, tone: "var(--sev-medium)", title: `Decision · ${String(d.action ?? "").replaceAll("_", " ").toLowerCase()}`, body: d.reason, who: who(d.actorRole, d.actor) });
  }
  for (const am of activity.amendments ?? []) {
    entries.push({ key: `am-${am.id}`, at: am.date, icon: FileEdit, title: `${am.type === "PO_AMENDMENT" ? "Amendment" : "Document"} ${am.number ?? am.id}`, body: `status: ${am.status}${am.supersedes ? " · supersedes this order" : ""}` });
  }
  for (const h of history ?? []) {
    entries.push({ key: `rev-${h.revision}`, at: h.at, icon: FileEdit, title: `Revision R${h.revision}`, body: h.change, who: h.by });
  }
  if (activity.meta?.createdAt) {
    entries.push({ key: "created", at: activity.meta.createdAt, icon: FilePlus2, tone: "var(--muted)", title: "Order created", who: who(undefined, activity.meta.createdBy) });
  }
  entries.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));

  if (!entries.length) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">No activity recorded on this order yet — approvals, amendments and decisions will appear here.</p>;
  }
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
      <ol className="relative space-y-5 border-l border-[var(--line)] pl-6">
        {entries.map((e) => (
          <li key={e.key} className="relative">
            <span
              className="absolute -left-[29px] grid h-5 w-5 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)]"
              style={{ color: e.tone ?? "var(--accent)" }} aria-hidden="true"
            >
              <e.icon size={11} />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-[var(--ink)]">{e.title}</p>
              <p className="tnum text-xs text-[var(--muted)]"><DateText value={e.at} withTime /></p>
            </div>
            {e.body ? <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-2)]">{e.body}</p> : null}
            {e.who ? <p className="mt-0.5 text-[11px] text-[var(--muted)]">{e.who}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
