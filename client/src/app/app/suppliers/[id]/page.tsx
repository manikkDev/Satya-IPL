"use client";

// Supplier (/app/suppliers/[id]) — "What do we owe this supplier, is it safe
// to pay, and what needs doing?" Three numbers, then the risk score next to
// concrete next steps (review an order's issues, match a payment), then tabs
// for open bills, orders, payments and master data.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Landmark, Mail, MapPin, MessageSquare, Phone, Plus, ReceiptText, ShoppingCart, Users, Wallet,
} from "lucide-react";
import { v2 } from "@/lib/api/v2";
import type { OrderListRow } from "@/lib/mocks/data";
import { mocksEnabled } from "@/lib/flags";
import { Money, DateText, ErrorState, FadeIn, Card, CardTitle, StatusBadge, PageHeader, BtnLink, Btn, StatCard, ToneBadge, EmptyState, ResponsiveTable, RowActions, TableSkeleton, type Column } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProgressStack } from "@/components/pages/shared/progress-meter";
import { pageTabsList, pageTabsTrigger, tabCount } from "@/components/pages/shared/page-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { gstStateName, decodeIfsc, panFromGstin } from "@/lib/india";
import { daysLeftText, daysFromTodayIst, formatDate, formatMoney, toPaise } from "@/lib/format";
import { v2PagesSupplier as v2Pages, type SupplierSummary } from "@/lib/api/v2-pages";
import { workflow } from "@/lib/api/workflow";
import { RiskBadge } from "@/components/v2/risk-badge";
import { cn } from "@/lib/utils";

type MoneyLike = { amount: string; currency: string };

/** Live payment rows differ between mock + real API — normalise loosely. */
type PaymentRow = {
  id: string; amount?: string | MoneyLike | null; utr?: string | null; date?: string;
  mode?: string | null; counterparty?: string | null; supplier?: string;
  supplierId?: string | null; status?: string; allocatedTotal?: string;
};
const paymentAmount = (p: PaymentRow): string | MoneyLike | undefined =>
  typeof p.amount === "string" || p.amount === null ? (p.amount ?? undefined) : p.amount;

const PAY_STATUS: Record<string, { label: string; tone: PillTone }> = {
  allocated: { label: "Matched", tone: "good" },
  linked: { label: "Matched", tone: "good" },
  partial: { label: "Part matched", tone: "warn" },
  unallocated: { label: "Not matched", tone: "warn" },
  needs_evidence: { label: "Needs evidence", tone: "bad" },
  unclear: { label: "Needs your call", tone: "warn" },
  not_linked: { label: "Not linked", tone: "muted" },
};

const BANK_STATUS: Record<string, { label: string; tone: PillTone }> = {
  active: { label: "Verified", tone: "good" },
  pending_change: { label: "Awaiting second approval", tone: "warn" },
  inactive: { label: "Inactive", tone: "muted" },
};

