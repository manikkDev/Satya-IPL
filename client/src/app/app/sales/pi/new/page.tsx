"use client";

// Outgoing proforma invoice (/app/sales/pi/new) — distribution entity only.
// Shares the PO wizard flow in a later pass; for now it explains the document
// and routes to the order wizard which covers the same steps.

import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";
import { FadeIn, Card } from "@/components/ui/v2";

export default function NewPiPage() {
  return (
    <FadeIn className="max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <FileText size={19} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">New proforma invoice</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">For your distribution entity&apos;s customers — not a tax invoice.</p>
        </div>
      </div>
      <Card className="text-sm leading-relaxed text-[var(--ink-2)]">
        <p>
          A proforma invoice (PI) is a quote/advance-request document your sales side sends before the real tax
          invoice — customers use it to arrange advance payment or internal approval. It carries bank details and a
          validity date, and never an IRN.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          The PI wizard shares the purchase-order stepper (buyer → items → terms → tax preview → issue) and lands with
          the seller-side document APIs.
        </p>
      </Card>
      <Link href="/app/orders/new" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-strong)] hover:underline">
        See the document wizard it will share <ArrowRight size={14} />
      </Link>
    </FadeIn>
  );
}
