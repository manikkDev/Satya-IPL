"use client";

// Reports (/app/reports) — read-only views built from the documents the
// server already holds: payables ageing (MSME highlighted), spend by
// supplier, and open findings by type and severity. Every sum is exact
// (integer paise); day counts and dates are IST; each table exports to CSV.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, Clock3, BarChart3, ListChecks, TriangleAlert, BadgeCheck, Info, FileBarChart } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { docsApi, findingsApi, paiseToDecimal, pctOf, todayIst, fyOfDate, downloadCsv, ZERO } from "@/lib/api/v2-pages";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Money, DateText, ErrorState, EmptyState, PageHeader, FadeIn, Card, Btn, SeverityBadge } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { pageTabsList, pageTabsTrigger } from "@/components/pages/shared/page-tabs";
import { findingLabel } from "@/content/copy/findings";
import { buildPayables, buildSpend, buildFindings, findingTypeLabel, SEVERITIES, type SupplierInfo } from "@/components/pages/reports/aggregate";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const th = "px-4 py-2.5 text-[13px] font-semibold text-[var(--muted)]";
const td = "px-4 py-3.5 text-[15px] text-[var(--ink-2)]";

function SectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-5 pb-5" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}

function SectionHead({ icon, title, hint, onExport, disabled }: { icon: typeof Clock3; title: string; hint?: string; onExport?: () => void; disabled?: boolean }) {
  const Icon = icon;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-[var(--ink)]">
          <Icon size={18} className="text-[var(--muted)]" aria-hidden="true" /> {title}
        </h2>
        {hint ? <p className="mt-1 max-w-2xl text-[15px] text-[var(--muted)]">{hint}</p> : null}
      </div>
      {onExport ? <Btn size="sm" variant="secondary" icon={Download} onClick={onExport} disabled={disabled}>Export CSV</Btn> : null}
    </div>
  );
}

