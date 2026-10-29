"use client";

// Supplier 360 (/app/suppliers/[id]) — docs/plan/06 §5.8.

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, Landmark, MapPin, ReceiptText, ShieldCheck } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { Money, ErrorState, FadeIn, Card, CardTitle, Term } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

function Field({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-sm text-[var(--ink)] ${mono ? "font-code" : ""}`}>{value ?? "—"}</p>
    </div>
  );
}

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
              {(supplier.tags ?? []).length ? `Category: ${supplier.tags!.join(", ")}` : "Supplier"} ·
              Payment terms: {supplier.paymentTermsDays ?? "—"} days
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Open value", supplier.openValue ? <Money key="a" value={supplier.openValue} /> : "—"],
            ["Overdue MSME", supplier.overdue ? <Money key="b" value={supplier.overdue} /> : "—"],
            ["Open issues", supplier.issueCount ? <span key="c" className="text-[var(--sev-high)]">{supplier.issueCount}</span> : "None"],
            ["Payment terms", `${supplier.paymentTermsDays ?? "—"} days`],
          ].map(([label, value], i) => (
            <div key={i} className="rounded-[var(--radius-sm)] bg-[var(--surface-2)]/60 p-3.5">
              <p className="text-[11px] text-[var(--muted)]">{label}</p>
              <p className="tnum mt-1.5 text-lg font-semibold tracking-tight text-[var(--ink)]">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* registration & tax */}
        <Card>
          <CardTitle icon={ReceiptText}>Registration & tax</CardTitle>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="PAN" value={supplier.pan} mono />
            <Field
              label="Udyam registration"
              value={supplier.udyam ? `${supplier.udyam.number} (${supplier.udyam.category})` : "—"}
              mono
            />
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">GST registrations</p>
            {(supplier.gstins ?? []).map((g) => (
              <div key={g.gstin} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
                <span className="font-code text-xs text-[var(--ink)]">{g.gstin}</span>
                <span className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                  state {g.stateCode}
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">{g.status || "active"}</span>
                </span>
              </div>
            ))}
            {!(supplier.gstins ?? []).length && <p className="text-xs text-[var(--muted)]">No GSTIN on file.</p>}
          </div>
        </Card>

        {/* bank accounts */}
        <Card>
          <CardTitle icon={Landmark}>Bank accounts</CardTitle>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
            Account changes need a second person to approve before use.
          </p>
          <div className="mt-4 space-y-2">
            {(supplier.bankAccounts ?? []).map((acct, i) => (
              <div key={i} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
                <div>
                  <p className="font-code text-xs font-medium text-[var(--ink)]">{acct.masked || "••••"}</p>
                  <p className="font-code mt-0.5 text-[11px] text-[var(--muted)]">IFSC {acct.ifsc || "—"}</p>
                </div>
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">
                  {acct.status === "active" ? "Verified" : acct.status || "active"}
                </span>
              </div>
            ))}
            {!(supplier.bankAccounts ?? []).length && (
              <p className="text-xs text-[var(--muted)]">No bank account on file — add one before paying this supplier.</p>
            )}
          </div>
        </Card>

        {/* addresses */}
        <Card>
          <CardTitle icon={MapPin}>Addresses</CardTitle>
          <div className="mt-4 space-y-2">
            {(supplier.addresses ?? []).map((addr, i) => (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{addr.label || `Address ${i + 1}`}</p>
                <p className="mt-1 text-sm text-[var(--ink)]">{[addr.line1, addr.city, addr.pin].filter(Boolean).join(", ")}</p>
                {addr.stateCode && <p className="mt-0.5 text-[11px] text-[var(--muted)]">GST state code {addr.stateCode}</p>}
              </div>
            ))}
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
    </FadeIn>
  );
}
