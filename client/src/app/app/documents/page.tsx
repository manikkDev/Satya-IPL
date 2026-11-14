"use client";

// Invoices & documents (/app/documents) — two views of one question, "what
// paperwork does Satya have, and what still needs me?":
//   • Recorded — the register of every bill, receipt, payment, QC and note.
//   • Uploads to check — drop zone + files Satya has read and you confirm.
// The AI data-policy notice must be acknowledged once before the first
// upload (remembered in this browser).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UploadCloud, FileText, CircleCheck, CircleAlert, LoaderCircle, ShieldAlert, ArrowRight,
  Landmark, FileSpreadsheet, X, Inbox, CircleDashed,
} from "lucide-react";
import { ingestApi, readLocal, writeLocal, AI_NOTICE_KEY, type DraftListRow } from "@/lib/api/v2-pages";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { DateText, ErrorState, EmptyState, PageHeader, FadeIn, Card, Btn, BtnLink, FilterChips, ResponsiveTable, RowActions, TableSkeleton, type Column } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { docTypeLabel, MAX_UPLOAD_MB, ACCEPT_EXT, formatBytes } from "@/components/pages/documents/labels";
import { DocumentRegister } from "@/components/pages/documents/register";
import { pageTabsList, pageTabsTrigger, tabCount } from "@/components/pages/shared/page-tabs";
import { cn } from "@/lib/utils";

/* ---------- statuses: icon + word + colour ---------- */

const STATUS_META: Record<DraftListRow["status"], { label: string; tone: string; icon: typeof CircleCheck; spin?: boolean }> = {
  queued: { label: "Queued", tone: "text-[var(--muted)]", icon: LoaderCircle, spin: true },
  parsing: { label: "Reading", tone: "text-[var(--likely)]", icon: LoaderCircle, spin: true },
  extracting: { label: "Checking", tone: "text-[var(--likely)]", icon: LoaderCircle, spin: true },
  needs_review: { label: "Needs your review", tone: "text-[var(--possible)]", icon: CircleAlert },
  confirmed: { label: "Saved as evidence", tone: "text-[var(--confirmed)]", icon: CircleCheck },
  failed: { label: "Couldn’t read", tone: "text-[var(--sev-critical)]", icon: CircleAlert },
};
const IN_FLIGHT = new Set(["queued", "parsing", "extracting"]);

