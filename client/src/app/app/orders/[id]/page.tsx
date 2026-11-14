"use client";

// Purchase order (/app/orders/[id]) — "How far has this order got, and is
// anything wrong?" Header + one primary action, a three-step progress strip
// (delivered → billed → paid), an aligned per-line table, then tabs for the
// document itself, linked records, money trail, issues and activity.

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import {
  FileDown, Pencil, OctagonX, MessageSquare, Eye, FilePlus2, Send, CheckCircle2, XCircle, FileEdit, Gavel,
  CircleDot, ChevronLeft, ListChecks, ArrowRight,
} from "lucide-react";
import { ConfirmDialog } from "@/components/v2/confirm-dialog";
import { PoSheet } from "@/components/v2/po-sheet";
import { formatMoney, fromPaise, toPaise, formatQty } from "@/lib/format";
import { v2 } from "@/lib/api/v2";
import {
  Money, DateText, StatusBadge, SeverityBadge, ErrorState, FadeIn, Card, Btn, BtnLink, PageHeader, EmptyState, ToneBadge, ResponsiveTable, RowActions, type Column } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { roleLabel } from "@/content/copy/vocabulary";
import { findingLabel, findingSettle, tidyText } from "@/content/copy/findings";
import { docTypeLabel } from "@/components/pages/documents/labels";
import { LifecycleStrip } from "@/components/pages/shared/progress-meter";
import { pageTabsList, pageTabsTrigger, tabCount } from "@/components/pages/shared/page-tabs";
import { cn } from "@/lib/utils";

const MoneyTrail = dynamic(() => import("@/components/v2/money-trail").then((m) => m.MoneyTrail), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-2)]" />,
});
const DocPreviewModal = dynamic(() => import("@/components/v2/doc-preview").then((m) => m.DocPreviewModal), { ssr: false });

/** Line gross value (qty × rate incl. GST) in paise, for value-based %s. */
function lineGrossPaise(line: { qty?: string | null; rate?: string | null; gstRate?: string | number | null } | undefined, qty?: string): bigint {
  if (!line) return BigInt(0);
  const q = BigInt(Math.round(Number(qty ?? line.qty ?? 0) * 1000));
  const taxable = (toPaise(line.rate ?? "0") * q + BigInt(500)) / BigInt(1000);
  const gstBp = BigInt(Math.round(Number(line.gstRate ?? 0) * 100));
  return taxable + (taxable * gstBp + BigInt(5000)) / BigInt(10000);
}

const fmtQty = (n: number) => formatQty(Number.isInteger(n) ? String(n) : n.toFixed(3));
const plural = (n: number, one: string, many = `${one}s`) => `${fmtQty(n)} ${n === 1 ? one : many}`;

