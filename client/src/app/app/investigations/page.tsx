"use client";

// To review (/app/investigations) — one row per order check. The question it
// answers: "Which orders have something that doesn't add up, and what should
// I do about each?" Status chips carry counts; the table keeps fixed columns
// (money right-aligned) and one visible action per row.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, MessageSquare, ShoppingCart } from "lucide-react";
import { Pager } from "@/components/pages/shared/pager";
import { v2 } from "@/lib/api/v2";
import { ErrorState, EmptyState, PageHeader, FadeIn, Money, SeverityBadge, StatusBadge, BtnLink, FilterChips, InfoPanel, ResponsiveTable, RowActions, TableSkeleton, type Column } from "@/components/ui/v2";
import type { Severity } from "@/lib/api/types";
import { toPaise } from "@/lib/format";
import { SearchField, ListToolbar } from "@/components/pages/shared/search-field";
import { splitCaseTitle } from "@/components/pages/shared/case-title";

type CaseRow = {
  id: string; title?: string; kind?: string; status: string; entityId?: string;
  subjectIds?: string[]; updatedAt?: string;
  reconciled?: boolean; lastReconciledAt?: string | null;
  findings?: number; topSeverity?: Severity | null;
  severity?: { critical?: number; high?: number; medium?: number; low?: number };
  openValue?: string | null; disputedValue?: string | null; recommendation?: string | null;
};

