"use client";

// Orders (/app/orders) — "How far has each purchase order got?" One row per
// PO with delivered / billed / paid progress; billing that runs ahead of
// delivery is flagged in the Billed column. Status chips carry counts.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Upload, ShoppingCart, ListChecks, MessageSquare } from "lucide-react";
import { Pager } from "@/components/pages/shared/pager";
import { v2 } from "@/lib/api/v2";
import type { OrderListRow } from "@/lib/mocks/data";
import { Money, DateText, StatusBadge, ErrorState, EmptyState, PageHeader, FadeIn, BtnLink, FilterChips, ResponsiveTable, RowActions, TableSkeleton, type Column } from "@/components/ui/v2";
import { SearchField, ListToolbar } from "@/components/pages/shared/search-field";
import { ProgressStack } from "@/components/pages/shared/progress-meter";

const PAGE_SIZE = 20;

type FilterKey = "all" | "issues" | "issued" | "partially_fulfilled" | "fulfilled" | "pending_approval" | "draft";
// Rare statuses (acknowledged, short-closed) stay reachable through search
// and "All" — five chips read at a glance, nine don't.
const FILTERS: { value: FilterKey; label: string; tone?: "warn" | "critical"; always?: boolean }[] = [
  { value: "all", label: "All", always: true },
  { value: "issues", label: "Has issues", tone: "warn", always: true },
  { value: "pending_approval", label: "Waiting for approval", tone: "warn" },
  { value: "issued", label: "Awaiting delivery", always: true },
  { value: "partially_fulfilled", label: "Part delivered", always: true },
  { value: "fulfilled", label: "Fully delivered", always: true },
  { value: "draft", label: "Drafts" },
];

const SORTS = [
  ["attention", "Needs attention first"], ["newest", "Newest first"], ["oldest", "Oldest first"], ["value", "Highest value"],
] as const;

const filterParams = (f: FilterKey): Record<string, string> =>
  f === "all" ? {} : f === "issues" ? { hasIssues: "1" } : { status: f };

type Row = OrderListRow & { caseId?: string | null };

export default function OrdersPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<string>("attention");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [filter, debounced, sort]);

  const params = useMemo(() => ({
    limit: String(PAGE_SIZE), cursor: String((page - 1) * PAGE_SIZE), sort,
    ...filterParams(filter), ...(debounced ? { q: debounced } : {}),
  }), [page, sort, filter, debounced]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["orders", params],
    queryFn: () => v2.orders(params),
    placeholderData: (prev) => prev,
  });
  const counts = useQuery({
    queryKey: ["orders-counts", debounced],
    queryFn: async () => {
      const entries = await Promise.all(
        FILTERS.map(async (f) => {
          const res = await v2.orders({ limit: "1", ...filterParams(f.value), ...(debounced ? { q: debounced } : {}) });
          return [f.value, res.total ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<FilterKey, number>;
    },
    staleTime: 30_000,
  });

  const rows = (data?.items ?? []) as Row[];
  const total = data?.total ?? 0;
  const filtered = !!debounced || filter !== "all";

  const columns: Column<Row>[] = [
    {
      key: "order", header: "Order", primary: true, className: "min-w-[230px]",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/app/orders/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-[var(--ink)] hover:underline">{r.supplier || "Supplier not set"}</Link>
          <p className="mt-0.5 truncate text-[13px] text-[var(--muted)] tnum">{r.number} · <DateText value={r.date} /></p>
        </div>
      ),
    },
    { key: "value", header: "Value", align: "right", cell: (r) => <Money value={r.value} className="whitespace-nowrap font-medium text-[var(--ink)]" /> },
    {
      key: "progress", header: "Progress",
      cell: (r) => (
        <ProgressStack
          rows={[
            { label: "Delivered", pct: r.deliveredPct },
            { label: "Billed", pct: r.invoicedPct, warn: Number(r.invoicedPct) > Number(r.deliveredPct) + 0.5 },
            { label: "Paid", pct: r.paidPct },
          ]}
        />
      ),
    },
    {
      key: "status", header: "Status",
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={r.status} />
          {r.issueCount ? (
            <span className="text-[13px] font-medium text-[var(--sev-high)] tnum">{r.issueCount} issue{r.issueCount === 1 ? "" : "s"}</span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="Orders"
        description="Every purchase order and how far it has got — delivered, billed and paid."
        actions={
          <>
            <BtnLink href="/app/imports" variant="secondary" icon={Upload}>Import</BtnLink>
            <BtnLink href="/app/orders/new" icon={Plus}>New purchase order</BtnLink>
          </>
        }
      />

      <ListToolbar
        search={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort orders"
              className="h-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--ink-2)] outline-none focus:border-[var(--accent)]"
            >
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <SearchField value={query} onChange={setQuery} placeholder="Search PO number or supplier" className="sm:w-64" />
          </div>
        }
      >
        <FilterChips
          label="Filter orders"
          value={filter}
          onChange={setFilter}
          options={FILTERS.filter((f) => f.always || f.value === filter || (counts.data?.[f.value] ?? 0) > 0).map((f) => ({
            value: f.value, label: f.label, count: counts.data?.[f.value], tone: f.tone,
          }))}
        />
      </ListToolbar>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={8} columns={8} />
      ) : rows.length ? (
        <div className={isFetching ? "space-y-3 opacity-70 transition-opacity" : "space-y-3 transition-opacity"}>
          <ResponsiveTable
            caption="Purchase orders"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            actions={(r) => (
              <RowActions
                label={`order ${r.number}`}
                primary={r.issueCount && r.caseId ? { label: "Review", href: `/app/investigations/${r.caseId}` } : { label: "Open", href: `/app/orders/${r.id}` }}
                items={[
                  { label: "Open the order", icon: ShoppingCart, href: `/app/orders/${r.id}` },
                  ...(r.caseId ? [{ label: "Open its check", icon: ListChecks, href: `/app/investigations/${r.caseId}` }] : []),
                  { label: "Ask Satya about it", icon: MessageSquare, href: `/app/ask?about=${encodeURIComponent(`PO ${r.number}`)}` },
                ]}
              />
            )}
          />
          <p className="text-[13px] text-[var(--muted)]">
            A <span className="font-medium text-[var(--sev-high)]">red Billed figure</span> means the supplier has billed for more than has been delivered.
          </p>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPage={setPage} noun={total === 1 ? "order" : "orders"} />
        </div>
      ) : (
        <EmptyState
          title={filtered ? "No orders match" : "No purchase orders yet"}
          body={filtered ? "Try a different search, or pick another filter above." : "Create a purchase order here — GST and HSN are worked out for you — or import your existing orders from Tally."}
          actionLabel={filtered ? undefined : "New purchase order"}
          actionHref={filtered ? undefined : "/app/orders/new"}
          secondaryLabel={filtered ? undefined : "Import from Tally"}
          secondaryHref={filtered ? undefined : "/app/imports"}
        />
      )}
    </FadeIn>
  );
}
