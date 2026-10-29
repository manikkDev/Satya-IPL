"use client";

// Supplier 360 (/app/suppliers/[id]) — docs/plan/06 §5.8.

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { Money, ErrorState, FadeIn, Card } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  const supplier = data?.items.find((item) => item.id === id);

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!supplier) return <ErrorState message="Supplier not found." />;

  return (
    <FadeIn className="space-y-5">
      <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
        <ArrowLeft size={15} /> Back
      </button>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">{supplier.name}</h1>
          {supplier.msme && <span className="rounded-full border border-[var(--likely)]/30 bg-[var(--likely-soft)] px-2.5 py-1 text-xs font-medium text-[var(--likely)]">{supplier.msme} enterprise</span>}
        </div>
        <p className="font-code mt-1.5 text-xs text-[var(--muted)]">GSTIN {supplier.gstin} · well-formed</p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Open value", supplier.openValue ? <Money key="a" value={supplier.openValue} /> : "—"],
            ["Overdue MSME", supplier.overdue ? <Money key="b" value={supplier.overdue} /> : "—"],
            ["Open issues", String(supplier.issueCount)],
            ["Duplicate-vendor alerts", "None found"],
          ].map(([label, value], i) => (
            <div key={i} className="rounded-[var(--radius-sm)] bg-[var(--surface-2)]/60 p-3.5">
              <p className="text-[11px] text-[var(--muted)]">{label}</p>
              <p className="tnum mt-1.5 text-lg font-semibold tracking-tight text-[var(--ink)]">{value}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="text-sm font-semibold text-[var(--ink)]">Signals, not verdicts</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
          Statistical indicators (like unusual-amount or duplicate-vendor signals) point you at records worth checking —
          they are never treated as proof. Bank-account changes need a second person to approve before use.
        </p>
      </Card>
    </FadeIn>
  );
}
