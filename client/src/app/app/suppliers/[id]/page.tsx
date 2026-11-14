"use client";

// Supplier 360 (/app/suppliers/[id]) — docs/plan/06 §5.8.
// Master data (registration, bank, contacts, addresses) next to live activity
// (orders, payments, MSME deadlines, investigations) so the page answers
// "who is this supplier, and what do we owe them right now".

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowUpRight, Building2, Hourglass, Landmark, Mail, MapPin,
  Phone, Plus, ReceiptText, SearchCheck, ShieldCheck, ShoppingCart, Users, Wallet,
} from "lucide-react";
import { v2 } from "@/lib/api/v2";
import type { OrderListRow } from "@/lib/mocks/data";
import { mocksEnabled } from "@/lib/flags";
import { Money, DateText, ErrorState, FadeIn, Card, CardTitle, Term, StatusBadge, SeverityBadge, Progress } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABEL } from "@/content/copy/vocabulary";
import { gstStateName, decodeIfsc, panFromGstin } from "@/lib/india";
import { daysLeftText } from "@/lib/format";
import { cn } from "@/lib/utils";

type MoneyLike = { amount: string; currency: string };
const inr = (n: number): MoneyLike => ({ amount: n.toFixed(2), currency: "INR" });

/** Live payment rows differ between mock + real API — normalise loosely. */
type PaymentRow = {
  id: string; amount?: string | MoneyLike | null; utr?: string | null; date?: string;
  mode?: string | null; counterparty?: string | null; supplier?: string;
  supplierId?: string | null; status?: string; allocatedTotal?: string;
};
const paymentAmount = (p: PaymentRow): string | MoneyLike | undefined =>
  typeof p.amount === "string" || p.amount === null ? (p.amount ?? undefined) : p.amount;

const PAY_STATUS: Record<string, { label: string; tone: PillTone }> = {
  allocated: { label: "Fully allocated", tone: "good" },
  linked: { label: "Allocated", tone: "good" },
  partial: { label: "Part allocated", tone: "warn" },
  unallocated: { label: "Not allocated", tone: "warn" },
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
const PILL_CLASSES: Record<PillTone, string> = {
  good: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]",
  warn: "bg-[var(--likely-soft)] text-[var(--likely)]",
  bad: "bg-[var(--sev-high-soft)] text-[var(--sev-high)]",
  muted: "bg-[var(--surface-2)] text-[var(--ink-2)]",
};

function Pill({ tone = "muted", children }: { tone?: PillTone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", PILL_CLASSES[tone])}>
      {children}
    </span>
  );
}

function Field({ label, value, mono, sub }: { label: string; value?: React.ReactNode; mono?: boolean; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={cn("mt-1 text-sm text-[var(--ink)]", mono && "font-code")}>{value ?? "—"}</p>
      {sub ? <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)]/60 p-3.5">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className={cn("tnum mt-1.5 text-lg font-semibold tracking-tight", warn ? "text-[var(--sev-high)]" : "text-[var(--ink)]")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] leading-snug text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}

/** Labelled mini fulfilment bar used per order row. */
function Meter({ label, pct }: { label: string; pct?: string }) {
  const value = Math.min(100, Math.max(0, Number(pct ?? 0) || 0));
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <Progress value={value} className="h-[4px] flex-1" />
      <span className="tnum w-9 shrink-0 text-right text-[10px] text-[var(--ink-2)]">{value}%</span>
    </div>
  );
}