type StatusKey = "open" | "in_review" | "on_hold" | "resolved" | "all";
const STATUSES: { value: StatusKey; label: string; tone?: "warn" | "critical" }[] = [
  { value: "open", label: "Open", tone: "warn" },
  { value: "in_review", label: "In review" },
  { value: "on_hold", label: "On hold" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];
const PAGE_SIZE = 15;

const positive = (v?: string | null) => !!v && toPaise(v) > BigInt(0);

export default function InvestigationsPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<StatusKey>("open");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [debounced, status]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["cases", { q: debounced, status, page }],
    queryFn: () => v2.cases({ q: debounced, status: status === "all" ? "" : status, page: String(page), pageSize: String(PAGE_SIZE) }),
  });
  // Chip counts: one cheap count query per status (pageSize=1 → total).
  const counts = useQuery({
    queryKey: ["cases-counts", debounced],
    queryFn: async () => {
      const entries = await Promise.all(
        STATUSES.map(async (s) => {
          const res = (await v2.cases({ q: debounced, status: s.value === "all" ? "" : s.value, page: "1", pageSize: "1" })) as { total?: number };
          return [s.value, res.total ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<StatusKey, number>;
    },
    staleTime: 30_000,
  });

  const items = useMemo(() => (data?.items ?? []) as CaseRow[], [data]);
  const total = (data as { total?: number })?.total ?? items.length;
  const pages = (data as { pages?: number })?.pages ?? 1;
  const filtered = !!debounced || status !== "all";

  const columns: Column<CaseRow>[] = [
    {
      key: "check",
      header: "Order",
      primary: true,
      className: "min-w-[260px]",
      cell: (row) => {
        const { supplier, reference } = splitCaseTitle(row.title, row.id);
        return (
          <div className="min-w-0">
            <Link href={`/app/investigations/${row.id}`} className="block truncate font-semibold text-[var(--ink)] hover:underline" onClick={(e) => e.stopPropagation()}>
              {supplier}
            </Link>
            <p className="mt-0.5 truncate text-[13px] text-[var(--muted)] tnum">{reference}</p>
          </div>
        );
      },
    },
    {
      key: "issues",
      header: "Issues",
      cell: (row) =>
        !row.reconciled ? (
          <span className="inline-flex items-center gap-1.5 text-[14px] text-[var(--muted)]"><Clock3 size={14} aria-hidden="true" /> Not checked yet</span>
        ) : row.findings ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {row.topSeverity ? <SeverityBadge severity={row.topSeverity} /> : null}
            <span className="whitespace-nowrap text-[14px] text-[var(--ink-2)] tnum">{row.findings} issue{row.findings === 1 ? "" : "s"}</span>
          </span>
        ) : (
          <span className="text-[14px] text-[var(--confirmed)]">No issues</span>
        ),
    },
    {
      key: "disputed",
      header: "Under question",
      align: "right",
      cell: (row) => (positive(row.disputedValue) ? <Money value={row.disputedValue} className="font-medium text-[var(--ink)]" /> : <span className="text-[var(--muted)]">—</span>),
    },
    {
      key: "open",
      header: "Unpaid",
      align: "right",
      cell: (row) => (positive(row.openValue) ? <Money value={row.openValue} /> : <span className="text-[var(--muted)]">—</span>),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="To review"
        description="Orders where the order, delivery, bill and payment don’t agree — with Satya’s suggested next step for each."
        actions={<BtnLink href="/app/imports" variant="secondary">Import data</BtnLink>}
      />

      <InfoPanel title="How Satya checks an order" storageKey="investigations-how">
        <p>
          For every purchase order Satya lines up four records — the <strong>order</strong>, the <strong>goods received</strong>,
          the <strong>supplier’s bill</strong> and the <strong>payment</strong> — and flags anything that doesn’t agree: billing for
          more than arrived, a duplicate bill, a price change, a payment with no invoice.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          <li><span className="font-medium text-[var(--ink)]">Under question</span> — money tied to an issue. Don’t pay it until it is settled.</li>
          <li><span className="font-medium text-[var(--ink)]">Unpaid</span> — what your accounts say is still owed, issues included.</li>
          <li><span className="font-medium text-[var(--ink)]">Severity</span> — Critical and High can cost money; Medium and Low are housekeeping.</li>
        </ul>
      </InfoPanel>

      <ListToolbar
        search={<SearchField value={query} onChange={setQuery} placeholder="Search order number or supplier" />}
      >
        <FilterChips
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={STATUSES.map((s) => ({ value: s.value, label: s.label, count: counts.data?.[s.value], tone: s.tone }))}
        />
      </ListToolbar>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title={debounced ? "No orders match your search" : status === "open" ? "Nothing open — you’re all caught up" : filtered ? "Nothing here" : "Nothing to review yet"}
          body={
            debounced
              ? "Try a different order number or supplier name."
              : filtered
                ? "Pick another status above to see other checks."
                : "Satya creates a check for each purchase order. Once its delivery, bill or payment is recorded, anything that doesn’t add up appears here."
          }
          actionLabel={filtered ? undefined : "Go to Orders"}
          actionHref={filtered ? undefined : "/app/orders"}
          secondaryLabel={filtered ? undefined : "Import data"}
          secondaryHref={filtered ? undefined : "/app/imports"}
        />
      ) : (
        <div className="space-y-3">
          <ResponsiveTable
            caption="Order checks"
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            rowAccent={(r) => (r.topSeverity === "critical" ? "critical" : r.topSeverity === "high" ? "warn" : null)}
            actions={(row) => {
              const { supplier } = splitCaseTitle(row.title, row.id);
              const orderId = row.subjectIds?.find((s) => s.endsWith("_po")) ?? row.subjectIds?.[0];
              return (
                <RowActions
                  label={supplier}
                  primary={{
                    label: !row.reconciled ? "Run check" : row.findings ? "Review" : "Open",
                    href: `/app/investigations/${row.id}`,
                  }}
                  items={[
                    ...(orderId ? [{ label: "Open the order", icon: ShoppingCart, href: `/app/orders/${orderId}` }] : []),
                    { label: "Ask Satya about this", icon: MessageSquare, href: `/app/ask?about=${encodeURIComponent(supplier)}&case=${row.id}` },
                    { label: "Open in full", icon: ArrowUpRight, href: `/app/investigations/${row.id}` },
                  ]}
                />
              );
            }}
          />
          <Pager page={page} pages={pages} total={total} pageSize={PAGE_SIZE} onPage={setPage} noun={total === 1 ? "order" : "orders"} />
        </div>
      )}
    </FadeIn>
  );
}
