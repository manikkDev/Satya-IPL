"use client";

// Document review (/app/documents/[draftId]) — docs/plan/06 §5.5. Split view:
// the real uploaded file on the left, extracted fields with confidence chips
// on the right. Nothing becomes evidence until a human confirms — when the
// extraction found nothing, the reviewer types the key fields by hand.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowUpRight, CircleAlert, Download, FileText, Loader2, PenLine,
  RefreshCw, ShieldCheck, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { ingestApi, resolveDocumentHref, parsePaise, paiseOf, paiseToDecimal, sumPaise, ZERO } from "@/lib/api/v2-pages";
import { DocumentView } from "@/components/pages/documents/document-view";
import { DOC_TYPE_LABEL } from "@/components/pages/documents/labels";
import type { DraftDetail } from "@/lib/mocks/data";
import { mocksEnabled } from "@/lib/flags";
import { DateText, ErrorState, FadeIn, Card, StatusBadge, Money } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { LinkBtn } from "@/components/pages/shared/link-btn";
import { cn } from "@/lib/utils";

const CONFIDENCE = {
  high: { label: "High", classes: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]" },
  check: { label: "Check", classes: "bg-[var(--possible-soft)] text-[var(--possible)]" },
  low: { label: "Low", classes: "bg-[var(--sev-critical-soft)] text-[var(--sev-critical)]" },
} as const;

const METHOD_LABEL: Record<string, string> = {
  einvoice_qr: "verified e-invoice QR",
  vision_llm: "AI vision",
  text_layer: "PDF text layer",
  csv: "CSV import",
  json: "JSON import",
  failed: "—",
};

/* Issue codes → what went wrong, why it matters, what to do. */
const ISSUE_GUIDE: Record<string, { title: string; detail: string; action?: string }> = {
  LLM_UNAVAILABLE: {
    title: "AI couldn't read this file",
    detail: "The visual read never ran — scans and photos need it, so the fields below may be missing or empty.",
    action: "Retry the AI read, or type the values yourself and save.",
  },
  NO_TEXT_LAYER: {
    title: "No selectable text in this file",
    detail: "It's a photo or a scan — only AI vision can read it.",
    action: "If the preview looks readable, retry the AI read.",
  },
  VALIDATE_SKIPPED: {
    title: "Automatic checks didn't run",
    detail: "The validation step was unavailable, so every value here is unverified — check each field against the document.",
  },
  EXTRACTION_FAILED: {
    title: "Reading failed",
    detail: "Satya couldn't read this file at all — it may be corrupt, password-protected, or an unsupported layout.",
    action: "Retry once; if it still fails, re-upload a clearer file.",
  },
  DUPLICATE_NUMBER: {
    title: "Possible duplicate",
    detail: "A document with this number already exists in your records — saving would create a second copy unless it's genuinely different.",
  },
  TAX_TYPE_MISMATCH: {
    title: "Tax type looks wrong",
    detail: "IGST vs CGST+SGST depends on the two parties' states — check the GSTINs before saving.",
  },
};

const issueGuide = (issue: { code?: string; message: string; severity: string }) => {
  const byCode = issue.code ? ISSUE_GUIDE[issue.code] : undefined;
  if (byCode) return byCode;
  if (/no text layer/i.test(issue.message)) return ISSUE_GUIDE.NO_TEXT_LAYER;
  return {
    title: issue.severity === "error" ? "Something needs attention" : "Heads up",
    detail: issue.message,
  };
};

/* Fields offered for manual entry when extraction found nothing. Posted back
   in the same {value} shape the confirm endpoint reads. */
const MANUAL_FIELDS = [
  { name: "sellerName", label: "Supplier / seller name", placeholder: "e.g. Bhavna Engineering Stores", required: true },
  { name: "number", label: "Invoice / document number", placeholder: "e.g. INV-041", required: true },
  { name: "date", label: "Document date", placeholder: "YYYY-MM-DD", required: true },
  { name: "totals", label: "Grand total (₹)", placeholder: "e.g. 70800.00", required: false },
] as const;

type FieldItem = DraftDetail["fields"][number]["items"][number];

/* ---------- file preview (streams via GET /api/v2/files/:id) ---------- */

