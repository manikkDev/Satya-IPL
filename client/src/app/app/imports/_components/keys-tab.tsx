"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Copy, Loader2, Plus, Ban, ShieldCheck } from "lucide-react";
import { importsApi } from "@/lib/api/imports";
import { Btn, EmptyState, ErrorState } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, relTime, errorText, Section } from "./shared";

export function KeysTab({ entityId, canImport }: { entityId: string; canImport: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["import-keys"], queryFn: importsApi.apiKeys, enabled: canImport });
  const [name, setName] = useState("Tally connector — accounts PC");
  const [fresh, setFresh] = useState<{ key: string; prefix: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const k = await importsApi.createApiKey(name.trim(), entityId);
      setFresh({ key: k.key, prefix: k.prefix });
      qc.invalidateQueries({ queryKey: ["import-keys"] });
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    try { await importsApi.revokeApiKey(id); toast.success("Key revoked"); qc.invalidateQueries({ queryKey: ["import-keys"] }); } catch (e) { toast.error(errorText(e)); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Copy failed — select the key and copy it manually"); }
  };

  if (!canImport) return <EmptyState icon={KeyRound} title="Connector keys need import rights" body="Ask an AP manager or treasury user to create a key for the Tally connector." />;

  return (
    <div className="space-y-5">
      <Section title="Tally connector">
        <p className="text-[15px] leading-relaxed text-[var(--ink-2)]">
          A small program on the PC where TallyPrime runs reads vouchers and masters from Tally (port 9000, on that PC only) and sends them here every day.
          It needs a key — keys can only send files into imports for this company; they cannot read your data or approve anything.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[14px] text-[var(--ink-2)]">
          <li>In TallyPrime: F1 Help → Settings → Connectivity → Client/Server configuration → TallyPrime acts as <b>Server</b>, port <b>9000</b>.</li>
          <li>Create a key below and copy it.</li>
          <li>On the Tally PC: <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px]">node satya-tally-connector.mjs --days 7 --commit</code> with <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px]">SATYA_URL</code> and <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px]">SATYA_API_KEY</code> set (see connectors/tally/README.md). Schedule it daily.</li>
        </ol>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="key-name">Key name</label>
          <input id="key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--ink)]" />
          <Btn size="lg" icon={busy ? Loader2 : Plus} onClick={create} disabled={busy || name.trim().length < 2}>New key</Btn>
        </div>
        {fresh ? (
          <div role="status" className="mt-4 rounded-[var(--radius-sm)] border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]"><ShieldCheck size={15} className="text-[var(--accent)]" aria-hidden="true" /> Copy this key now — it will not be shown again.</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)]">{fresh.key}</code>
              <Btn variant="secondary" icon={Copy} onClick={() => copy(fresh.key)}>Copy</Btn>
            </div>
          </div>
        ) : null}
      </Section>

      {q.isLoading ? <Skeleton className="h-24 w-full" /> : q.error ? <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} /> : (
        <ul className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
          {(q.data?.items ?? []).map((k) => (
            <li key={k.id} className="flex flex-col gap-2 border-b border-[var(--line)] px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-[var(--ink)]">{k.name}</p>
                <p className="mt-0.5 text-[13px] text-[var(--muted)]"><code>{k.prefix}…</code> · created {relTime(k.createdAt)} · {k.lastUsedAt ? `last used ${relTime(k.lastUsedAt)}` : "never used"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {k.revokedAt ? <Pill tone="unchanged">Revoked</Pill> : <><Pill tone="create">Active</Pill><Btn size="sm" variant="danger" icon={Ban} onClick={() => revoke(k.id)}>Revoke</Btn></>}
              </div>
            </li>
          ))}
          {!q.data?.items.length ? <li className="px-5 py-8 text-center text-sm text-[var(--muted)]">No keys yet.</li> : null}
        </ul>
      )}
    </div>
  );
}
