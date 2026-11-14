"use client";

// Inline document preview — renders B's /documents/:id/render-model as a
// letterhead-style page inside a modal. No PDF download required; the real
// PDF is one click away via the same model.

import { useEffect, useState } from "react";
import { X, FileDown } from "lucide-react";
import { v2, type RenderModel } from "@/lib/api/v2";
import { PoSheet } from "@/components/v2/po-sheet";
import { Skeleton } from "@/components/ui/skeleton";

export function DocPreviewModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [model, setModel] = useState<RenderModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    v2.renderModel(documentId)
      .then((m) => alive && setModel(m))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Preview failed"));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      alive = false;
      window.removeEventListener("keydown", esc);
    };
  }, [documentId, onClose]);

  const doc = model?.document;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Document preview">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow-3)]">
        {/* toolbar */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--ink)]">
              {doc ? `${doc.type} · ${doc.number ?? doc.externalRef ?? doc.id}` : "Loading preview…"}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!model) return;
              const { downloadDocumentPdf } = await import("@/components/v2/po-pdf");
              await downloadDocumentPdf(model);
            }}
            disabled={!model}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)]"
          >
            <FileDown size={13} /> Download PDF
          </button>
          <button type="button" onClick={onClose} aria-label="Close preview" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]">
            <X size={17} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && <p className="text-sm text-[var(--sev-critical)]">{error}</p>}
          {!model && !error && <Skeleton className="h-[560px] w-full" />}
          {model && <PoSheet model={model} />}
        </div>
      </div>
    </div>
  );
}
