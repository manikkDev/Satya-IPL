"use client";

// Documents inbox (/app/documents) — docs/plan/06 §5.5. Drop zone, live
// upload statuses, data-policy notice before first AI extraction.

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, FileText, CircleCheck, CircleAlert, LoaderCircle, FileUp } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { DateText, ErrorState } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Draft } from "@/lib/mocks/data";

const STATUS_META: Record<Draft["status"], { label: string; tone: string; icon: typeof CircleCheck }> = {
  queued: { label: "Queued", tone: "text-[var(--muted)]", icon: LoaderCircle },
  parsing: { label: "Reading", tone: "text-[var(--likely)]", icon: LoaderCircle },
  extracting: { label: "Checking", tone: "text-[var(--likely)]", icon: LoaderCircle },
  needs_review: { label: "Needs your review", tone: "text-[var(--possible)]", icon: CircleAlert },
  confirmed: { label: "Saved", tone: "text-[var(--confirmed)]", icon: CircleCheck },
  failed: { label: "Failed", tone: "text-[var(--sev-critical)]", icon: CircleAlert },
};

function UploadRow({ draft, onOpen }: { draft: Draft; onOpen: (id: string) => void }) {
  const meta = STATUS_META[draft.status];
  const Icon = meta.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(draft.id)}
        className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left hover:border-[var(--accent)]"
      >
        <FileText size={18} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--ink)]">{draft.filename}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {draft.detectedType ? `${draft.detectedType.replaceAll("_", " ").toLowerCase()} · ` : ""}
            uploaded <DateText value={draft.uploadedAt} withTime />
          </p>
          {draft.issue ? <p className="mt-1 text-xs text-[var(--sev-critical)]">{draft.issue}</p> : null}
        </div>
        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium", meta.tone)}>
          <Icon size={14} className={draft.status === "parsing" || draft.status === "extracting" || draft.status === "queued" ? "animate-spin" : ""} aria-hidden="true" />
          {meta.label}
        </span>
      </button>
    </li>
  );
}

export default function DocumentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeEntity } = useSession();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["drafts"], queryFn: () => v2.drafts() });
  const [dragOver, setDragOver] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      if (mocksEnabled()) {
        alert(`${files.length} file${files.length === 1 ? "" : "s"} selected — mock mode, nothing uploaded.`);
        return;
      }
      for (const file of Array.from(files)) {
        setUploading(file.name);
        try {
          const uploaded = await v2.uploadFile(file, activeEntity?.id);
          const { draftId } = await v2.extractFile(uploaded.id);
          router.push(`/app/documents/${draftId}`);
        } catch (err) {
          alert(err instanceof Error ? err.message : `Upload of ${file.name} failed`);
        }
      }
      setUploading(null);
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
    [activeEntity?.id, queryClient, router],
  );

  const items = data?.items ?? [];
  const needsReview = items.filter((item) => item.status === "needs_review");
  const records = items.filter((item) => item.status === "confirmed");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">Documents</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Drop invoices, delivery notes, bank statements and GST files — Satya reads them, you confirm.
        </p>
      </div>

      {!policyAccepted && (
        <div className="rounded-[var(--radius-md)] border border-[var(--possible)] bg-[var(--possible-soft)] p-4 text-sm text-[var(--ink-2)]">
          <p className="font-medium text-[var(--ink)]">Before we read real documents with AI</p>
          <p className="mt-1 text-xs leading-relaxed">
            Sample/demo data may be processed by Google Gemini free tier, where inputs may be used to improve Google
            products. For real company documents, enable paid processing or give consent in Settings → AI.
          </p>
          <button
            type="button"
            onClick={() => setPolicyAccepted(true)}
            className="mt-2 text-xs font-medium text-[var(--accent-strong)] underline"
          >
            Got it — I&apos;m uploading sample or consented documents
          </button>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop files to upload"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
        className={cn(
          "flex cursor-pointer flex-col items-center rounded-[var(--radius-lg)] border-2 border-dashed p-10 text-center transition-colors",
          dragOver ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--accent)]",
        )}
      >
        <UploadCloud size={30} className="text-[var(--accent)]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-[var(--ink)]">
          {uploading ? `Uploading ${uploading}…` : "Drop files here, or click to choose"}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">PDF, photo, Excel, CSV or e-invoice JSON — up to 10 MB each</p>
        <input ref={fileInput} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.json" onChange={(e) => onFiles(e.target.files)} />
      </div>

      <Tabs defaultValue="uploads">
        <TabsList>
          <TabsTrigger value="uploads">Uploads</TabsTrigger>
          <TabsTrigger value="review">Needs review{needsReview.length ? ` (${needsReview.length})` : ""}</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="import">Structured import</TabsTrigger>
        </TabsList>

        <TabsContent value="uploads">
          {error ? (
            <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (
            <ul className="space-y-2.5">
              {items.map((draft) => <UploadRow key={draft.id} draft={draft} onOpen={(id) => router.push(`/app/documents/${id}`)} />)}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="review">
          {needsReview.length ? (
            <ul className="space-y-2.5">
              {needsReview.map((draft) => <UploadRow key={draft.id} draft={draft} onOpen={(id) => router.push(`/app/documents/${id}`)} />)}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">Nothing waiting for your review.</p>
          )}
        </TabsContent>

        <TabsContent value="records">
          {records.length ? (
            <ul className="space-y-2.5">
              {records.map((draft) => <UploadRow key={draft.id} draft={draft} onOpen={(id) => router.push(`/app/documents/${id}`)} />)}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">Confirmed documents will appear here.</p>
          )}
        </TabsContent>

        <TabsContent value="import">
          <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <FileUp size={15} aria-hidden="true" /> Structured import
            </h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              The existing CSV/JSON mapping workspace (with sample downloads and validation preview) moves here once
              the v2 ingestion endpoints land — the current importer keeps working at{" "}
              <a href="/inbox" className="text-[var(--accent)] underline">Import records</a> meanwhile.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {mocksEnabled() && <p className="text-xs text-[var(--muted)]">Mock data — uploads do not reach a server.</p>}
    </div>
  );
}
