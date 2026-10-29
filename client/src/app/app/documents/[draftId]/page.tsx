"use client";

// Document review (/app/documents/[draftId]) — docs/plan/06 §5.5. Split view:
// preview left, extracted fields with confidence chips right. Human confirms
// before anything becomes evidence — "Save as evidence" stays disabled until
// required fields are filled.

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, ShieldCheck, TriangleAlert } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { ErrorState, FadeIn, Card } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CONFIDENCE = {
  high: { label: "High", classes: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]" },
  check: { label: "Check", classes: "bg-[var(--possible-soft)] text-[var(--possible)]" },
  low: { label: "Low", classes: "bg-[var(--sev-critical-soft)] text-[var(--sev-critical)]" },
} as const;

export default function DraftReviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["draft", draftId], queryFn: () => v2.draft(draftId) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const saveAsEvidence = async () => {
    if (!data) return;
    setSaving(true);
    try {
      if (mocksEnabled()) {
        setConfirmed("doc_mock_confirmed");
        return;
      }
      const changed: Record<string, string> = {};
      for (const [name, value] of Object.entries(values)) {
        const original = data.fields.flatMap((g) => g.items).find((item) => item.name === name);
        if (original && value !== original.value) changed[name] = value;
      }
      if (Object.keys(changed).length) await v2.patchIngestDraft(draftId, { fields: changed });
      const result = await v2.confirmIngestDraft(draftId);
      setConfirmed(result.documentId);
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not save as evidence");
    } finally {
      setSaving(false);
    }
  };

  const checkFields = useMemo(() => {
    if (!data) return [];
    return data.fields.flatMap((group) => group.items).filter((item) => item.confidence !== "high");
  }, [data]);

  const ready = useMemo(() => {
    if (!data) return false;
    return data.fields
      .flatMap((group) => group.items)
      .every((item) => (values[item.name] ?? item.value).trim().length > 0);
  }, [data, values]);

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Draft not found."} onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-96 w-full" /></div>;

  const { draft, fields, lines, issues, suggestions } = data;

  return (
    <FadeIn className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={15} /> Back
        </button>
        <div>
          <h1 className="text-lg font-semibold text-[var(--ink)]">{draft.filename}</h1>
          <p className="text-xs text-[var(--muted)]">
            {draft.detectedType?.replaceAll("_", " ").toLowerCase()} · read by {draft.method === "einvoice_qr" ? "verified e-invoice QR" : draft.method === "vision_llm" ? "AI" : "text extraction"}
          </p>
        </div>
      </div>

      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--possible)]/40 bg-[var(--possible-soft)] px-3 py-2 text-xs text-[var(--ink-2)]">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--possible)]" aria-hidden="true" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* preview */}
        <Card pad={false} className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Document preview</h2>
          <div className="mt-3 flex h-[480px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--muted)]">
            <div className="text-center">
              <FileText size={36} className="mx-auto" aria-hidden="true" />
              <p className="mt-2 text-xs">Page preview renders when files API lands.</p>
              {highlight ? (
                <p className="mx-auto mt-3 max-w-xs rounded bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-strong)]">
                  “{highlight}”
                </p>
              ) : null}
            </div>
          </div>
        </Card>

        {/* extracted fields */}
        <div className="space-y-4">
          {fields.map((group) => (
            <section key={group.group} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{group.group}</h2>
              <div className="mt-3 space-y-3">
                {group.items.map((item) => {
                  const conf = CONFIDENCE[item.confidence];
                  return (
                    <div key={item.name}>
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor={item.name} className="text-xs text-[var(--muted)]">{item.label}</label>
                        <button
                          type="button"
                          title={item.source}
                          onClick={() => item.quote && setHighlight(item.quote)}
                          className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", conf.classes)}
                        >
                          {conf.label}
                        </button>
                      </div>
                      <input
                        id={item.name}
                        value={values[item.name] ?? item.value}
                        onChange={(event) => setValues((prev) => ({ ...prev, [item.name]: event.target.value }))}
                        onFocus={() => item.quote && setHighlight(item.quote)}
                        className={cn(
                          "mt-1 h-9 w-full rounded-[var(--radius-sm)] border bg-[var(--surface-2)]/50 px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:bg-[var(--surface)]",
                          item.confidence === "high" ? "border-[var(--line)] focus:border-[var(--accent)]" : "border-[var(--possible)] focus:border-[var(--accent)]",
                        )}
                      />
                      <p className="mt-0.5 text-[10px] text-[var(--muted)]">{item.source}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {lines.length > 0 && (
            <section className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Lines</h2>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--muted)]">
                    <th className="py-1">#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.lineNo} className="border-t border-[var(--line)] text-[var(--ink-2)]">
                      <td className="py-1.5">{line.lineNo}</td>
                      <td>{line.description}</td>
                      <td className="tnum">{line.qty}</td>
                      <td className="tnum">{line.rate}</td>
                      <td className="tnum">{line.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {(suggestions.supplier || suggestions.po) && (
            <section className="rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--accent-soft)]/50 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Suggested links — confirm or change</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.supplier && <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--surface)] px-3 py-1 text-xs text-[var(--ink-2)]">Supplier: {suggestions.supplier}</span>}
                {suggestions.po && <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--surface)] px-3 py-1 text-xs text-[var(--ink-2)]">Order: {suggestions.po}</span>}
              </div>
            </section>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">
              {checkFields.length ? `${checkFields.length} field${checkFields.length === 1 ? "" : "s"} to check — they are marked “Check”/` : "All fields look confirmed."}
              {checkFields.length ? <span className="text-[var(--possible)]">Low</span> : null}
            </p>
            {confirmed ? (
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--confirmed)]/30 bg-[var(--confirmed-soft)] px-4 py-2 text-sm font-medium text-[var(--confirmed)]">
                <ShieldCheck size={15} aria-hidden="true" /> Saved as evidence{confirmed.startsWith("doc_mock") ? " (mock)" : ""}
              </span>
            ) : (
              <button
                type="button"
                disabled={!ready || saving}
                onClick={saveAsEvidence}
                title={ready ? "Save this document as evidence" : "Fill every field first"}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck size={15} aria-hidden="true" /> {saving ? "Saving…" : "Save as evidence"}
              </button>
            )}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
