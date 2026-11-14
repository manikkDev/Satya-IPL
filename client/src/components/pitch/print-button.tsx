"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--on-accent)] hover:bg-[var(--accent-strong)] print:hidden"
    >
      <Printer size={14} aria-hidden="true" /> {label}
    </button>
  );
}