function FilePreview({ fileId, fallbackName }: { fileId?: string; fallbackName: string }) {
  const [state, setState] = useState<{ url?: string; kind?: string; error?: boolean }>({});
  const metaQ = useQuery({
    queryKey: ["file-meta", fileId],
    queryFn: () => v2.fileMeta(fileId!),
    enabled: Boolean(fileId),
  });
  const meta = metaQ.data;

  useEffect(() => {
    setState({});
    if (!fileId || mocksEnabled()) {
      setState({ error: true });
      return;
    }
    let live = true;
    let objectUrl: string | null = null;
    v2.fileBlob(fileId)
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, kind: blob.type || meta?.mime || "" });
      })
      .catch(() => live && setState({ error: true }));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const filename = meta?.filename ?? fallbackName;
  const sub = [
    meta?.pages ? `${meta.pages} page${meta.pages === 1 ? "" : "s"}` : null,
    meta?.size ? `${(meta.size / 1024).toFixed(0)} KB` : null,
  ].filter(Boolean).join(" · ");

  if (state.error || !fileId) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-[var(--muted)]">
        <FileText size={36} aria-hidden="true" />
        <p className="mt-3 text-xs">Preview isn&apos;t available for this file.</p>
        <p className="mt-1 text-[11px]">{mocksEnabled() ? "Mock mode — no real file stored." : "Use the fields on the right and the filename below."}</p>
        <p className="mt-2 font-code text-[11px] text-[var(--ink-2)]">{filename}</p>
      </div>
    );
  }
  if (!state.url) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-[var(--muted)]">
        <Loader2 size={22} className="animate-spin text-[var(--accent)]" aria-hidden="true" />
        <p className="mt-3 text-xs">Loading {filename}…</p>
      </div>
    );
  }
  const kind = state.kind ?? "";
  if (kind === "application/pdf") {
    return <iframe src={state.url} title="Document preview" className="h-[560px] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-white" />;
  }
  if (kind.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={state.url} alt={`Preview of ${filename}`} className="max-h-[560px] w-full rounded-[var(--radius-sm)] bg-[var(--surface-2)] object-contain" />;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center text-[var(--muted)]">
      <FileText size={36} aria-hidden="true" />
      <p className="mt-3 max-w-xs text-center text-xs">
        No inline preview for this file type{sub ? ` (${sub})` : ""} — open it to check the fields.
      </p>
      <a
        href={state.url}
        download={filename}
        className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)]/45 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]"
      >
        <Download size={13} /> Open {filename}
      </a>
    </div>
  );
}

/* ---------- page ---------- */

export default function DocumentRoutePage() {
  const { draftId } = useParams<{ draftId: string }>();
  // /app/documents/doc_… is a posted document; anything else is an upload draft.
  if (draftId?.startsWith("doc_")) return <DocumentView id={draftId} />;
  return <DraftReview draftId={draftId} />;
}