function StatusWord({ status }: { status: DraftListRow["status"] }) {
  const meta = STATUS_META[status] ?? STATUS_META.queued;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[14px] font-medium", meta.tone)}>
      <Icon size={14} className={meta.spin ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

const draftColumns: Column<DraftListRow>[] = [
  {
    key: "file", header: "File", primary: true, className: "min-w-[240px]",
    cell: (d) => {
      const name = d.filename ?? "Uploaded file";
      const issue = d.status === "failed" || d.status === "needs_review" ? d.issues?.find((i) => i.severity !== "info")?.message : undefined;
      return (
        <div className="flex min-w-0 items-start gap-3">
          <FileText size={18} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
          <div className="min-w-0">
            <Link href={`/app/documents/${d.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-[var(--ink)] hover:underline" title={name}>{name}</Link>
            {issue ? <p className="mt-0.5 line-clamp-1 text-[13px] text-[var(--ink-2)]">{issue}</p> : null}
          </div>
        </div>
      );
    },
  },
  { key: "type", header: "Looks like", cell: (d) => <span className="text-[14px]">{d.detectedType ? docTypeLabel(d.detectedType) : "—"}</span> },
  { key: "uploaded", header: "Uploaded", cell: (d) => (d.uploadedAt ? <DateText value={d.uploadedAt} withTime className="whitespace-nowrap text-[14px]" /> : <span className="text-[var(--muted)]">—</span>) },
  { key: "status", header: "Status", cell: (d) => <StatusWord status={d.status} /> },
];

function DraftTable({ items, empty }: { items: DraftListRow[]; empty: React.ReactNode }) {
  if (!items.length) return <>{empty}</>;
  return (
    <ResponsiveTable
      caption="Uploaded files"
      columns={draftColumns}
      rows={items}
      rowKey={(d) => d.id}
      actions={(d) => (
        <RowActions
          label={d.filename ?? "this upload"}
          primary={
            d.status === "needs_review"
              ? <BtnLink size="sm" href={`/app/documents/${d.id}`}>Review</BtnLink>
              : { label: d.status === "failed" ? "Fix" : "Open", href: `/app/documents/${d.id}` }
          }
        />
      )}
    />
  );
}

/* ---------- this batch's results ---------- */

type BatchItem = {
  key: string; name: string; size: number;
  state: "waiting" | "uploading" | "reading" | "ready" | "failed";
  draftId?: string | null; duplicate?: boolean; message?: string;
};

function BatchResults({ items, onDismiss }: { items: BatchItem[]; onDismiss: () => void }) {
  const running = items.some((i) => i.state === "waiting" || i.state === "uploading" || i.state === "reading");
  const done = items.filter((i) => i.state === "ready").length;
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-[15px] font-semibold text-[var(--ink)]" aria-live="polite">
          {running ? `Uploading ${items.length} file${items.length === 1 ? "" : "s"}…` : `${done} of ${items.length} ready for review`}
        </h2>
        {!running ? (
          <button type="button" onClick={onDismiss} aria-label="Dismiss upload results" className="rounded-[var(--radius-sm)] p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60">
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ul>
        {items.map((item) => {
          const meta =
            item.state === "ready" ? { icon: CircleCheck, tone: "text-[var(--confirmed)]", word: item.duplicate ? "Already uploaded — read again" : "Read — review it" }
            : item.state === "failed" ? { icon: CircleAlert, tone: "text-[var(--sev-critical)]", word: item.draftId ? "Couldn’t read" : "Not uploaded" }
            : item.state === "waiting" ? { icon: CircleDashed, tone: "text-[var(--muted)]", word: "Waiting" }
            : { icon: LoaderCircle, tone: "text-[var(--likely)]", word: item.state === "uploading" ? "Uploading" : "Reading" };
          const Icon = meta.icon;
          const spin = item.state === "uploading" || item.state === "reading";
          return (
            <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line)] px-4 py-3 last:border-0">
              <FileText size={16} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-[var(--ink)]" title={item.name}>{item.name}</p>
                <p className="text-[13px] text-[var(--muted)]">{formatBytes(item.size)}{item.message ? ` · ${item.message}` : ""}</p>
              </div>
              <span className={cn("inline-flex items-center gap-1.5 text-[14px] font-medium", meta.tone)}>
                <Icon size={14} className={spin ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" /> {meta.word}
              </span>
              {item.draftId ? (
                <Link href={`/app/documents/${item.draftId}`} className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                  Review <ArrowRight size={12} aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ---------- AI data notice ---------- */

function AiNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <section
      aria-labelledby="ai-notice-title"
      className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--possible)_45%,transparent)] bg-[var(--possible-soft)] p-4"
    >
      <h2 id="ai-notice-title" className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
        <ShieldAlert size={16} className="text-[var(--possible)]" aria-hidden="true" /> Before Satya reads documents with AI
      </h2>
      <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-[var(--ink-2)]">
        Scans and photos are read by an external AI service. On the demo plan that is Google Gemini’s free tier, where
        inputs may be used to improve Google’s products. Upload sample documents, or only documents your company has
        agreed to share this way.
      </p>
      <Btn size="sm" className="mt-3" icon={CircleCheck} onClick={onAccept}>I understand — enable uploads</Btn>
    </section>
  );
}

/* ---------- page ---------- */

export default function DocumentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeEntity } = useSession();
  const entityId = activeEntity?.id;
  const mocks = mocksEnabled();

  const [ack, setAck] = useState<boolean | null>(null);
  useEffect(() => setAck(readLocal(AI_NOTICE_KEY) === "1"), []);
  const accept = () => {
    writeLocal(AI_NOTICE_KEY, "1");
    setAck(true);
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ingest-drafts", entityId],
    queryFn: () => ingestApi.drafts(entityId),
    enabled: !mocks,
    refetchInterval: (q) => ((q.state.data ?? []).some((d) => IN_FLIGHT.has(d.status)) ? 4000 : false),
  });

  const [view, setView] = useState<"recorded" | "uploads" | null>(null);
  const [filter, setFilter] = useState<"review" | "all" | "saved" | "failed" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const busy = Boolean(batch?.some((i) => i.state === "waiting" || i.state === "uploading" || i.state === "reading"));
  const fileInput = useRef<HTMLInputElement>(null);
  const canUpload = ack === true && !busy;

  const patchItem = (key: string, patch: Partial<BatchItem>) =>
    setBatch((prev) => prev?.map((i) => (i.key === key ? { ...i, ...patch } : i)) ?? prev);

  const onFiles = useCallback(
    async (list: FileList | null) => {
      const files = Array.from(list ?? []);
      if (!files.length) return;
      if (ack !== true) {
        toast.warning("Please read and accept the AI notice first.");
        return;
      }
      if (mocks) {
        toast.info(`${files.length} file${files.length === 1 ? "" : "s"} selected — demo mode, nothing is uploaded.`);
        return;
      }
      const stamp = Date.now();
      const items: BatchItem[] = files.map((f, i) => {
        const ext = `.${f.name.split(".").pop()?.toLowerCase() ?? ""}`;
        const tooBig = f.size > MAX_UPLOAD_MB * 1024 * 1024;
        const badType = !ACCEPT_EXT.includes(ext);
        return {
          key: `${stamp}-${i}`, name: f.name, size: f.size,
          state: tooBig || badType ? "failed" : "waiting",
          message: tooBig ? `Larger than ${MAX_UPLOAD_MB} MB` : badType ? "Unsupported file type" : undefined,
        };
      });
      setBatch(items);

      // One at a time: the server reads each file synchronously.
      const results: BatchItem[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const item = items[i];
        if (item.state === "failed") {
          results.push(item);
          continue;
        }
        try {
          patchItem(item.key, { state: "uploading" });
          const uploaded = await ingestApi.upload(files[i], entityId);
          patchItem(item.key, { state: "reading" });
          const extracted = await ingestApi.extract(uploaded.fileId);
          const ok = extracted.status !== "failed" && Boolean(extracted.draftId);
          const next: Partial<BatchItem> = {
            state: ok ? "ready" : "failed",
            draftId: extracted.draftId,
            duplicate: Boolean(uploaded.duplicateOf),
            message: ok ? undefined : extracted.message ?? "Open the draft to retry or type the fields in",
          };
          patchItem(item.key, next);
          results.push({ ...item, ...next });
        } catch (err) {
          const next: Partial<BatchItem> = { state: "failed", message: err instanceof Error ? err.message : "Upload failed" };
          patchItem(item.key, next);
          results.push({ ...item, ...next });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["ingest-drafts"] });

      const ready = results.filter((r) => r.state === "ready");
      const failed = results.length - ready.length;
      if (results.length === 1 && results[0].draftId) {
        router.push(`/app/documents/${results[0].draftId}`);
        return;
      }
      if (failed === 0) toast.success(`${ready.length} file${ready.length === 1 ? "" : "s"} read — review each below.`);
      else if (ready.length === 0) toast.error(`None of the ${results.length} files could be read.`);
      else toast.warning(`${ready.length} read, ${failed} need attention.`);
    },
    [ack, mocks, entityId, queryClient, router],
  );

  const items = useMemo(() => data ?? [], [data]);
  const needsReview = items.filter((d) => d.status === "needs_review");
  const saved = items.filter((d) => d.status === "confirmed");
  const failed = items.filter((d) => d.status === "failed");

  const openPicker = () => {
    if (canUpload) fileInput.current?.click();
    else if (ack !== true) toast.warning("Please read and accept the AI notice first.");
  };
  const activeView = view ?? (needsReview.length || batch ? "uploads" : "recorded");
  const activeFilter = filter ?? (needsReview.length ? "review" : "all");
  const shown = activeFilter === "review" ? needsReview : activeFilter === "saved" ? saved : activeFilter === "failed" ? failed : items;
  const startUpload = () => {
    setView("uploads");
    if (ack === true) openPicker();
  };

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="Invoices & documents"
        description="Every bill, goods receipt and payment Satya has — and new uploads waiting for you to check."
        actions={
          <>
            <BtnLink href="/app/imports" variant="secondary" icon={FileSpreadsheet}>Import in bulk</BtnLink>
            <Btn icon={UploadCloud} onClick={startUpload}>Upload documents</Btn>
          </>
        }
      />

      <Tabs value={activeView} onValueChange={(v) => setView(v as "recorded" | "uploads")}>
        <TabsList className={pageTabsList}>
          <TabsTrigger value="recorded" className={pageTabsTrigger}>Recorded</TabsTrigger>
          <TabsTrigger value="uploads" className={pageTabsTrigger}>
            Uploads to check{needsReview.length ? <span className={tabCount}>{needsReview.length}</span> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recorded" className="mt-6">
          {mocks ? <EmptyState icon={Inbox} title="The register needs the live server" body="Demo mode has no stored documents." /> : <DocumentRegister />}
        </TabsContent>

        <TabsContent value="uploads" className="mt-6 space-y-5">
          {ack === false ? <AiNotice onAccept={accept} /> : null}

          <div
            role="button"
            tabIndex={canUpload ? 0 : -1}
            aria-disabled={!canUpload}
            aria-label={canUpload ? "Upload documents — drop files here or press Enter to choose" : "Uploads are disabled until the AI notice is accepted"}
            onDragOver={(e) => { e.preventDefault(); if (canUpload) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (canUpload) void onFiles(e.dataTransfer.files); else openPicker(); }}
            onClick={openPicker}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } }}
            className={cn(
              "group flex flex-col items-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed px-6 py-8 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 sm:flex-row sm:text-left",
              !canUpload
                ? "cursor-not-allowed border-[var(--line)] bg-[var(--surface)] opacity-70"
                : dragOver
                  ? "cursor-pointer border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "cursor-pointer border-[var(--line-strong)] bg-[var(--surface)] hover:border-[var(--accent)]/60 hover:bg-[var(--surface-2)]/40",
            )}
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] transition-colors group-hover:bg-[var(--accent-soft)]">
              {busy ? <LoaderCircle size={22} className="animate-spin text-[var(--accent)] motion-reduce:animate-none" aria-hidden="true" /> : <UploadCloud size={22} className="text-[var(--accent)]" aria-hidden="true" />}
            </div>
            <div>
              <p className="text-[16px] font-medium text-[var(--ink)]">
                {busy ? "Uploading and reading…" : ack === false ? "Accept the notice above to start uploading" : "Drop files here, or click to choose"}
              </p>
              <p className="mt-0.5 text-[14px] text-[var(--muted)]">PDF, photo, Excel, CSV or e-invoice JSON — up to {MAX_UPLOAD_MB} MB each. Satya reads each file; nothing counts until you confirm it.</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              accept={ACCEPT_EXT.join(",")}
              onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }}
            />
          </div>

          {batch ? <BatchResults items={batch} onDismiss={() => setBatch(null)} /> : null}

          {mocks ? (
            <EmptyState icon={Inbox} title="Uploads need the live server" body="Demo mode has no stored files. Connect to a Satya server to upload and review documents." />
          ) : error ? (
            <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
          ) : isLoading ? (
            <TableSkeleton rows={4} columns={5} />
          ) : (
            <div className="space-y-4">
              {items.length ? (
                <FilterChips
                  label="Upload status"
                  value={activeFilter}
                  onChange={setFilter}
                  options={[
                    { value: "review" as const, label: "Needs review", count: needsReview.length, tone: "warn" as const },
                    { value: "all" as const, label: "All uploads", count: items.length },
                    { value: "saved" as const, label: "Saved", count: saved.length },
                    ...(failed.length ? [{ value: "failed" as const, label: "Couldn’t read", count: failed.length, tone: "critical" as const }] : []),
                  ]}
                />
              ) : null}
              <DraftTable
                items={shown}
                empty={
                  items.length ? (
                    <EmptyState icon={CircleCheck} title="Nothing here" body="Pick another filter above." />
                  ) : (
                    <p className="text-[15px] text-[var(--muted)]">No uploads yet. Files you drop above are listed here until you confirm them.</p>
                  )
                }
              />
            </div>
          )}

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-[var(--muted)]">
            <Landmark size={15} aria-hidden="true" /> Bank statements go to{" "}
            <Link href="/app/payments" className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Payments</Link>; Tally and GSTR-2B files to{" "}
            <Link href="/app/imports" className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Import data</Link>.
          </p>
        </TabsContent>
      </Tabs>
    </FadeIn>
  );
}
