"use client";

// Suppliers (/app/suppliers) — "Who do I buy from, and who needs a closer
// look?" Sorted by risk so the suppliers with open issues come first; the
// score is explained once in an info panel, not on every row.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Plus, MessageSquare, Upload } from "lucide-react";
import { workflow } from "@/lib/api/workflow";
import { RiskBadge } from "@/components/v2/risk-badge";
import { mocksEnabled } from "@/lib/flags";
import { v2 } from "@/lib/api/v2";
import type { SupplierRow } from "@/lib/api/v2";
import { ErrorState, EmptyState, PageHeader, FadeIn, BtnLink, FilterChips, InfoPanel, ResponsiveTable, RowActions, TableSkeleton, type Column } from "@/components/ui/v2";
import { SearchField, ListToolbar } from "@/components/pages/shared/search-field";

type FilterKey = "all" | "attention" | "msme" | "nogstin";
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

export default function SuppliersPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  const risks = useQuery({ queryKey: ["supplier-risks"], queryFn: workflow.supplierRisks, enabled: !mocksEnabled(), retry: 0 });
  const riskById = useMemo(() => new Map((risks.data?.items ?? []).map((r) => [r.supplierId, r])), [risks.data]);

  const all = useMemo(() => {
    const rows = [...(data?.items ?? [])];
    return rows.sort((a, b) => (riskById.get(b.id)?.score ?? -1) - (riskById.get(a.id)?.score ?? -1) || a.name.localeCompare(b.name));
  }, [data, riskById]);
  const matches = (s: SupplierRow, f: FilterKey) =>
    f === "all" ? true
      : f === "attention" ? ["high", "medium"].includes(riskById.get(s.id)?.band ?? "")
        : f === "msme" ? !!(s.msme || s.udyam?.category)
          : !s.gstin;
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((s) => !q || `${s.name} ${s.gstin}`.toLowerCase().includes(q));
  }, [all, query]);
  const items = searched.filter((s) => matches(s, filter));
  const count = (f: FilterKey) => searched.filter((s) => matches(s, f)).length;

  const columns: Column<SupplierRow>[] = [
    {
      key: "name", header: "Supplier", primary: true, className: "min-w-[240px]",
      cell: (s) => (
        <div className="min-w-0">
          <Link href={`/app/suppliers/${s.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-[var(--ink)] hover:underline">{s.name}</Link>
          <p className="mt-0.5 truncate text-[13px] tnum">
            {s.gstin ? <span className="text-[var(--muted)]">GSTIN {s.gstin}</span> : <span className="font-medium text-[var(--sev-high)]">GSTIN missing</span>}
          </p>
        </div>
      ),
    },
    {
      key: "msme", header: "MSME",
      cell: (s) => {
        const c = s.udyam?.category ?? s.msme;
        return c ? <span className="whitespace-nowrap text-[14px] text-[var(--ink-2)]">{cap(c)}</span> : <span className="text-[var(--muted)]">—</span>;
      },
    },
    { key: "terms", header: "Credit terms", cell: (s) => <span className="tnum whitespace-nowrap text-[14px]">{s.paymentTermsDays ? `${s.paymentTermsDays} days` : "—"}</span> },
    {
      key: "issues", header: "Open issues", align: "right",
      cell: (s) => {
        const r = riskById.get(s.id);
        if (!r) return <span className="text-[var(--muted)]">—</span>;
        return r.openIssues ? <span className="font-semibold text-[var(--sev-high)]">{r.openIssues}</span> : <span className="inline-flex items-center gap-1 text-[14px] text-[var(--confirmed)]"><CircleCheck size={14} aria-hidden="true" />None</span>;
      },
    },
    { key: "risk", header: "Risk", cell: (s) => <RiskBadge risk={riskById.get(s.id)} /> },
  ];

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Everyone you buy from — sorted so the ones with open issues come first."
        actions={<BtnLink href="/app/imports" variant="secondary" icon={Upload}>Import suppliers</BtnLink>}
      />

      <InfoPanel title="How the risk score works" storageKey="supplier-risk-how">
        <p>
          {risks.data?.note ?? "A prioritisation aid built from open issues and master-data checks — not a prediction."} Each supplier
          gets points for open issues on their orders (more for serious ones), possible duplicate bills or payments, and GST identity
          or tax-type problems. <strong>0–19</strong> is Low, <strong>20–49</strong> Medium, <strong>50+</strong> High. Open a supplier
          to see exactly which points add up to their score.
        </p>
      </InfoPanel>

      <ListToolbar search={<SearchField value={query} onChange={setQuery} placeholder="Search name or GSTIN" />}>
        <FilterChips
          label="Filter suppliers"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all" as const, label: "All", count: count("all") },
            { value: "attention" as const, label: "Needs a closer look", count: risks.data ? count("attention") : undefined, tone: "warn" as const },
            { value: "msme" as const, label: "MSME", count: count("msme") },
            ...(count("nogstin") || filter === "nogstin" ? [{ value: "nogstin" as const, label: "GSTIN missing", count: count("nogstin"), tone: "critical" as const }] : []),
          ]}
        />
      </ListToolbar>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title={query || filter !== "all" ? "No suppliers match" : "No suppliers yet"}
          body={query || filter !== "all" ? "Try a different name or GSTIN, or another filter." : "Suppliers are added automatically when you import Tally ledgers or confirm an invoice."}
          actionLabel={query || filter !== "all" ? undefined : "Import data"}
          actionHref={query || filter !== "all" ? undefined : "/app/imports"}
        />
      ) : (
        <ResponsiveTable
          caption="Suppliers"
          columns={columns}
          rows={items}
          rowKey={(s) => s.id}
          rowAccent={(s) => (riskById.get(s.id)?.band === "high" ? "critical" : null)}
          actions={(s) => (
            <RowActions
              label={s.name}
              primary={{ label: "Open", href: `/app/suppliers/${s.id}` }}
              items={[
                { label: "New purchase order", icon: Plus, href: "/app/orders/new" },
                { label: "Ask Satya about them", icon: MessageSquare, href: `/app/ask?about=${encodeURIComponent(s.name)}` },
              ]}
            />
          )}
        />
      )}
    </FadeIn>
  );
}