type PillTone = "good" | "warn" | "bad" | "muted";
function Field({ label, value, sub }: { label: string; value?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-[15px] text-[var(--ink)] tnum">{value ?? "—"}</p>
      {sub ? <p className="mt-0.5 text-[13px] leading-snug text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}

type SupplierSummaryX = SupplierSummary & {
  openInvoices?: {
    id: string; number?: string; date?: string; dueDate?: string | null; overdueDays?: number;
    total?: MoneyLike; settled?: MoneyLike; outstanding?: MoneyLike; caseId?: string | null;
    msme?: { dueDate?: string; daysLeft?: number } | null;
  }[];
  openFindings: SupplierSummary["openFindings"] & { items?: { id: string; code: string; severity: string; caseId?: string; amount?: string }[] };
};
type OpenBill = NonNullable<SupplierSummaryX["openInvoices"]>[number];

const positive = (m?: MoneyLike | string | null) => !!m && toPaise(typeof m === "string" ? m : m.amount) > BigInt(0);

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mocks = mocksEnabled();
  const [tab, setTab] = useState("bills");

  const supplierQ = useQuery({ queryKey: ["supplier", id], queryFn: () => v2.supplier(id) });
  const supplier = supplierQ.data ?? undefined;
  const enabled = Boolean(supplier);

  const ordersQ = useQuery({
    queryKey: ["supplier-orders", id],
    queryFn: () => v2.orders({ supplierId: id, limit: "50", sort: "attention" }),
    enabled,
  });
  const paymentsQ = useQuery({
    queryKey: ["supplier-payments", id, supplier?.name],
    queryFn: () => v2.payments({ pageSize: "50", ...(supplier?.name ? { q: supplier.name } : {}) }),
    enabled,
  });
  // Server-computed position for this supplier (paise arithmetic, all
  // invoices/payments — not a client-side sample).
  const summaryQ = useQuery({
    queryKey: ["supplier-summary", id],
    queryFn: () => v2Pages.supplierSummary(id) as Promise<SupplierSummaryX>,
    enabled: enabled && !mocks,
    retry: 0,
  });
  const riskQ = useQuery({ queryKey: ["supplier-risk", id], queryFn: () => workflow.supplierRisk(id), enabled: enabled && !mocks, retry: 0 });

  const names = useMemo(
    () => new Set([supplier?.name, supplier?.legalName, ...(supplier?.tradeNames ?? [])].filter(Boolean) as string[]),
    [supplier],
  );
  const orders = useMemo(() => {
    const items = (ordersQ.data?.items ?? []) as (OrderListRow & { caseId?: string | null })[];
    return mocks ? items.filter((o) => names.has(o.supplier)) : items;
  }, [ordersQ.data, mocks, names]);
  const payments = useMemo(() => {
    const items = (paymentsQ.data?.items ?? []) as PaymentRow[];
    return items.filter((p) => p.supplierId === id || (p.counterparty ? names.has(p.counterparty) : false) || (p.supplier ? names.has(p.supplier) : false));
  }, [paymentsQ.data, id, names]);

  if (supplierQ.error) return <ErrorState message={supplierQ.error instanceof Error ? supplierQ.error.message : "Something went wrong."} onRetry={() => supplierQ.refetch()} />;
  if (supplierQ.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-5 w-24" />
        <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-80 max-w-full" /><Skeleton className="h-4 w-96 max-w-full" /></div>
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!supplier) return <ErrorState message="Supplier not found." />;

  const sum = summaryQ.data;
  const msmeCategory = sum?.msme?.category ?? supplier.udyam?.category ?? supplier.msme;
  const isMsme = Boolean(msmeCategory || supplier.msmeFlag);
  const gstStates = [...new Set((supplier.gstins ?? []).map((g) => gstStateName(g.stateCode ?? g.gstin?.slice(0, 2))).filter(Boolean))] as string[];
  const terms = supplier.paymentTermsDays != null ? `${supplier.paymentTermsDays} days` : null;
  const orderNumberByCase = new Map(orders.filter((o) => o.caseId).map((o) => [o.caseId as string, o.number]));
  const openBills = sum?.openInvoices ?? [];

  // What to do about the risk — one row per concrete next step.
  const issuesByCase = new Map<string, number>();
  for (const f of sum?.openFindings?.items ?? []) if (f.caseId) issuesByCase.set(f.caseId, (issuesByCase.get(f.caseId) ?? 0) + 1);
  const todo: { key: string; text: React.ReactNode; action: React.ReactNode }[] = [];
  for (const [caseId, n] of [...issuesByCase.entries()].sort((a, b) => b[1] - a[1])) {
    todo.push({
      key: caseId,
      text: <>{n} open issue{n === 1 ? "" : "s"} on order <span className="tnum whitespace-nowrap">{orderNumberByCase.get(caseId) ?? ""}</span></>,
      action: <BtnLink size="sm" variant="secondary" href={`/app/investigations/${caseId}`}>Review</BtnLink>,
    });
  }
  if (positive(sum?.unallocatedPayments)) {
    todo.push({
      key: "unmatched",
      text: <><Money value={sum!.unallocatedPayments} className="font-medium text-[var(--ink)]" /> paid to them but not matched to a bill</>,
      action: <BtnLink size="sm" variant="secondary" href="/app/payments">Match</BtnLink>,
    });
  }
  if (positive(sum?.msme?.overdue)) {
    todo.push({
      key: "msme",
      text: <><Money value={sum!.msme!.overdue} className="font-medium text-[var(--sev-critical)]" /> overdue under the MSME 45-day rule</>,
      action: <Btn size="sm" variant="secondary" onClick={() => setTab("bills")}>See bills</Btn>,
    });
  }

  const billColumns: Column<OpenBill>[] = [
    {
      key: "bill", header: "Bill", primary: true,
      cell: (b) => (
        <div className="min-w-0">
          <Link href={`/app/documents/${b.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-[var(--ink)] hover:underline">{b.number ?? "Unnumbered bill"}</Link>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">Dated <DateText value={b.date} /></p>
        </div>
      ),
    },
    {
      key: "due", header: "Due",
      cell: (b) => {
        const days = b.msme?.daysLeft ?? (b.dueDate ? daysFromTodayIst(b.dueDate) : null);
        return (
          <div>
            <DateText value={b.msme?.dueDate ?? b.dueDate ?? null} className="whitespace-nowrap" />
            {days !== null && days !== undefined ? (
              <p className={cn("text-[13px]", days < 0 ? "font-medium text-[var(--sev-critical)]" : days <= 7 ? "text-[var(--sev-medium)]" : "text-[var(--muted)]")}>
                {daysLeftText(days)}{b.msme ? " · MSME" : ""}
              </p>
            ) : null}
          </div>
        );
      },
    },
    { key: "total", header: "Bill total", align: "right", cell: (b) => <Money value={b.total} /> },
    { key: "out", header: "Still owed", align: "right", cell: (b) => <Money value={b.outstanding} className="font-semibold text-[var(--ink)]" /> },
    {
      key: "state", header: "Status",
      cell: (b) => (b.caseId && issuesByCase.get(b.caseId) ? <ToneBadge tone="warn">Has open issues</ToneBadge> : <ToneBadge tone="good">OK to pay</ToneBadge>),
    },
  ];

  const orderColumns: Column<OrderListRow & { caseId?: string | null }>[] = [
    {
      key: "po", header: "Order", primary: true,
      cell: (o) => (
        <div className="min-w-0">
          <Link href={`/app/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-[var(--ink)] hover:underline tnum">{o.number}</Link>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]"><DateText value={o.date} /></p>
        </div>
      ),
    },
    { key: "value", header: "Value", align: "right", cell: (o) => <Money value={o.value} className="font-medium text-[var(--ink)]" /> },
    {
      key: "progress", header: "Progress",
      cell: (o) => <ProgressStack rows={[{ label: "Delivered", pct: o.deliveredPct }, { label: "Billed", pct: o.invoicedPct, warn: Number(o.invoicedPct) > Number(o.deliveredPct) + 0.5 }, { label: "Paid", pct: o.paidPct }]} />,
    },
    {
      key: "status", header: "Status",
      cell: (o) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={o.status} />
          {o.issueCount ? <span className="text-[13px] font-medium text-[var(--sev-high)]">{o.issueCount} issue{o.issueCount === 1 ? "" : "s"}</span> : null}
        </div>
      ),
    },
  ];

  const payColumns: Column<PaymentRow>[] = [
    {
      key: "date", header: "Date", primary: true,
      cell: (p) => (
        <div>
          <p className="font-medium text-[var(--ink)]">{p.date ? <DateText value={p.date} /> : "No date"}</p>
          <p className="mt-0.5 text-[13px] text-[var(--muted)] tnum">{p.utr ? `UTR ${p.utr}` : "No bank reference"}{p.mode ? ` · ${p.mode}` : ""}</p>
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", cell: (p) => <Money value={paymentAmount(p)} className="font-semibold text-[var(--ink)]" /> },
    {
      key: "status", header: "Status",
      cell: (p) => {
        const st = PAY_STATUS[p.status ?? ""] ?? PAY_STATUS.not_linked;
        return <ToneBadge tone={st.tone === "good" ? "good" : st.tone === "bad" ? "bad" : st.tone === "warn" ? "warn" : "neutral"}>{st.label}</ToneBadge>;
      },
    },
  ];

  const unmatchedPayments = payments.filter((p) => ["unallocated", "partial", "needs_evidence", "unclear"].includes(p.status ?? "")).length;

  return (
    <FadeIn className="space-y-8">
      <div className="space-y-4">
        <Link href="/app/suppliers" className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={15} aria-hidden="true" /> Suppliers
        </Link>
        <PageHeader
          eyebrow={isMsme ? `Supplier · ${String(msmeCategory).charAt(0).toUpperCase()}${String(msmeCategory).slice(1)} enterprise (MSME)` : "Supplier"}
          title={<span className="inline-flex flex-wrap items-center gap-3">{supplier.name} {riskQ.data ? <RiskBadge risk={riskQ.data} /> : null}</span>}
          description={[
            terms ? `Credit terms ${terms}` : null,
            gstStates.length ? `GST registered in ${gstStates.join(", ")}` : supplier.gstin ? null : "No GSTIN on file",
            (supplier.tradeNames ?? []).length ? `Also trades as ${supplier.tradeNames!.join(", ")}` : null,
          ].filter(Boolean).join(" · ") || undefined}
          actions={
            <>
              <BtnLink href="/app/orders/new" icon={Plus}>New purchase order</BtnLink>
              <RowActions
                label={supplier.name}
                items={[
                  { label: "Ask Satya about them", icon: MessageSquare, onSelect: () => router.push(`/app/ask?about=${encodeURIComponent(supplier.name)}`) },
                  { label: "See all their payments", icon: Wallet, onSelect: () => setTab("payments") },
                ]}
              />
            </>
          }
        />
      </div>

      {/* the position, in three numbers */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="You owe them"
          tip="Bills less payments and credit notes applied to them."
          value={sum ? <Money value={sum.outstanding} /> : summaryQ.isLoading ? "…" : "—"}
          delta={sum ? (positive(sum.disputed) ? `${formatMoney(sum.disputed)} of it has open issues` : "No open issues on these bills") : undefined}
          tone={sum && positive(sum.disputed) ? "warn" : "default"}
        />
        <StatCard
          label="Safe to pay"
          tip="What you owe on bills with no open issues."
          value={sum ? <Money value={sum.undisputedOutstanding} /> : summaryQ.isLoading ? "…" : "—"}
          delta={openBills.length ? `${openBills.length} open bill${openBills.length === 1 ? "" : "s"}` : "No open bills"}
          tone="good"
        />
        <StatCard
          label="Paid to date"
          value={sum ? <Money value={sum.paid} /> : summaryQ.isLoading ? "…" : "—"}
          delta={sum && positive(sum.unallocatedPayments) ? `${formatMoney(sum.unallocatedPayments)} not matched to a bill` : `${payments.length} payment${payments.length === 1 ? "" : "s"}`}
        />
      </div>

      {/* risk — and what to do about it */}
      {riskQ.data ? (
        <Card>
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
            <div>
              <h2 className="flex items-center gap-2 text-[17px] font-semibold text-[var(--ink)]">Why the risk is {riskQ.data.band} <span className="tnum text-[15px] font-normal text-[var(--muted)]">({riskQ.data.score} points)</span></h2>
              {riskQ.data.factors.length === 0 ? (
                <p className="mt-2 text-[15px] text-[var(--muted)]">No open issues or master-data gaps — nothing raises this supplier’s risk.</p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--line)]">
                  {riskQ.data.factors.map((f) => (
                    <li key={f.label} className="flex items-start justify-between gap-4 py-2.5 text-[15px]">
                      <span>
                        <span className="text-[var(--ink)]">{f.label}</span>
                        {f.detail ? <span className="block text-[13px] text-[var(--muted)]">{f.detail}</span> : null}
                      </span>
                      <span className="tnum shrink-0 text-[14px] font-medium text-[var(--ink-2)]">+{f.points}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[13px] text-[var(--muted)]">A prioritisation aid built from open issues and record checks — a signal, not a verdict.</p>
            </div>
            <div className="border-t border-[var(--line)] pt-5 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
              <h2 className="text-[17px] font-semibold text-[var(--ink)]">What to do</h2>
              {todo.length === 0 ? (
                <p className="mt-2 text-[15px] text-[var(--muted)]">{summaryQ.isLoading ? "Working it out…" : "Nothing needs you for this supplier right now."}</p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--line)]">
                  {todo.slice(0, 5).map((t) => (
                    <li key={t.key} className="flex items-center justify-between gap-4 py-2.5 text-[15px] text-[var(--ink-2)]">
                      <span className="min-w-0">{t.text}</span>
                      <span className="shrink-0">{t.action}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={pageTabsList}>
          <TabsTrigger value="bills" className={pageTabsTrigger}>Open bills{openBills.length ? <span className={tabCount}>{openBills.length}</span> : null}</TabsTrigger>
          <TabsTrigger value="orders" className={pageTabsTrigger}>Orders{orders.length ? <span className={tabCount}>{orders.length}</span> : null}</TabsTrigger>
          <TabsTrigger value="payments" className={pageTabsTrigger}>Payments{unmatchedPayments ? <span className={tabCount}>{unmatchedPayments} to match</span> : null}</TabsTrigger>
          <TabsTrigger value="details" className={pageTabsTrigger}>Details</TabsTrigger>
        </TabsList>

        <TabsContent value="bills" className="mt-6">
          {summaryQ.isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : openBills.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No open bills" body="Everything billed by this supplier has been paid or credited." />
          ) : (
            <ResponsiveTable
              caption="Open bills"
              columns={billColumns}
              rows={openBills}
              rowKey={(b) => b.id}
              actions={(b) => (
                <RowActions
                  label={b.number ?? "this bill"}
                  primary={b.caseId && issuesByCase.get(b.caseId) ? { label: "Review issues", href: `/app/investigations/${b.caseId}` } : { label: "Open", href: `/app/documents/${b.id}` }}
                />
              )}
            />
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-6">
          {ordersQ.isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : orders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No purchase orders yet" body="Orders you raise with this supplier appear here." actionLabel="New purchase order" actionHref="/app/orders/new" />
          ) : (
            <ResponsiveTable
              caption="Purchase orders"
              columns={orderColumns}
              rows={orders}
              rowKey={(o) => o.id}
              actions={(o) => <RowActions label={o.number} primary={o.issueCount && o.caseId ? { label: "Review", href: `/app/investigations/${o.caseId}` } : { label: "Open", href: `/app/orders/${o.id}` }} />}
            />
          )}
        </TabsContent>

        <TabsContent value="payments" className="mt-6">
          {paymentsQ.isLoading ? (
            <TableSkeleton rows={3} columns={4} />
          ) : payments.length === 0 ? (
            <EmptyState icon={Wallet} title="No payments yet" body="Bank transfers to this supplier appear here once a bank statement is imported." actionLabel="Go to Payments" actionHref="/app/payments" />
          ) : (
            <ResponsiveTable
              caption="Payments to this supplier"
              columns={payColumns}
              rows={payments}
              rowKey={(p) => p.id}
              actions={(p) =>
                ["unallocated", "partial", "needs_evidence", "unclear"].includes(p.status ?? "") ? (
                  <RowActions label={p.utr ?? "this payment"} primary={<BtnLink size="sm" href="/app/payments">Match</BtnLink>} />
                ) : null
              }
            />
          )}
        </TabsContent>

        <TabsContent value="details" className="mt-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <MasterData supplier={supplier} isMsme={isMsme} terms={terms} />
          </div>
        </TabsContent>
      </Tabs>
    </FadeIn>
  );
}

/* ---------- master data (Details tab) ---------- */

function MasterData({ supplier, isMsme, terms }: { supplier: NonNullable<Awaited<ReturnType<typeof v2.supplier>>>; isMsme: boolean; terms: string | null }) {
  return (
    <>
      <Card>
        <CardTitle icon={ReceiptText}>Registration & tax</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="PAN"
            value={supplier.pan}
            sub={supplier.pan && (supplier.gstins ?? []).some((g) => panFromGstin(g.gstin) === supplier.pan) ? "Matches the PAN inside the GSTIN" : undefined}
          />
          <Field
            label="Udyam (MSME) registration"
            value={supplier.udyam?.number}
            sub={supplier.udyam ? `${supplier.udyam.category.charAt(0).toUpperCase()}${supplier.udyam.category.slice(1)} enterprise${supplier.udyam.verifiedAt ? ` · verified ${formatDate(supplier.udyam.verifiedAt)}` : ""}` : "Not MSME-registered"}
          />
          <Field label="Credit terms" value={terms ?? "—"} sub={isMsme ? "The MSME 45-day limit still applies" : undefined} />
        </div>
        <div className="mt-5 space-y-2">
          <p className="text-[13px] text-[var(--muted)]">GST registrations</p>
          {(supplier.gstins ?? []).map((g) => {
            const state = gstStateName(g.stateCode ?? g.gstin?.slice(0, 2));
            return (
              <div key={g.gstin} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] px-3.5 py-2.5">
                <span>
                  <span className="tnum text-[15px] font-medium text-[var(--ink)]">{g.gstin}</span>
                  <span className="block text-[13px] text-[var(--muted)]">{state ?? `State code ${g.stateCode ?? "—"}`}</span>
                </span>
                <ToneBadge tone="good">{g.status ? g.status.charAt(0).toUpperCase() + g.status.slice(1) : "Active"}</ToneBadge>
              </div>
            );
          })}
          {!(supplier.gstins ?? []).length && <p className="text-[15px] text-[var(--sev-high)]">No GSTIN on file — GST credit can’t be claimed on their bills.</p>}
        </div>
      </Card>

      <Card>
        <CardTitle icon={Landmark} description="A new or changed account needs a second person to approve it before it can be paid.">Bank accounts</CardTitle>
        <div className="space-y-2">
          {(supplier.bankAccounts ?? []).map((acct, i) => {
            const { bank, branch } = decodeIfsc(acct.ifsc);
            const st = BANK_STATUS[acct.status ?? "active"] ?? BANK_STATUS.active;
            return (
              <div key={acct.id ?? i} className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[15px] font-medium text-[var(--ink)]">{bank ?? "Bank account"} <span className="tnum text-[var(--ink-2)]">{acct.masked ?? acct.accountMasked ?? ""}</span></p>
                  <ToneBadge tone={st.tone === "good" ? "good" : st.tone === "warn" ? "warn" : "neutral"}>{st.label}</ToneBadge>
                </div>
                <p className="mt-0.5 text-[13px] text-[var(--muted)] tnum">IFSC {acct.ifsc || "—"}{branch ? ` · ${branch}` : ""}{acct.holderName ? ` · ${acct.holderName}` : ""}</p>
              </div>
            );
          })}
          {!(supplier.bankAccounts ?? []).length && <p className="text-[15px] text-[var(--muted)]">No bank account on file — add one before paying this supplier.</p>}
        </div>
      </Card>

      <Card>
        <CardTitle icon={Users}>Contacts</CardTitle>
        {(supplier.contacts ?? []).length ? (
          <div className="space-y-2">
            {supplier.contacts!.map((c, i) => (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3.5 py-3">
                <p className="text-[15px] font-medium text-[var(--ink)]">{c.name || "Contact"}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-[var(--muted)]">
                  {c.email ? <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-[var(--ink)]"><Mail size={14} aria-hidden="true" /> {c.email}</a> : null}
                  {c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 tnum hover:text-[var(--ink)]"><Phone size={14} aria-hidden="true" /> {c.phone}</a> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-[var(--muted)]">No contacts on file.</p>
        )}
      </Card>

      <Card>
        <CardTitle icon={MapPin}>Addresses</CardTitle>
        <div className="space-y-2">
          {(supplier.addresses ?? []).map((addr, i) => {
            const state = gstStateName(addr.stateCode);
            return (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3.5 py-3">
                <p className="text-[13px] font-medium text-[var(--muted)]">{addr.label || `Address ${i + 1}`}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-[var(--ink)]">
                  {[addr.line1, [addr.city, state, addr.pin].filter(Boolean).join(" – ")].filter(Boolean).join(", ")}
                </p>
              </div>
            );
          })}
          {!(supplier.addresses ?? []).length && <p className="text-[15px] text-[var(--muted)]">No address on file.</p>}
        </div>
      </Card>
    </>
  );
}
