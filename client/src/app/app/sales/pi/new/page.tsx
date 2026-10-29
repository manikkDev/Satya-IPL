"use client";

// Outgoing proforma invoice (/app/sales/pi/new) — distribution entity only.
// Shares the PO wizard flow in a later pass; for now it explains the document
// and routes to the order wizard which covers the same steps.

import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";

export default function NewPiPage() {
  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <FileText size={19} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-[22px] font-semibold text-[var(--ink)]">New proforma invoice</h1>
          <p className="text-sm text-[var(--muted)]">For your distribution entity&apos;s customers — not a tax invoice.</p>
        </div>
      </div>
      <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 text-sm leading-relaxed text-[var(--ink-2)]">
        <p>
          A proforma invoice (PI) is a quote/advance-request document your sales side sends before the real tax
          invoice — customers use it to arrange advance payment or internal approval. It carries bank details and a
          validity date, and never an IRN.
        </p>
        <p className="mt-3 text-xs text-[var(--muted)]">
          The PI wizard shares the purchase-order stepper (buyer → items → terms → tax preview → issue) and lands with
          the seller-side document APIs.
        </p>
      </div>
      <Link href="/app/orders/new" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline">
        See the document wizard it will share <ArrowRight size={14} />
      </Link>
    </div>
  );
}