/** Rows inside a pad={false} card — shared list shell. */
function ListShell({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-[var(--line)]">{children}</ul>;
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mocks = mocksEnabled();

  const supplierQ = useQuery({ queryKey: ["supplier", id], queryFn: () => v2.supplier(id) });
  const supplier = supplierQ.data ?? undefined;
  const enabled = Boolean(supplier);

  const ordersQ = useQuery({
    queryKey: ["supplier-orders", id],
    queryFn: () => v2.orders({ supplierId: id, limit: "50", sort: "newest" }),
    enabled,
  });
  const paymentsQ = useQuery({
    queryKey: ["supplier-payments", id],
    queryFn: () => v2.payments({ pageSize: "50" }),
    enabled,
  });
  const casesQ = useQuery({
    queryKey: ["supplier-cases", id],
    queryFn: () => v2.cases(),
    enabled,
  });
  const complianceQ = useQuery({
    queryKey: ["supplier-compliance", id],
    queryFn: () => v2.complianceSection("msme"),
    enabled,
  });

  // Names this supplier can appear under on documents (legal + trade names).
  const names = useMemo(
    () => new Set([supplier?.name, supplier?.legalName, ...(supplier?.tradeNames ?? [])].filter(Boolean) as string[]),
    [supplier],
  );

  const orders = useMemo(() => {
    const items = ordersQ.data?.items ?? [];
    // Real mode filters server-side via supplierId; mock mode ignores params.
    return mocks ? items.filter((o) => names.has(o.supplier)) : items;
  }, [ordersQ.data, mocks, names]);

  const payments = useMemo(() => {
    const items = (paymentsQ.data?.items ?? []) as PaymentRow[];
    return items.filter(
      (p) => p.supplierId === id || (p.counterparty ? names.has(p.counterparty) : false) || (p.supplier ? names.has(p.supplier) : false),
    );
  }, [paymentsQ.data, id, names]);

  const supplierCases = useMemo(() => {
    const orderIds = new Set(orders.map((o) => o.id));
    const orderCaseIds = new Set(orders.map((o) => (o as OrderListRow & { caseId?: string }).caseId).filter(Boolean));
    return (casesQ.data?.items ?? []).filter(
      (c) => orderCaseIds.has(c.id) || (c.subjectIds ?? []).some((s) => s === id || orderIds.has(s)),
    );
  }, [casesQ.data, orders, id]);

  type MsmeRow = {
    documentId?: string; invoice?: string; supplier?: string; category?: string;
    amount?: MoneyLike; dueDate?: string; daysLeft?: number; note?: string;
  };
  const msmeItems = useMemo(
    () => ((complianceQ.data?.items ?? []) as MsmeRow[]).filter((i) => i.supplier && names.has(i.supplier)),
    [complianceQ.data, names],
  );

  const totals = useMemo(() => {
    const ordered = orders.reduce((s, o) => s + Number(o.value?.amount ?? 0), 0);
    const invoiced = orders.reduce((s, o) => s + (Number(o.value?.amount ?? 0) * Number(o.invoicedPct ?? 0)) / 100, 0);
    const paid = orders.reduce((s, o) => s + (Number(o.value?.amount ?? 0) * Number(o.paidPct ?? 0)) / 100, 0);
    const issues = orders.reduce((s, o) => s + (o.issueCount ?? 0), 0);
    return { ordered, invoiced, paid, issues };
  }, [orders]);

  if (supplierQ.error) return <ErrorState message={supplierQ.error instanceof Error ? supplierQ.error.message : "Something went wrong."} onRetry={() => supplierQ.refetch()} />;
  if (supplierQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!supplier) return <ErrorState message="Supplier not found." />;

  const isMsme = Boolean(supplier.msme || supplier.msmeFlag);
  const gstStates = [...new Set((supplier.gstins ?? []).map((g) => gstStateName(g.stateCode ?? g.gstin?.slice(0, 2))).filter(Boolean))] as string[];
  const openIssues = Math.max(totals.issues, supplier.issueCount);
  const openValue = supplier.openValue ?? (ordersQ.data ? inr(Math.max(0, totals.invoiced - totals.paid)) : undefined);
  const paidTotal = payments.length
    ? inr(payments.reduce((s, p) => s + Number(typeof p.amount === "string" ? p.amount : p.amount?.amount ?? 0), 0))
    : totals.paid > 0 ? inr(totals.paid) : undefined;
  const terms = supplier.paymentTermsDays != null ? `${supplier.paymentTermsDays} days` : "—";

  return (
    <FadeIn className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
          <ArrowLeft size={15} /> Back
        </button>
        <Link
          href="/app/orders/new"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)]/45 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]"
        >
          <Plus size={13} /> New purchase order
        </Link>
      </div>

      {/* header */}
      <Card className="glow-accent">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Building2 size={20} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">{supplier.name}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-strong)]">
                <ShieldCheck size={11} /> Active supplier
              </span>
              {supplier.msme && (
                <span className="rounded-full border border-[var(--likely)]/30 bg-[var(--likely-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--likely)]">
                  <Term of="MSME">{supplier.msme} enterprise</Term>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {(supplier.tradeNames ?? []).length ? <>Also trades as {supplier.tradeNames!.join(", ")} · </> : null}
              {(supplier.tags ?? []).length ? <>Category: {supplier.tags!.join(", ")} · </> : null}
              Payment terms: {terms}
              {gstStates.length ? <> · GST in {gstStates.join(", ")}</> : null}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label="Outstanding payable"
            value={openValue ? <Money value={openValue} /> : "—"}
            sub="invoiced less paid on record"
          />
          <Kpi
            label="Order value"
            value={ordersQ.isLoading ? "…" : orders.length ? <Money value={inr(totals.ordered)} /> : "—"}
            sub={`${orders.length} purchase order${orders.length === 1 ? "" : "s"}`}
          />
          <Kpi
            label="Paid to date"
            value={paidTotal ? <Money value={paidTotal} /> : "—"}
            sub={payments.length ? `across ${payments.length} transfer${payments.length === 1 ? "" : "s"}` : "against invoiced value"}
          />
          <Kpi
            label="Open issues"
            value={openIssues || "None"}
            warn={openIssues > 0}
            sub="flagged on orders & checks"
          />
          <Kpi
            label={isMsme ? "Overdue MSME" : "MSME"}
            value={isMsme ? (supplier.overdue ? <Money value={supplier.overdue} /> : "On track") : "Not registered"}
            warn={isMsme && Boolean(supplier.overdue)}
            sub={isMsme ? "45-day rule applies" : "45-day rule doesn't apply"}
          />
          <Kpi label="Payment terms" value={terms} sub="agreed credit period" />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ---------- activity column ---------- */}
        <div className="space-y-4 xl:col-span-2">
          {/* purchase orders */}
          <Card pad={false}>
            <div className="p-5 pb-0">
              <CardTitle icon={ShoppingCart} hint={ordersQ.isLoading ? "Loading…" : `${orders.length} on record`}>Purchase orders</CardTitle>
            </div>
            {ordersQ.isLoading ? (
              <div className="space-y-2 p-5 pt-0">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : orders.length === 0 ? (
              <p className="px-5 pb-5 text-xs text-[var(--muted)]">No purchase orders for this supplier yet.</p>
            ) : (
              <ListShell>
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/app/orders/${o.id}`}
                      className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-[var(--surface-2)]/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-code text-xs font-medium text-[var(--accent-strong)]">{o.number}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          <DateText value={o.date} /> · {STATUS_LABEL[o.status] ?? o.status.replaceAll("_", " ")}
                        </p>
                      </div>
                      <div className="hidden w-48 shrink-0 space-y-1 md:block">
                        <Meter label="Delivered" pct={o.deliveredPct} />
                        <Meter label="Invoiced" pct={o.invoicedPct} />
                        <Meter label="Paid" pct={o.paidPct} />
                      </div>
                      <div className="shrink-0 text-right">
                        <Money value={o.value} className="text-sm font-medium text-[var(--ink)]" />
                        <p className={cn("mt-0.5 text-[11px]", o.issueCount ? "font-medium text-[var(--sev-high)]" : "text-[var(--muted)]")}>
                          {o.issueCount ? `${o.issueCount} open issue${o.issueCount === 1 ? "" : "s"}` : "no issues"}
                        </p>
                      </div>
                      <ArrowUpRight size={14} className="shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
                    </Link>
                  </li>
                ))}
              </ListShell>
            )}
          </Card>

          {/* payments */}
          <Card pad={false}>
            <div className="p-5 pb-0">
              <CardTitle icon={Wallet} hint={paymentsQ.isLoading ? "Loading…" : `${payments.length} transfer${payments.length === 1 ? "" : "s"}`}>Payments to this supplier</CardTitle>
            </div>
            {paymentsQ.isLoading ? (
              <div className="space-y-2 p-5 pt-0">{[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : payments.length === 0 ? (
              <p className="px-5 pb-5 text-xs text-[var(--muted)]">No bank transfers matched to this supplier yet.</p>
            ) : (
              <ListShell>
                {payments.map((p) => {
                  const st = PAY_STATUS[p.status ?? ""] ?? PAY_STATUS.not_linked;
                  return (
                    <li key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-code text-xs font-medium text-[var(--ink)]">{p.utr ?? "No bank reference"}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          {p.date ? <DateText value={p.date} /> : "—"}
                          {p.mode ? <> · {p.mode}</> : null}
                          {p.status === "partial" && p.allocatedTotal ? <> · <Money value={p.allocatedTotal} /> allocated</> : null}
                        </p>
                      </div>
                      <Money value={paymentAmount(p)} className="shrink-0 text-sm font-medium text-[var(--ink)]" />
                      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium", PILL_CLASSES[st.tone])}>{st.label}</span>
                    </li>
                  );
                })}
              </ListShell>
            )}
          </Card>

          {/* investigations */}
          {supplierCases.length > 0 && (
            <Card pad={false}>
              <div className="p-5 pb-0">
                <CardTitle icon={SearchCheck} hint={`${supplierCases.length} open`}>Open checks involving this supplier</CardTitle>
              </div>
              <ListShell>
                {supplierCases.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/investigations/${c.id}`}
                      className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--surface-2)]/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--ink)]">{c.title}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          {(c as { findingCount?: number }).findingCount
                            ? `${(c as { findingCount?: number }).findingCount} issue${(c as { findingCount?: number }).findingCount === 1 ? "" : "s"} under review`
                            : "Under review"}
                        </p>
                      </div>
                      {(c as { severity?: string }).severity ? <SeverityBadge severity={(c as { severity?: string }).severity!} /> : null}
                      <StatusBadge status={c.status} />
                      <ArrowUpRight size={14} className="shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
                    </Link>
                  </li>
                ))}
              </ListShell>
            </Card>
          )}

          {/* MSME deadlines */}
          {isMsme && (
            <Card pad={false}>
              <div className="p-5 pb-0">
                <CardTitle icon={Hourglass} hint="45-day rule">MSME payment deadlines</CardTitle>
              </div>
              <p className="px-5 pb-3 text-[11px] leading-relaxed text-[var(--muted)]">
                Dues to {supplier.msme ?? "micro & small"} suppliers must be paid within {supplier.paymentTermsDays ?? 45} days of acceptance —
                after that, interest runs at 3× the RBI rate.
              </p>
              {complianceQ.isLoading ? (
                <div className="space-y-2 p-5 pt-0"><Skeleton className="h-12 w-full" /></div>
              ) : msmeItems.length === 0 ? (
                <p className="px-5 pb-5 text-xs text-[var(--muted)]">No unpaid MSME invoices on record — nothing is counting down.</p>
              ) : (
                <ListShell>
                  {msmeItems.map((m, i) => {
                    const days = m.daysLeft ?? 0;
                    const tone: PillTone = days < 0 ? "bad" : days <= 7 ? "warn" : "good";
                    return (
                      <li key={m.documentId ?? i} className="flex items-center gap-4 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-code text-xs font-medium text-[var(--ink)]">{m.invoice ?? m.documentId ?? "Invoice"}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                            due {m.dueDate ? <DateText value={m.dueDate} /> : "—"}
                          </p>
                        </div>
                        {m.amount ? <Money value={m.amount} className="shrink-0 text-sm font-medium text-[var(--ink)]" /> : null}
                        <Pill tone={tone}>{daysLeftText(days)}</Pill>
                      </li>
                    );
                  })}
                </ListShell>
              )}
            </Card>
          )}
        </div>

        {/* ---------- master data column ---------- */}
        <div className="space-y-4">
          {/* registration & tax */}
          <Card>
            <CardTitle icon={ReceiptText} hint="PAN · GST · Udyam">Registration & tax</CardTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="PAN"
                value={supplier.pan}
                mono
                sub={supplier.pan && (supplier.gstins ?? []).some((g) => panFromGstin(g.gstin) === supplier.pan) ? "Matches PAN inside GSTIN" : undefined}
              />
              <Field
                label="Udyam registration"
                value={supplier.udyam?.number}
                mono
                sub={supplier.udyam ? `${supplier.udyam.category} enterprise${supplier.udyam.verifiedAt ? ` · verified ${supplier.udyam.verifiedAt}` : ""}` : "Not MSME-registered"}
              />
              <Field
                label="Payment terms"
                value={terms}
                sub={isMsme ? "MSME payment clock applies" : "agreed credit period"}
              />
              <Field label="Supplier ID" value={supplier.id} mono />
            </div>
            <div className="mt-5 space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">GST registrations</p>
              {(supplier.gstins ?? []).map((g) => {
                const state = gstStateName(g.stateCode ?? g.gstin?.slice(0, 2));
                const panOk = Boolean(supplier.pan && panFromGstin(g.gstin) === supplier.pan);
                return (
                  <div key={g.gstin} className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-code text-xs font-medium text-[var(--ink)]">{g.gstin}</span>
                      <Pill tone="good">{g.status || "active"}</Pill>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      {state ?? `State code ${g.stateCode ?? "—"}`}
                      {panOk ? " · PAN inside GSTIN matches" : ""}
                    </p>
                  </div>
                );
              })}
              {!(supplier.gstins ?? []).length && <p className="text-xs text-[var(--muted)]">No GSTIN on file.</p>}
            </div>
          </Card>

          {/* bank accounts */}
          <Card>
            <CardTitle icon={Landmark} hint={`${(supplier.bankAccounts ?? []).length} on file`}>Bank accounts</CardTitle>
            <p className="-mt-2 mb-4 text-[11px] leading-relaxed text-[var(--muted)]">
              Account changes need a second person to approve before use.
            </p>
            <div className="space-y-2">
              {(supplier.bankAccounts ?? []).map((acct, i) => {
                const { bank, branch } = decodeIfsc(acct.ifsc);
                const st = BANK_STATUS[acct.status ?? "active"] ?? BANK_STATUS.active;
                return (
                  <div key={acct.id ?? i} className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-[var(--ink)]">{bank ?? "Bank account"}</p>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </div>
                    <p className="mt-1 font-code text-xs text-[var(--ink)]">{acct.masked ?? acct.accountMasked ?? "••••"}</p>
                    <p className="mt-0.5 font-code text-[11px] text-[var(--muted)]">
                      IFSC {acct.ifsc || "—"}{branch ? ` · branch ${branch}` : ""}
                    </p>
                    {acct.holderName ? <p className="mt-1 text-[11px] text-[var(--muted)]">Account holder: {acct.holderName}</p> : null}
                  </div>
                );
              })}
              {!(supplier.bankAccounts ?? []).length && (
                <p className="text-xs text-[var(--muted)]">No bank account on file — add one before paying this supplier.</p>
              )}
            </div>
          </Card>

          {/* contacts */}
          {(supplier.contacts ?? []).length > 0 && (
            <Card>
              <CardTitle icon={Users} hint={`${supplier.contacts!.length} on file`}>Contacts</CardTitle>
              <div className="space-y-2">
                {supplier.contacts!.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent-strong)]">
                      {(c.name || "?").trim().slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--ink)]">{c.name || "Contact"}</p>
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
                          <Mail size={11} /> {c.email}
                        </a>
                      ) : null}
                      {c.phone ? (
                        <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="mt-0.5 flex items-center gap-1.5 font-code text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
                          <Phone size={11} /> {c.phone}
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* addresses */}
          <Card>
            <CardTitle icon={MapPin} hint={`${(supplier.addresses ?? []).length} on file`}>Addresses</CardTitle>
            <div className="space-y-2">
              {(supplier.addresses ?? []).map((addr, i) => {
                const state = gstStateName(addr.stateCode);
                return (
                  <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{addr.label || `Address ${i + 1}`}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--ink)]">
                      {[addr.line1, [addr.city, state, addr.pin].filter(Boolean).join(" – ")].filter(Boolean).join(", ")}
                    </p>
                    {addr.stateCode ? <p className="mt-0.5 text-[11px] text-[var(--muted)]">GST state code {addr.stateCode}</p> : null}
                  </div>
                );
              })}
              {!(supplier.addresses ?? []).length && <p className="text-xs text-[var(--muted)]">No address on file.</p>}
            </div>
          </Card>

          {/* note */}
          <Card>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Signals, not verdicts</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              Statistical indicators (like unusual-amount or duplicate-vendor signals) point you at records worth checking —
              they are never treated as proof. Open this supplier&apos;s orders to review deliveries, invoices and payments.
            </p>
          </Card>
        </div>
      </div>
    </FadeIn>
  );
}