export default function ReportsPage() {
  const { activeEntity } = useSession();
  const entityId = activeEntity?.id ?? "";
  const mocks = mocksEnabled();
  const asOf = todayIst();
  const fileTag = `${activeEntity?.code ?? "satya"}-${asOf}`;

  const invoicesQ = useQuery({
    queryKey: ["report-invoices", entityId],
    queryFn: () => docsApi.all({ type: "INVOICE_IN", entityId: entityId || undefined }),
    enabled: !mocks && Boolean(entityId),
    staleTime: 60_000,
  });
  const paymentsQ = useQuery({
    queryKey: ["report-payments", entityId],
    queryFn: async () => {
      const [pay, adv] = await Promise.all([
        docsApi.all({ type: "PAYMENT_OUT", entityId: entityId || undefined }),
        docsApi.all({ type: "ADVANCE_OUT", entityId: entityId || undefined }),
      ]);
      return { items: [...pay.items, ...adv.items], truncated: pay.truncated || adv.truncated };
    },
    enabled: !mocks && Boolean(entityId),
    staleTime: 60_000,
  });
  const suppliersQ = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers(), enabled: !mocks });
  const findingsQ = useQuery({
    queryKey: ["report-findings", entityId],
    queryFn: () => findingsApi.open(entityId || undefined),
    enabled: !mocks && Boolean(entityId),
    staleTime: 60_000,
  });

  const suppliers = useMemo<SupplierInfo[]>(
    () => (suppliersQ.data?.items ?? []).map((s) => ({ id: s.id, name: s.legalName ?? s.name, msme: s.msme ? s.msme === "micro" || s.msme === "small" : Boolean(s.msmeFlag), category: s.msme })),
    [suppliersQ.data],
  );

  const payables = useMemo(
    () => (invoicesQ.data && paymentsQ.data ? buildPayables(invoicesQ.data.items, paymentsQ.data.items, suppliers) : null),
    [invoicesQ.data, paymentsQ.data, suppliers],
  );

  const fys = useMemo(() => {
    const set = new Set((invoicesQ.data?.items ?? []).map((d) => d.fy ?? fyOfDate(d.date)));
    return [...set].sort().reverse();
  }, [invoicesQ.data]);
  const [fy, setFy] = useState<string>("");
  const [report, setReport] = useState("ageing");
  const spend = useMemo(() => (invoicesQ.data ? buildSpend(invoicesQ.data.items, suppliers, fy) : null), [invoicesQ.data, suppliers, fy]);
  const findings = useMemo(() => (findingsQ.data ? buildFindings(findingsQ.data.items) : null), [findingsQ.data]);

  const payablesLoading = invoicesQ.isLoading || paymentsQ.isLoading || suppliersQ.isLoading;
  const payablesError = invoicesQ.error ?? paymentsQ.error;
  const retryPayables = () => { void invoicesQ.refetch(); void paymentsQ.refetch(); void suppliersQ.refetch(); };

  /* ---------- CSV exports ---------- */
  const exportAgeing = () => {
    if (!payables) return;
    downloadCsv(`payables-ageing-${fileTag}.csv`,
      ["Supplier", "Invoice", "Invoice date", "Days since invoice", "Bucket", "MSME", "Invoice total (INR)", "Paid (INR)", "Outstanding (INR)"],
      payables.open.map((o) => [o.supplier, o.number, o.date, o.days, o.bucket === "future" ? "Future-dated" : o.bucket, o.msme ? "Yes" : "No", paiseToDecimal(o.total), paiseToDecimal(o.paid), paiseToDecimal(o.outstanding)]));
  };
  const exportSpend = () => {
    if (!spend) return;
    downloadCsv(`spend-by-supplier-${fy || "all-years"}-${fileTag}.csv`,
      ["Rank", "Supplier", "MSME", "Invoices", "Invoiced (INR)", "Share of total (%)"],
      [...spend.top, ...spend.others].map((g, i) => [i + 1, g.name, g.msme ? "Yes" : "No", g.count, paiseToDecimal(g.amount), pctOf(g.amount, spend.grand)]));
  };
  const exportFindings = () => {
    if (!findings) return;
    downloadCsv(`open-findings-${fileTag}.csv`,
      ["Issue", "Code", ...SEVERITIES.map((s) => s[0].toUpperCase() + s.slice(1)), "Total", "Amount involved (INR)"],
      findings.rows.map((r) => [findingLabel(r.code, findingTypeLabel(r.code)), r.code, ...SEVERITIES.map((s) => r.counts[s] ?? 0), r.total, paiseToDecimal(r.exposure)]));
  };

  if (mocks) {
    return (
      <FadeIn className="space-y-5">
        <PageHeader title="Reports" description="How old your unpaid bills are, who you spend the most with, and open issues — each table exports to CSV for your CA." />
        <EmptyState icon={FileBarChart} title="Reports need the live server" body="Demo mode has no ledger to report on. Connect to a Satya server to see ageing, spend and findings." />
      </FadeIn>
    );
  }

  const maxSpend = spend?.top[0]?.amount ?? ZERO;

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Reports"
        description={<>Ready-made views for {activeEntity?.legalName ?? "your company"} as of <DateText value={asOf} />. Every figure comes from recorded documents, and each report exports to CSV for your CA.</>}
      />

      <Tabs value={report} onValueChange={setReport}>
        <TabsList className={pageTabsList}>
          <TabsTrigger value="ageing" className={pageTabsTrigger}>Unpaid bills by age</TabsTrigger>
          <TabsTrigger value="spend" className={pageTabsTrigger}>Spend by supplier</TabsTrigger>
          <TabsTrigger value="findings" className={pageTabsTrigger}>Open issues by type</TabsTrigger>
        </TabsList>
        <TabsContent value="ageing" className="mt-6">

      {/* ---------- payables ageing ---------- */}
      <Card pad={false} className="overflow-hidden">
        <SectionHead
          icon={Clock3}
          title="Unpaid bills by age"
          hint="How long supplier bills have been unpaid, counted from the bill date. Micro and small (MSME) suppliers must be paid within 45 days — older MSME amounts are shown in red."
          onExport={exportAgeing}
          disabled={!payables?.open.length}
        />
        {payablesError ? (
          <div className="px-5 pb-5"><ErrorState message={errMsg(payablesError)} onRetry={retryPayables} /></div>
        ) : payablesLoading || !payables ? (
          <SectionSkeleton rows={5} />
        ) : payables.open.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState icon={BadgeCheck} title="Nothing unpaid" body="Every recorded supplier invoice is fully covered by allocated payments." /></div>
        ) : (
          <>
            <div className="table-scroll border-t border-[var(--line)]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/60">
                    <th scope="col" className={cn(th, "text-left")}>Age</th>
                    <th scope="col" className={cn(th, "text-right")}>Invoices</th>
                    <th scope="col" className={cn(th, "text-right")}>Outstanding</th>
                    <th scope="col" className={cn(th, "text-right")}>Of which MSME</th>
                    <th scope="col" className={cn(th, "w-[28%] text-left")}><span className="sr-only">Share</span></th>
                  </tr>
                </thead>
                <tbody>
                  {payables.rows.map((r) => {
                    const msmeLate = (r.key === "46-60" || r.key === "60+") && r.msmeCount > 0;
                    return (
                      <tr key={r.key} className="border-b border-[var(--line)] last:border-0" style={msmeLate ? { boxShadow: "inset 3px 0 0 var(--sev-high)" } : undefined}>
                        <th scope="row" className={cn(td, "text-left font-medium text-[var(--ink)]")}>{r.label}</th>
                        <td className={cn(td, "tnum text-right")}>{r.count}</td>
                        <td className={cn(td, "text-right font-medium text-[var(--ink)]")}><Money value={paiseToDecimal(r.amount)} /></td>
                        <td className={cn(td, "text-right")}>
                          {r.msmeCount ? (
                            <span className={cn("inline-flex flex-col items-end", msmeLate && "text-[var(--sev-high)]")}>
                              <Money value={paiseToDecimal(r.msmeAmount)} className="font-medium" />
                              <span className="inline-flex items-center gap-1 text-[13px]">
                                {msmeLate ? <TriangleAlert size={12} aria-hidden="true" /> : null}
                                <span className="tnum">{r.msmeCount}</span> invoice{r.msmeCount === 1 ? "" : "s"}{msmeLate ? " · past 45 days" : ""}
                              </span>
                            </span>
                          ) : <span className="text-[var(--muted)]">—</span>}
                        </td>
                        <td className={td}>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]" aria-hidden="true">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(r.amount > ZERO ? 2 : 0, pctOf(r.amount, payables.total))}%`, background: r.key === "60+" || r.key === "46-60" ? "var(--sev-high)" : "var(--accent)" }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--line-strong)] bg-[var(--surface-2)]/40">
                    <th scope="row" className={cn(td, "text-left font-semibold text-[var(--ink)]")}>Total unpaid</th>
                    <td className={cn(td, "tnum text-right font-semibold text-[var(--ink)]")}>{payables.rows.reduce((s, r) => s + r.count, 0)}</td>
                    <td className={cn(td, "text-right font-semibold text-[var(--ink)]")}><Money value={paiseToDecimal(payables.rows.reduce((s, r) => s + r.amount, ZERO))} /></td>
                    <td className={cn(td, "text-right font-semibold text-[var(--ink)]")}><Money value={paiseToDecimal(payables.rows.reduce((s, r) => s + r.msmeAmount, ZERO))} /></td>
                    <td className={td} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="space-y-1.5 border-t border-[var(--line)] px-5 py-3 text-[14px] text-[var(--muted)]">
              {payables.future.count ? (
                <p className="flex items-start gap-1.5"><Info size={13} className="mt-px shrink-0" aria-hidden="true" />
                  <span><span className="tnum">{payables.future.count}</span> unpaid invoice{payables.future.count === 1 ? " is" : "s are"} dated after today (<Money value={paiseToDecimal(payables.future.amount)} />) — not aged above; check the invoice dates.</span>
                </p>
              ) : null}
              {payables.missingAmount ? (
                <p className="flex items-start gap-1.5"><Info size={13} className="mt-px shrink-0" aria-hidden="true" />
                  <span><span className="tnum">{payables.missingAmount}</span> invoice{payables.missingAmount === 1 ? " has" : "s have"} no recorded total and {payables.missingAmount === 1 ? "is" : "are"} left out.</span>
                </p>
              ) : null}
              {invoicesQ.data?.truncated || paymentsQ.data?.truncated ? (
                <p className="flex items-start gap-1.5 text-[var(--sev-medium)]"><TriangleAlert size={13} className="mt-px shrink-0" aria-hidden="true" />
                  <span>Only the first {invoicesQ.data?.items.length} of {invoicesQ.data?.total} invoices were loaded — totals may be understated.</span>
                </p>
              ) : null}
              <p>Credit notes are not netted here. <Link href="/app/compliance" className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">MSME deadlines per invoice →</Link></p>
            </div>
          </>
        )}
      </Card>

        </TabsContent>
        <TabsContent value="spend" className="mt-6">
      <Card pad={false} className="overflow-hidden">
        <SectionHead icon={BarChart3} title="Spend by supplier" hint="Top 10 suppliers by purchase invoice value (including GST)." onExport={exportSpend} disabled={!spend?.top.length} />
        {fys.length > 1 ? (
          <div className="flex items-center gap-2 px-5 pb-4">
            <label htmlFor="spend-fy" className="text-[14px] font-medium text-[var(--ink-2)]">Financial year</label>
            <select id="spend-fy" value={fy} onChange={(e) => setFy(e.target.value)} className="h-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--ink)] outline-none focus:border-[var(--accent)]">
              <option value="">All years</option>
              {fys.map((y) => <option key={y} value={y}>FY {y}</option>)}
            </select>
          </div>
        ) : null}
        {invoicesQ.error ? (
          <div className="px-5 pb-5"><ErrorState message={errMsg(invoicesQ.error)} onRetry={() => invoicesQ.refetch()} /></div>
        ) : invoicesQ.isLoading || !spend ? (
          <SectionSkeleton rows={6} />
        ) : spend.top.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState icon={BarChart3} title={fy ? `No purchase invoices in FY ${fy}` : "No purchase invoices yet"} body="Spend appears here once supplier invoices are uploaded and confirmed." /></div>
        ) : (
          <>
            <ol className="border-t border-[var(--line)]">
              {spend.top.map((g, i) => (
                <li key={g.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-[var(--line)] px-5 py-3 last:border-0 sm:grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)_auto]">
                  <span className="tnum text-[13px] text-[var(--muted)]">{i + 1}</span>
                  <span className="min-w-0">
                    {g.supplierId ? (
                      <Link href={`/app/suppliers/${g.supplierId}`} className="line-clamp-2 break-words text-[15px] font-medium text-[var(--ink)] hover:underline">{g.name}</Link>
                    ) : <span className="line-clamp-2 break-words text-[15px] font-medium text-[var(--ink)]">{g.name}</span>}
                    <span className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
                      <span><span className="tnum">{g.count}</span> invoice{g.count === 1 ? "" : "s"}</span>
                      {g.msme ? <span className="inline-flex items-center gap-1 font-medium text-[var(--likely)]"><BadgeCheck size={12} aria-hidden="true" /> MSME</span> : null}
                    </span>
                  </span>
                  <span className="col-span-3 col-start-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1" aria-hidden="true">
                    <span className="block h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(2, pctOf(g.amount, maxSpend))}%` }} />
                    </span>
                  </span>
                  <span className="text-right">
                    <Money value={paiseToDecimal(g.amount)} className="block text-[15px] font-semibold text-[var(--ink)]" />
                    <span className="tnum block text-[13px] text-[var(--muted)]">{pctOf(g.amount, spend.grand)}% of total</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--surface-2)]/40 px-5 py-3 text-[15px]">
              <span className="text-[var(--muted)]">
                {spend.others.length ? <><span className="tnum">{spend.others.length}</span> more supplier{spend.others.length === 1 ? "" : "s"} in the CSV · </> : null}
                <span className="tnum">{spend.supplierCount}</span> supplier{spend.supplierCount === 1 ? "" : "s"} in total
              </span>
              <span className="font-semibold text-[var(--ink)]">Total <Money value={paiseToDecimal(spend.grand)} /></span>
            </div>
          </>
        )}
      </Card>

        </TabsContent>
        <TabsContent value="findings" className="mt-6">
      <Card pad={false} className="overflow-hidden">
        <SectionHead icon={ListChecks} title="Open issues by type" hint="Every open issue Satya’s checks have raised, grouped by what went wrong and how serious it is." onExport={exportFindings} disabled={!findings?.rows.length} />
        {findingsQ.error ? (
          <div className="px-5 pb-5"><ErrorState message={errMsg(findingsQ.error)} onRetry={() => findingsQ.refetch()} /></div>
        ) : findingsQ.isLoading || !findings ? (
          <SectionSkeleton rows={6} />
        ) : findings.rows.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState icon={BadgeCheck} title="No open findings" body="Nothing needs attention right now. New issues appear here as documents arrive and checks run." /></div>
        ) : (
          <>
            <div className="table-scroll border-t border-[var(--line)]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/60">
                    <th scope="col" className={cn(th, "text-left")}>Issue</th>
                    {SEVERITIES.map((s) => (
                      <th key={s} scope="col" className={cn(th, "text-right normal-case tracking-normal")}><span className="inline-flex justify-end"><SeverityBadge severity={s} /></span></th>
                    ))}
                    <th scope="col" className={cn(th, "text-right")}>Total</th>
                    <th scope="col" className={cn(th, "text-right")}>Amount involved</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.rows.map((r) => (
                    <tr key={r.code} className="border-b border-[var(--line)] last:border-0">
                      <th scope="row" className={cn(td, "text-left font-medium text-[var(--ink)]")}>
                        {findingLabel(r.code, findingTypeLabel(r.code))}
                      </th>
                      {SEVERITIES.map((s) => (
                        <td key={s} className={cn(td, "tnum text-right", !r.counts[s] && "text-[var(--muted)]")}>{r.counts[s] ?? "—"}</td>
                      ))}
                      <td className={cn(td, "tnum text-right font-semibold text-[var(--ink)]")}>{r.total}</td>
                      <td className={cn(td, "text-right")}>{r.exposure > ZERO ? <Money value={paiseToDecimal(r.exposure)} /> : <span className="text-[var(--muted)]">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--line-strong)] bg-[var(--surface-2)]/40">
                    <th scope="row" className={cn(td, "text-left font-semibold text-[var(--ink)]")}>All types</th>
                    {SEVERITIES.map((s) => <td key={s} className={cn(td, "tnum text-right font-semibold text-[var(--ink)]")}>{findings.bySeverity[s] ?? 0}</td>)}
                    <td className={cn(td, "tnum text-right font-semibold text-[var(--ink)]")}>{findings.rows.reduce((s, r) => s + r.total, 0)}</td>
                    <td className={cn(td, "text-right font-semibold text-[var(--ink)]")}><Money value={paiseToDecimal(findings.exposure)} /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3 text-[14px] text-[var(--muted)]">
              {findingsQ.data && findingsQ.data.items.length < findingsQ.data.total ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--sev-medium)]"><TriangleAlert size={13} aria-hidden="true" /> Showing the newest {findingsQ.data.items.length} of {findingsQ.data.total} open issues.</span>
              ) : <span>Amount involved is only counted where an issue states one.</span>}
              <Link href="/app/investigations" className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Work through them in To review →</Link>
            </div>
          </>
        )}
      </Card>
        </TabsContent>
      </Tabs>
    </FadeIn>
  );
}
