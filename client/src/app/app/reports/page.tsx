"use client";

// Reports (/app/reports) — evidence packs and exports land in P3 (B9).
// Until then this page explains, in plain words, what will be exportable.

import { FileDown, Package } from "lucide-react";
import { EmptyState } from "@/components/ui/v2";

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">Reports</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Evidence packs and exports for your auditor — every figure inside traces back to a document.
        </p>
      </div>
      <EmptyState
        title="Evidence packs are on the way"
        body="Soon you will export a PDF/CSV bundle per investigation: the findings, the calculation steps, and the exact document fields behind every number. For now, open an investigation and use its Decisions & audit tab."
        actionLabel="Open investigations"
        onAction={() => (window.location.href = "/app/investigations")}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Package size={15} /> Evidence pack</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Findings + calculations + document excerpts for one order check — for auditors and internal review.</p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><FileDown size={15} /> Exports</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">CSV/JSON of orders, documents, findings and payments for your ERP or CA.</p>
        </div>
      </div>
    </div>
  );
}
