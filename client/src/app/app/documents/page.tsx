"use client";

// Documents inbox (/app/documents) — docs/plan/06 §5.5. Drop zone → upload
// every file, read each with the extraction pipeline, then show a per-file
// results list. The AI data-policy notice must be acknowledged once before
// the first upload (remembered in this browser).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UploadCloud, FileText, CircleCheck, CircleAlert, LoaderCircle, ShieldAlert, ArrowRight,
  Landmark, FileSpreadsheet, X, FileUp, Inbox, CircleDashed,
} from "lucide-react";
import { ingestApi, readLocal, writeLocal, AI_NOTICE_KEY, type DraftListRow } from "@/lib/api/v2-pages";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { DateText, ErrorState, EmptyState, PageHeader, FadeIn, Card, Btn } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { docTypeLabel, MAX_UPLOAD_MB, ACCEPT_EXT, formatBytes } from "@/components/pages/documents/labels";
import { LinkBtn } from "@/components/pages/shared/link-btn";
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
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", meta.tone)}>
      <Icon size={14} className={meta.spin ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function DraftRow({ draft }: { draft: DraftListRow }) {
  const name = draft.filename ?? `Upload ${draft.id.slice(-6)}`;
  const issue = draft.status === "failed" || draft.status === "needs_review" ? draft.issues?.find((i) => i.severity !== "info")?.message : undefined;
  return (
    <li>
      <Link
        href={`/app/documents/${draft.id}`}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--line)] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[var(--surface-2)]/60 focus-visible:bg-[var(--surface-2)] focus-visible:outline-none"
      >
        <FileText size={18} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <div className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] sm:basis-0">
          <p className="truncate text-sm font-medium text-[var(--ink)]" title={name}>{name}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
            {draft.detectedType ? `${docTypeLabel(draft.detectedType)} · ` : ""}
            {draft.uploadedAt ? <>uploaded <DateText value={draft.uploadedAt} withTime /></> : "upload time not recorded"}
            {draft.size ? ` · ${formatBytes(draft.size)}` : ""}
          </p>
          {issue ? <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-2)]">{issue}</p> : null}
        </div>
        <span className="pl-[30px] sm:pl-0"><StatusWord status={draft.status} /></span>
        <ArrowRight size={14} className="hidden shrink-0 text-[var(--muted)] sm:block" aria-hidden="true" />
      </Link>
    </li>
  );
}

function DraftList({ items, empty }: { items: DraftListRow[]; empty: React.ReactNode }) {
  if (!items.length) return <>{empty}</>;
  return (
    <Card pad={false} className="overflow-hidden">
      <ul>{items.map((d) => <DraftRow key={d.id} draft={d} />)}</ul>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <Card pad={false} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0">
          <Skeleton className="h-5 w-5 rounded" />
          <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-1/4" /></div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </Card>
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
        <h2 className="text-sm font-semibold text-[var(--ink)]" aria-live="polite">
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
                <p className="truncate text-sm text-[var(--ink)]" title={item.name}>{item.name}</p>
                <p className="text-xs text-[var(--muted)]">{formatBytes(item.size)}{item.message ? ` · ${item.message}` : ""}</p>
              </div>
              <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", meta.tone)}>
                <Icon size={14} className={spin ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" /> {meta.word}
              </span>
              {item.draftId ? (
                <Link href={`/app/documents/${item.draftId}`} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-strong)] hover:underline">
                  Open draft <ArrowRight size={12} aria-hidden="true" />
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
      <h2 id="ai-notice-title" className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
        <ShieldAlert size={16} className="text-[var(--possible)]" aria-hidden="true" /> Before Satya reads documents with AI
      </h2>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[var(--ink-2)]">
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

  const [tab, setTab] = useState<string | null>(null);
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

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Documents"
        description="Drop invoices, delivery notes and other supplier paperwork — Satya reads them, you check and confirm. Nothing counts as evidence until you do."
      />

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
          "group flex flex-col items-center rounded-[var(--radius-lg)] border-2 border-dashed px-6 py-10 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
          !canUpload
            ? "cursor-not-allowed border-[var(--line)] bg-[var(--surface)] opacity-70"
            : dragOver
              ? "cursor-pointer border-[var(--accent)] bg-[var(--accent-soft)]"
              : "cursor-pointer border-[var(--line-strong)] bg-[var(--surface)] hover:border-[var(--accent)]/60 hover:bg-[var(--surface-2)]/40",
        )}
      >
        <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-2)] transition-colors group-hover:bg-[var(--accent-soft)]">
          {busy ? <LoaderCircle size={22} className="animate-spin text-[var(--accent)] motion-reduce:animate-none" aria-hidden="true" /> : <UploadCloud size={22} className="text-[var(--accent)]" aria-hidden="true" />}
        </div>
        <p className="mt-4 text-sm font-medium text-[var(--ink)]">
          {busy ? "Uploading and reading…" : ack === false ? "Accept the notice above to start uploading" : "Drop files here, or click to choose"}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">PDF, photo (PNG, JPEG, WebP), Excel, CSV or e-invoice JSON — up to {MAX_UPLOAD_MB} MB each</p>
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
      ) : (
        <Tabs value={tab ?? (needsReview.length ? "review" : "uploads")} onValueChange={setTab}>
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="w-max [&>button]:whitespace-nowrap">
              <TabsTrigger value="review">Needs review{needsReview.length ? ` (${needsReview.length})` : ""}</TabsTrigger>
              <TabsTrigger value="uploads">All uploads</TabsTrigger>
              <TabsTrigger value="saved">Saved{saved.length ? ` (${saved.length})` : ""}</TabsTrigger>
              {failed.length ? <TabsTrigger value="failed">Couldn’t read ({failed.length})</TabsTrigger> : null}
            </TabsList>
          </div>

          {error ? (
            <div className="mt-4"><ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} /></div>
          ) : isLoading ? (
            <div className="mt-4"><ListSkeleton /></div>
          ) : (
            <>
              <TabsContent value="review" className="mt-4">
                <DraftList
                  items={needsReview}
                  empty={<EmptyState icon={CircleCheck} title="Nothing waiting for review" body="When you upload a document, Satya reads it and it lands here for you to check before it counts." />}
                />
              </TabsContent>
              <TabsContent value="uploads" className="mt-4">
                <DraftList
                  items={items}
                  empty={<EmptyState icon={UploadCloud} title="No uploads yet" body="Drop a supplier invoice, delivery challan or GRN above to get started." />}
                />
              </TabsContent>
              <TabsContent value="saved" className="mt-4">
                <DraftList
                  items={saved}
                  empty={<EmptyState icon={FileText} title="Nothing saved yet" body="Documents you confirm become evidence and show up here, linked to their orders." />}
                />
              </TabsContent>
              <TabsContent value="failed" className="mt-4">
                <DraftList items={failed} empty={null} />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}

      <Card>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <FileSpreadsheet size={15} className="text-[var(--muted)]" aria-hidden="true" /> Importing in bulk?
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
          Bank statements and GST returns have their own column-mapped importers, so every row is checked before it is saved.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkBtn href="/app/payments" icon={Landmark}>Bank statement CSV → Payments</LinkBtn>
          <LinkBtn href="/app/compliance" icon={FileUp}>GSTR-2B JSON → Compliance</LinkBtn>
        </div>
      </Card>
    </FadeIn>
  );
}