function DraftReview({ draftId }: { draftId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["draft", draftId],
    queryFn: () => v2.draft(draftId),
    refetchInterval: (query) => {
      const status = query.state.data?.draft.status;
      return status && ["queued", "parsing", "extracting"].includes(status) ? 3000 : false;
    },
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setValues({});
    setHighlight(null);
    setConfirmed(null);
    setSaveError(null);
  }, [draftId]);

  const fileId = data?.draft.fileId;
  const fileMetaQ = useQuery({
    queryKey: ["file-meta", fileId],
    queryFn: () => v2.fileMeta(fileId!),
    enabled: Boolean(fileId),
  });
  const savedId = confirmed ?? data?.draft.confirmedDocumentId ?? null;
  const hrefQ = useQuery({
    queryKey: ["document-href", savedId],
    queryFn: () => resolveDocumentHref(savedId!),
    enabled: Boolean(savedId) && !savedId?.startsWith("doc_mock"),
  });

  const allItems = useMemo(() => (data?.fields ?? []).flatMap((g) => g.items), [data]);
  const hasFields = allItems.length > 0;
  const checkFields = useMemo(() => allItems.filter((item) => item.confidence !== "high"), [allItems]);

  const ready = useMemo(() => {
    if (hasFields) return allItems.every((item) => (values[item.name] ?? item.value).trim().length > 0);
    return MANUAL_FIELDS.filter((f) => f.required).every((f) => (values[f.name] ?? "").trim().length > 0);
  }, [hasFields, allItems, values]);

  // lines-vs-total cross-check — catches extraction mistakes the reviewer would miss
  const totalCheck = useMemo(() => {
    if (!data?.lines?.length) return null;
    const linesSum = sumPaise(data.lines.map((l) => paiseOf(l.amount)));
    if (linesSum === ZERO) return null;
    const grandItem = allItems.find((i) => /grand|total/i.test(i.name) && (parsePaise(i.value) ?? ZERO) !== ZERO);
    if (!grandItem) return null;
    const grand = parsePaise(grandItem.value) ?? ZERO;
    const diff = linesSum > grand ? linesSum - grand : grand - linesSum;
    // within ₹1 counts as a match (round-off)
    return { linesSum: paiseToDecimal(linesSum), grand: paiseToDecimal(grand), matches: diff < BigInt(100), diff: paiseToDecimal(diff) };
  }, [data, allItems]);

  const saveAsEvidence = async () => {
    if (!data) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (mocksEnabled()) {
        setConfirmed("doc_mock_confirmed");
        return;
      }
      const fieldsPayload: Record<string, { value: unknown; confidence: string; source: string }> = {};
      for (const [name, value] of Object.entries(values)) {
        if (!value.trim()) continue;
        const original = allItems.find((item) => item.name === name);
        if (original) {
          if (value !== original.value) fieldsPayload[name] = { value, confidence: "high", source: "Typed by reviewer" };
        } else if (name === "totals") {
          fieldsPayload.totals = { value: { grand: value }, confidence: "high", source: "Typed by reviewer" };
        } else {
          fieldsPayload[name] = { value, confidence: "high", source: "Typed by reviewer" };
        }
      }
      if (Object.keys(fieldsPayload).length) await v2.patchIngestDraft(draftId, { fields: fieldsPayload });
      const result = await v2.confirmIngestDraft(draftId);
      setConfirmed(result.documentId);
      toast.success("Saved as evidence");
      queryClient.invalidateQueries({ queryKey: ["ingest-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save as evidence");
    } finally {
      setSaving(false);
    }
  };

  const retryRead = async () => {
    const fileId = data?.draft.fileId;
    if (!fileId || mocksEnabled()) return;
    setRetrying(true);
    try {
      const result = await ingestApi.extract(fileId);
      queryClient.invalidateQueries({ queryKey: ["ingest-drafts"] });
      if (result.status === "failed") toast.error("Still couldn’t read it — type the fields in, or upload a clearer file.");
      if (result.draftId && result.draftId !== draftId) router.push(`/app/documents/${result.draftId}`);
      else refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Draft not found."} onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-96 w-full" /></div>;

  const { draft, fields, lines, issues, suggestions } = data;
  const typeLabel = (draft.detectedType && (DOC_TYPE_LABEL[draft.detectedType] ?? draft.detectedType.replaceAll("_", " ").toLowerCase())) ?? "document";
  const methodLabel = draft.method ? METHOD_LABEL[draft.method] ?? draft.method.replaceAll("_", " ") : "extraction";
  const canRetry = Boolean(draft.fileId) && !mocksEnabled() && (draft.status === "failed" || issues.some((i) => i.code === "LLM_UNAVAILABLE"));
  const confirmedDocId = savedId;
  const displayName = fileMetaQ.data?.filename ?? "This upload";

  /* ---------- still reading ---------- */
  if (["queued", "parsing", "extracting"].includes(draft.status)) {
    return (
      <FadeIn>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--accent-soft)]">
            <Loader2 size={22} className="animate-spin text-[var(--accent)]" />
          </div>
          <p className="mt-5 text-sm font-medium text-[var(--ink-2)]">
            {draft.status === "extracting" ? "AI is reading the document…" : "Reading this file…"}
          </p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--muted)]">
            Satya is pulling text and fields out of {displayName}. This page updates on its own when it finishes.
          </p>
        </div>
      </FadeIn>
    );
  }

  /* ---------- confirmed ---------- */
  if (draft.status === "confirmed" || confirmedDocId) {
    return (
      <FadeIn className="space-y-5">
        <Link href="/app/documents" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
          <ArrowLeft size={15} aria-hidden="true" /> Back to documents
        </Link>
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--confirmed-soft)]">
            <ShieldCheck size={22} className="text-[var(--confirmed)]" />
          </div>
          <p className="mt-4 text-[15px] font-medium text-[var(--ink)]">Saved as evidence</p>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--muted)]">
            {displayName} is now a posted {typeLabel}. It feeds orders, payments, findings and compliance like any
            other document — with this file kept as its source.
          </p>
          {confirmedDocId && !confirmedDocId.startsWith("doc_mock") ? (
            hrefQ.data ? (
              <LinkBtn href={hrefQ.data} variant="primary" size="md" icon={ArrowUpRight} className="mt-5">
                {hrefQ.data.startsWith("/app/orders/") ? "Open the order it belongs to" : hrefQ.data === "/app/payments" ? "Open payments" : "Open the document"}
              </LinkBtn>
            ) : hrefQ.isError ? (
              <LinkBtn href={`/app/documents/${confirmedDocId}`} variant="primary" size="md" icon={ArrowUpRight} className="mt-5">Open the document</LinkBtn>
            ) : (
              <span className="mt-5 inline-flex h-9 items-center gap-2 text-sm text-[var(--muted)]"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Finding where it belongs…</span>
            )
          ) : null}
        </Card>
      </FadeIn>
    );
  }

  /* ---------- failed ---------- */
  if (draft.status === "failed") {
    return (
      <FadeIn className="space-y-5">
        <Link href="/app/documents" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
          <ArrowLeft size={15} aria-hidden="true" /> Back to documents
        </Link>
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--sev-critical-soft)]">
            <CircleAlert size={22} className="text-[var(--sev-critical)]" />
          </div>
          <p className="mt-4 text-[15px] font-medium text-[var(--ink)]">Satya couldn&apos;t read this file</p>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--muted)]">
            {draft.issue ?? "The extraction failed — the file may be corrupt, password-protected, or too unclear to read."}
          </p>
          {canRetry ? (
            <button
              type="button"
              onClick={retryRead}
              disabled={retrying}
              className="mt-5 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
            >
              <RefreshCw size={14} className={retrying ? "animate-spin" : ""} /> {retrying ? "Retrying…" : "Retry the read"}
            </button>
          ) : null}
        </Card>
      </FadeIn>
    );
  }

  /* ---------- needs_review: split view ---------- */
  return (
    <FadeIn className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/app/documents" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
            <ArrowLeft size={15} aria-hidden="true" /> Documents
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-[var(--ink)]">{displayName}</h1>
              <StatusBadge status={draft.status} />
            </div>
            <p className="text-xs text-[var(--muted)]">
              {typeLabel} · read via {methodLabel}
              {draft.uploadedAt ? <> · uploaded <DateText value={draft.uploadedAt} withTime /></> : null}
            </p>
          </div>
        </div>
        {canRetry ? (
          <button
            type="button"
            onClick={retryRead}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)]/45 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            <RefreshCw size={13} className={retrying ? "animate-spin" : ""} /> {retrying ? "Retrying…" : "Retry AI read"}
          </button>
        ) : null}
      </div>

      {/* why this page exists */}
      <Card className="border-[var(--accent)]/30 bg-[var(--accent-soft)]/40 p-4">
        <p className="text-xs leading-relaxed text-[var(--ink-2)]">
          <span className="font-semibold text-[var(--ink)]">Check before it counts.</span> Satya read this file
          automatically — on the right is what it found. Correct anything wrong; only when you save does this become a
          document that feeds orders, payments, findings and tax.
        </p>
      </Card>

      {/* issues — what went wrong, why it matters, what to do */}
      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((issue, i) => {
            const guide = issueGuide(issue);
            const errorTone = issue.severity === "error";
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-[var(--radius-sm)] border px-4 py-3",
                  errorTone ? "border-[var(--sev-critical)]/40 bg-[var(--sev-critical-soft)]" : "border-[var(--possible)]/40 bg-[var(--possible-soft)]",
                )}
              >
                <TriangleAlert size={15} className={cn("mt-0.5 shrink-0", errorTone ? "text-[var(--sev-critical)]" : "text-[var(--possible)]")} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--ink)]">{guide.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-2)]">{guide.detail}</p>
                  {guide.action ? <p className="mt-1 text-xs text-[var(--muted)]">What to do: {guide.action}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* preview */}
        <Card pad={false} className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Document preview</h2>
          <div className="mt-3 min-h-[480px] rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-1">
            <FilePreview fileId={draft.fileId} fallbackName={displayName} />
          </div>
          {highlight ? (
            <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-strong)]">
              Found on the page: “{highlight}”
            </p>
          ) : null}
        </Card>

        {/* extracted fields */}
        <div className="space-y-4">
          {hasFields ? (
            fields.map((group) => (
              <section key={group.group} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{group.group}</h2>
                <div className="mt-3 space-y-3">
                  {group.items.map((item: FieldItem) => {
                    const conf = CONFIDENCE[item.confidence];
                    return (
                      <div key={item.name}>
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor={item.name} className="text-xs text-[var(--muted)]">{item.label}</label>
                          <button
                            type="button"
                            title={item.quote ? "Show where this was found" : item.source}
                            onClick={() => item.quote && setHighlight(item.quote)}
                            className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", conf.classes)}
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
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">{item.source}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            /* nothing extracted — let the reviewer key the essentials by hand */
            <section className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <PenLine size={13} aria-hidden="true" /> Type it in yourself
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                Nothing could be read automatically from this file. Fill the key fields from the document on the left —
                that&apos;s enough to save it as evidence.
              </p>
              <div className="mt-3 space-y-3">
                {MANUAL_FIELDS.map((f) => (
                  <div key={f.name}>
                    <label htmlFor={`manual-${f.name}`} className="text-xs text-[var(--muted)]">
                      {f.label}{f.required ? "" : " (optional)"}
                    </label>
                    <input
                      id={`manual-${f.name}`}
                      value={values[f.name] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(event) => setValues((prev) => ({ ...prev, [f.name]: event.target.value }))}
                      className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/50 px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--surface)]"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {lines.length > 0 && (
            <section className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Lines</h2>
              <div className="table-scroll mt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--muted)]">
                      <th scope="col" className="py-1.5 pr-2">#</th>
                      <th scope="col" className="py-1.5 pr-2">Description</th>
                      <th scope="col" className="py-1.5 pr-2 text-right">Qty</th>
                      <th scope="col" className="py-1.5 pr-2 text-right">Rate</th>
                      <th scope="col" className="py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.lineNo} className="border-t border-[var(--line)] text-[var(--ink-2)]">
                        <td className="tnum py-1.5 pr-2">{line.lineNo}</td>
                        <td className="py-1.5 pr-2">{line.description}</td>
                        <td className="tnum py-1.5 pr-2 text-right">{line.qty || "—"}</td>
                        <td className="py-1.5 pr-2 text-right">{parsePaise(line.rate) !== null ? <Money value={paiseToDecimal(parsePaise(line.rate)!)} /> : line.rate || "—"}</td>
                        <td className="py-1.5 text-right">{parsePaise(line.amount) !== null ? <Money value={paiseToDecimal(parsePaise(line.amount)!)} /> : line.amount || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {totalCheck ? (
            <section
              className={cn(
                "rounded-[var(--radius-md)] border p-4",
                totalCheck.matches ? "border-[var(--confirmed)]/30 bg-[var(--confirmed-soft)]/50" : "border-[var(--possible)]/40 bg-[var(--possible-soft)]",
              )}
            >
              <p className="text-xs font-medium text-[var(--ink)]">
                {totalCheck.matches ? "The maths checks out" : "The lines don\u2019t add up to the total"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-2)]">
                Lines add to <span className="tnum">{formatMoney(totalCheck.linesSum)}</span> — the stated total is{" "}
                <span className="tnum">{formatMoney(totalCheck.grand)}</span>
                {totalCheck.matches ? "." : <> (off by <span className="tnum">{formatMoney(totalCheck.diff)}</span>). Check the values above.</>}
              </p>
            </section>
          ) : null}

          {(suggestions.supplier || suggestions.po) && (
            <section className="rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--accent-soft)]/50 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Suggested links — confirm or change</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.supplier && <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--surface)] px-3 py-1 text-xs text-[var(--ink-2)]">Supplier: {suggestions.supplier}</span>}
                {suggestions.po && <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--surface)] px-3 py-1 text-xs text-[var(--ink-2)]">Order: {suggestions.po}</span>}
              </div>
            </section>
          )}

          {saveError ? (
            <p className="rounded-[var(--radius-sm)] border border-[var(--sev-critical)]/40 bg-[var(--sev-critical-soft)] px-3 py-2 text-xs text-[var(--sev-critical)]">
              {saveError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">
              {hasFields
                ? checkFields.length
                  ? `${checkFields.length} field${checkFields.length === 1 ? "" : "s"} marked “Check” or “Low” — look at them before saving.`
                  : "Every field is high-confidence. One last look, then save."
                : "Type the fields on the right — nothing is saved until you do."}
            </p>
            {confirmedDocId ? (
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--confirmed)]/30 bg-[var(--confirmed-soft)] px-4 py-2 text-sm font-medium text-[var(--confirmed)]">
                <ShieldCheck size={15} aria-hidden="true" /> Saved as evidence{confirmedDocId.startsWith("doc_mock") ? " (mock)" : ""}
              </span>
            ) : (
              <button
                type="button"
                disabled={!ready || saving}
                onClick={saveAsEvidence}
                title={ready ? "Save this document as evidence" : hasFields ? "Fill every field first" : "Fill in the required fields first"}
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