type LinkedDoc = { id: string; type: string; number: string; date: string; amount?: { amount: string; currency: string }; status: string; finding?: string };

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "amend" | "short-close">(null);
  const [tab, setTab] = useState("lines");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["order", id], queryFn: () => v2.order(id) });
  const { data: graph } = useQuery({ queryKey: ["graph", data?.caseId], queryFn: () => v2.graph(data!.caseId as string), enabled: !!data?.caseId && tab === "graph" });
  const { data: model } = useQuery({ queryKey: ["renderModel", data?.order?.id], queryFn: () => v2.renderModel(data!.order.id), enabled: !!data?.order?.id && tab === "document" });
  const { data: findings } = useQuery({ queryKey: ["findings", data?.caseId], queryFn: () => v2.findings({ caseId: data!.caseId as string }), enabled: !!data?.caseId });
  const { data: activity } = useQuery({ queryKey: ["order-activity", data?.order?.id], queryFn: () => v2.orderActivity(data!.order.id), enabled: !!data?.order?.id && tab === "activity" });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Order not found."} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-5 w-24" />
        <div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-8 w-80 max-w-full" /><Skeleton className="h-4 w-64" /></div>
        <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const { order, lifecycle, schedule, history, caseId } = data;
  const documents = data.documents as LinkedDoc[];
  const issues = findings?.items ?? [];
  const issueCount = issues.length;

  const units = (key: "ordered" | "received" | "accepted" | "invoiced" | "open") => lifecycle.reduce((s, l) => s + Number(l[key] ?? 0), 0);
  const sums = { ordered: units("ordered"), received: units("received"), accepted: units("accepted"), invoiced: units("invoiced"), open: units("open") };
  const currency = order.currency ?? "INR";
  const grandPaise = order.totals?.grand ? toPaise(order.totals.grand) : (order.lines ?? []).reduce((s, l) => s + lineGrossPaise(l), BigInt(0));
  // the API maps the server's per-line paidValue (money) into `paid`
  const paidOf = (l: (typeof lifecycle)[number]) => l.paidValue ?? l.paid ?? null;
  const hasPaidValue = lifecycle.some((l) => paidOf(l) != null);
  const paidPaise = hasPaidValue ? lifecycle.reduce((s, l) => s + toPaise(paidOf(l) ?? "0"), BigInt(0)) : null;
  const pct = (n: number) => (sums.ordered ? Math.min(100, (n / sums.ordered) * 100) : 0);
  const paidPct = paidPaise !== null && grandPaise > BigInt(0) ? Math.min(100, Number((paidPaise * BigInt(100)) / grandPaise)) : 0;
  const overBilled = sums.invoiced > sums.received;
  const canClose = ["issued", "acknowledged", "partially_fulfilled"].includes(String(order.status));
  const canAmend = canClose;
  const supplierName = order.seller?.name ?? "Supplier not set";
  const msme = order.seller?.udyam?.category;

  const downloadPdf = async () => {
    try {
      const m = model ?? (await v2.renderModel(order.id));
      const { downloadDocumentPdf } = await import("@/components/v2/po-pdf");
      await downloadDocumentPdf(m);
    } catch {
      toast.error("The PDF couldn’t be generated right now — try again in a moment.");
    }
  };

  type LineRow = (typeof lifecycle)[number];
  const lineColumns: Column<LineRow>[] = [
    {
      key: "item", header: "Item", primary: true, className: "min-w-[200px]",
      cell: (l) => (
        <div className="min-w-0">
          <p className="font-medium text-[var(--ink)]">{l.description || `Line ${l.lineNo}`}</p>
          <p className="text-[13px] text-[var(--muted)]">Line {l.lineNo}</p>
        </div>
      ),
    },
    { key: "ordered", header: "Ordered", align: "right", cell: (l) => formatQty(l.ordered) },
    { key: "received", header: "Received", align: "right", cell: (l) => formatQty(l.received) },
    { key: "accepted", header: "Accepted", align: "right", cell: (l) => formatQty(l.accepted) },
    {
      key: "billed", header: "Billed", align: "right",
      cell: (l) => <span className={cn(Number(l.invoiced) > Number(l.received) && "font-semibold text-[var(--sev-high)]")}>{formatQty(l.invoiced)}</span>,
    },
    {
      key: "paid", header: "Paid", align: "right",
      cell: (l) => (paidOf(l) != null && toPaise(paidOf(l)) > BigInt(0) ? <Money value={paidOf(l)} currency={currency} /> : <span className="text-[var(--muted)]">—</span>),
    },
    {
      key: "open", header: "Still to come", align: "right",
      cell: (l) => (Number(l.open) > 0 ? <span className="font-medium text-[var(--ink)]">{formatQty(l.open)}</span> : <span className="text-[var(--confirmed)]">None</span>),
    },
  ];

  const docColumns: Column<LinkedDoc>[] = [
    {
      key: "doc", header: "Document", primary: true,
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--ink)]">{d.number}</p>
          <p className="text-[13px] text-[var(--muted)]">{docTypeLabel(d.type)}</p>
        </div>
      ),
    },
    { key: "date", header: "Date", cell: (d) => <DateText value={d.date} /> },
    { key: "amount", header: "Amount", align: "right", cell: (d) => (d.amount ? <Money value={d.amount} /> : <span className="text-[var(--muted)]">—</span>) },
    {
      key: "status", header: "Status",
      cell: (d) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={d.status} />
          {d.finding ? <span className="text-[13px] text-[var(--sev-high)]">{tidyText(d.finding)}</span> : null}
        </div>
      ),
    },
  ];

  return (
    <FadeIn className="space-y-8">
      <div className="space-y-4">
        <Link href="/app/orders" className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--muted)] hover:text-[var(--ink)]">
          <ChevronLeft size={16} aria-hidden="true" /> Orders
        </Link>
        <PageHeader
          eyebrow={`Purchase order ${order.number}${order.revision > 0 ? ` · revision ${order.revision}` : ""}`}
          title={<span className="inline-flex flex-wrap items-center gap-3">{supplierName} <StatusBadge status={order.status} /></span>}
          description={
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Dated <DateText value={order.date} /> · <Money value={fromPaise(grandPaise)} currency={currency} /> incl. GST</span>
              {msme ? <ToneBadge tone="info">{msme.charAt(0).toUpperCase() + msme.slice(1)} enterprise · pay within 45 days</ToneBadge> : null}
            </span>
          }
          actions={
            <>
              {issueCount && caseId ? (
                <BtnLink href={`/app/investigations/${caseId}`} icon={ListChecks}>Review {issueCount} issue{issueCount === 1 ? "" : "s"}</BtnLink>
              ) : null}
              <Btn variant="secondary" icon={FileDown} onClick={downloadPdf}>PDF</Btn>
              <RowActions
                label={`order ${order.number}`}
                items={[
                  { label: "Preview the order", icon: Eye, onSelect: () => setPreviewDocId(order.id) },
                  ...(canAmend ? [{ label: "Amend the order", icon: Pencil, onSelect: () => setConfirm("amend") }] : []),
                  ...(canClose ? [{ label: "Short-close", icon: OctagonX, onSelect: () => setConfirm("short-close"), danger: true }] : []),
                  ...(caseId && !issueCount ? [{ label: "Open its check", icon: ListChecks, href: `/app/investigations/${caseId}` }] : []),
                  { label: "Ask Satya about this order", icon: MessageSquare, onSelect: () => router.push(`/app/ask?about=${encodeURIComponent(`PO ${order.number}`)}`) },
                ]}
              />
            </>
          }
        />
      </div>

      {/* delivered → billed → paid */}
      <section aria-label="Progress">
        <LifecycleStrip
          steps={[
            {
              label: "Delivered",
              pct: pct(sums.received),
              detail: sums.open > 0 ? `${plural(sums.received, "unit")} of ${fmtQty(sums.ordered)} · ${fmtQty(sums.open)} still to come` : `All ${plural(sums.ordered, "unit")} received`,
            },
            {
              label: "Billed",
              pct: pct(sums.invoiced),
              warn: overBilled,
              detail: overBilled
                ? `${plural(sums.invoiced, "unit")} billed — ${fmtQty(sums.invoiced - sums.received)} more than received`
                : sums.invoiced > 0 ? `${plural(sums.invoiced, "unit")} billed` : "No bills yet",
            },
            {
              label: "Paid",
              pct: paidPct,
              detail: paidPaise === null || paidPaise === BigInt(0) ? "Nothing paid yet" : `${formatMoney(fromPaise(paidPaise), currency)} of ${formatMoney(fromPaise(grandPaise), currency)}`,
            },
          ]}
        />
        {issueCount ? (
          <p className="mt-3 text-[14px] text-[var(--ink-2)]">
            <span className="font-medium text-[var(--sev-high)]">{issueCount} issue{issueCount === 1 ? "" : "s"}</span> found on this order.{" "}
            {caseId ? <Link href={`/app/investigations/${caseId}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">See Satya’s recommendation <ArrowRight size={13} className="inline" aria-hidden="true" /></Link> : null}
          </p>
        ) : null}
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={pageTabsList}>
          <TabsTrigger value="lines" className={pageTabsTrigger}>Lines<span className={tabCount}>{lifecycle.length}</span></TabsTrigger>
          <TabsTrigger value="document" className={pageTabsTrigger}>Order document</TabsTrigger>
          <TabsTrigger value="documents" className={pageTabsTrigger}>Linked records{documents.length ? <span className={tabCount}>{documents.length}</span> : null}</TabsTrigger>
          <TabsTrigger value="issues" className={pageTabsTrigger}>Issues{issueCount ? <span className={tabCount}>{issueCount}</span> : null}</TabsTrigger>
          <TabsTrigger value="graph" className={pageTabsTrigger}>Money trail</TabsTrigger>
          <TabsTrigger value="activity" className={pageTabsTrigger}>Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="mt-6 space-y-6">
          <ResponsiveTable caption="Order lines" columns={lineColumns} rows={lifecycle} rowKey={(l) => String(l.lineNo)} />
          {schedule.length ? (
            <Card>
              <h3 className="text-[17px] font-semibold text-[var(--ink)]">Delivery schedule</h3>
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {schedule.map((b) => (
                  <li key={b.batch} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
                    <span className="text-[var(--ink-2)]">{b.batch} · {formatQty(b.qty)} units</span>
                    <span className={cn("text-[14px]", b.overdue ? "font-medium text-[var(--sev-critical)]" : "text-[var(--muted)]")}>
                      Due <DateText value={b.dueDate} /> · {formatQty(b.receivedQty)} received{b.overdue ? " · overdue" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="document" className="mt-6">
          {model ? <PoSheet model={model} /> : <Skeleton className="h-[560px] w-full" />}
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          {documents.length === 0 ? (
            <EmptyState title="Nothing linked yet" body="Goods receipts, supplier bills and payments for this order appear here as they are recorded." actionLabel="Upload a bill" actionHref="/app/documents" />
          ) : (
            <ResponsiveTable
              caption="Records linked to this order"
              columns={docColumns}
              rows={documents}
              rowKey={(d) => d.id}
              actions={(d) => <RowActions label={d.number} primary={{ label: "Preview", icon: Eye, onSelect: () => setPreviewDocId(d.id) }} />}
            />
          )}
        </TabsContent>

        <TabsContent value="issues" className="mt-6">
          {!caseId ? (
            <NoCase />
          ) : issues.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No open issues" body="The order, deliveries, bills and payments agree." />
          ) : (
            <div className="space-y-3">
              {issues.map((f) => (
                <Card key={f.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SeverityBadge severity={f.severity} />
                      <h3 className="mt-2.5 text-[16px] font-semibold text-[var(--ink)]">{findingLabel(f.code, f.title)}</h3>
                      <p className="mt-1 text-[15px] leading-relaxed text-[var(--ink-2)]">{tidyText(f.explanation)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-[14px] text-[var(--ink-2)]"><span className="font-medium text-[var(--ink)]">What would settle it: </span>{findingSettle(f.code, f.whatResolvesIt)}</p>
                </Card>
              ))}
              <BtnLink href={`/app/investigations/${caseId}`} variant="secondary" icon={ListChecks}>Decide in the order check</BtnLink>
            </div>
          )}
        </TabsContent>

        <TabsContent value="graph" className="mt-6">
          {!caseId ? (
            <NoCase />
          ) : (
            <>
              {graph ? <MoneyTrail graph={graph} /> : <Skeleton className="h-[420px] w-full" />}
              <p className="mt-3 text-[14px] text-[var(--muted)]">Solid lines are confirmed links; dotted ones need your decision.</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <ActivityTrail activity={activity} history={history} />
        </TabsContent>
      </Tabs>

      {previewDocId && <DocPreviewModal documentId={previewDocId} onClose={() => setPreviewDocId(null)} />}

      <ConfirmDialog
        open={confirm === "amend"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Amend ${order.number}?`}
        description="This creates an amendment draft. Once it is approved and issued it replaces this order; the original stays on record."
        confirmLabel="Create amendment"
        onConfirm={async () => {
          try {
            const amendment = (await v2.documentAction(order.id, "amend")) as { id?: string };
            toast.success("Amendment draft created");
            await refetch();
            if (amendment?.id) router.push(`/app/orders/${amendment.id}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "The amendment couldn’t be created.");
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={confirm === "short-close"}
        onOpenChange={(open) => !open && setConfirm(null)}
        tone="danger"
        requireReason
        title={`Short-close ${order.number}?`}
        description={
          <>
            Each line closes at what has arrived so far ({fmtQty(sums.received)} of {fmtQty(sums.ordered)} units). The remaining{" "}
            {fmtQty(Math.max(0, sums.ordered - sums.received))} units will no longer be expected from the supplier. This can’t be undone.
          </>
        }
        confirmLabel="Short-close order"
        onConfirm={async (reason) => {
          try {
            await v2.documentAction(order.id, "short-close", { reason, lines: lifecycle.map((l) => ({ lineNo: l.lineNo, qty: l.received || "0" })) });
            toast.success("Order short-closed");
            await refetch();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "The order couldn’t be short-closed.");
            throw err;
          }
        }}
      />
    </FadeIn>
  );
}

function NoCase() {
  return (
    <EmptyState
      icon={ListChecks}
      title="Not checked yet"
      body="Once a delivery, bill or payment is linked, Satya checks this order’s trail and shows anything that doesn’t add up."
    />
  );
}

/* ---------- activity trail ---------- */

const EVENT_META: Record<string, { icon: typeof Send; label: string; tone?: string }> = {
  draft: { icon: FilePlus2, label: "Created as draft" },
  patch: { icon: Pencil, label: "Edited" },
  compute: { icon: CircleDot, label: "Totals worked out" },
  submit: { icon: Send, label: "Sent for approval" },
  approve: { icon: CheckCircle2, label: "Approved", tone: "var(--confirmed)" },
  reject: { icon: XCircle, label: "Rejected", tone: "var(--sev-critical)" },
  issue: { icon: Send, label: "Issued to supplier", tone: "var(--accent)" },
  amend: { icon: FileEdit, label: "Amendment drafted" },
  "short close": { icon: OctagonX, label: "Short-closed", tone: "var(--sev-medium)" },
  cancel: { icon: XCircle, label: "Cancelled", tone: "var(--sev-critical)" },
};

const DECISION_WORDS: Record<string, string> = {
  APPROVE: "Approved", REQUEST_CLARIFICATION: "Asked the supplier to clarify", PLACE_ON_HOLD: "Put on hold", ESCALATE: "Escalated", REVIEW: "Sent for review",
};

type Activity = NonNullable<Awaited<ReturnType<typeof v2.orderActivity>>>;

/** Names read as people; internal user ids ("usr_…") are dropped. */
const personOf = (actor?: string) => (actor && !/^(usr|user|svc|sys)[_-]/i.test(actor) && !/^[0-9a-f]{16,}$/i.test(actor) ? actor : undefined);

function ActivityTrail({ activity, history }: { activity: Activity | undefined; history: { revision: number; at: string; by: string; change: string }[] }) {
  if (!activity) return <Skeleton className="h-64 w-full" />;
  type Entry = { key: string; at?: string; icon: typeof Send; tone?: string; title: string; body?: string; who?: string };
  const entries: Entry[] = [];
  const who = (role?: string, actor?: string) => [personOf(actor), role && role !== "*" ? roleLabel(role) : null].filter(Boolean).join(" · ") || undefined;

  const audited = new Set((activity.audit ?? []).map((a) => a.event));
  for (const a of activity.audit ?? []) {
    const meta = EVENT_META[a.event] ?? { icon: CircleDot, label: a.event.replace(/^\w/, (c) => c.toUpperCase()) };
    const note = (activity.approvals ?? []).find((ap) => ap.action === a.event && ap.comment)?.comment;
    entries.push({ key: `audit-${a.id}`, at: a.at, icon: meta.icon, tone: meta.tone, title: meta.label, body: note, who: who(a.actorRole, a.actor) });
  }
  for (const ap of activity.approvals ?? []) {
    if (ap.action && audited.has(ap.action)) continue;
    const meta = EVENT_META[ap.action ?? "approve"] ?? EVENT_META.approve;
    entries.push({ key: `ap-${ap.at}-${ap.action}`, at: ap.at, icon: meta.icon, tone: meta.tone, title: meta.label, body: ap.comment, who: who(ap.role, ap.actor) });
  }
  for (const d of activity.decisions ?? []) {
    entries.push({ key: `dec-${d.id}`, at: d.createdAt, icon: Gavel, tone: "var(--sev-medium)", title: DECISION_WORDS[String(d.action)] ?? "Decision recorded", body: d.reason, who: who(d.actorRole, d.actor) });
  }
  for (const am of activity.amendments ?? []) {
    entries.push({ key: `am-${am.id}`, at: am.date, icon: FileEdit, title: `Amendment ${am.number ?? ""}`.trim(), body: am.supersedes ? "Replaces this order" : undefined });
  }
  for (const h of history ?? []) {
    entries.push({ key: `rev-${h.revision}`, at: h.at, icon: FileEdit, title: `Revision ${h.revision}`, body: h.change, who: personOf(h.by) });
  }
  if (activity.meta?.createdAt) {
    entries.push({ key: "created", at: activity.meta.createdAt, icon: FilePlus2, tone: "var(--muted)", title: "Order created", who: personOf(activity.meta.createdBy) });
  }
  entries.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));

  if (!entries.length) {
    return <EmptyState title="No activity yet" body="Approvals, amendments and decisions on this order will appear here." />;
  }
  return (
    <Card>
      <ol className="relative space-y-6 border-l border-[var(--line)] pl-6">
        {entries.map((e) => (
          <li key={e.key} className="relative">
            <span className="absolute -left-[35px] grid h-6 w-6 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)]" style={{ color: e.tone ?? "var(--accent)" }} aria-hidden="true">
              <e.icon size={13} />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[15px] font-medium text-[var(--ink)]">{e.title}</p>
              <p className="text-[13px] text-[var(--muted)]"><DateText value={e.at} withTime /></p>
            </div>
            {e.body ? <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--ink-2)]">{e.body}</p> : null}
            {e.who ? <p className="mt-0.5 text-[13px] text-[var(--muted)]">{e.who}</p> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
