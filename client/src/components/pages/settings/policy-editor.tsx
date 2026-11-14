"use client";

// Entity policy editor. Edits live in a local draft — never in the query
// cache — until Save (PUT /api/v2/policies/:entityId with expectedRevision
// when the server reports one). Discard restores the saved values; leaving
// the page with unsaved edits asks first.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save, Undo2, CircleDot, CircleCheck, Lock } from "lucide-react";
import { policyApi, can, type PolicyRecord } from "@/lib/api/v2-pages";
import { ApiError } from "@/lib/api/client";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { ErrorState, Card, Btn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Form = { pricePct: string; priceAbs: string; msmeDays: string; makerChecker: boolean; autoConfirm: boolean };

const formOf = (p: PolicyRecord | undefined): Form => ({
  pricePct: p?.tolerance?.pricePct ?? "",
  priceAbs: p?.tolerance?.priceAbs ?? "",
  msmeDays: p?.msme?.defaultDays !== undefined ? String(p.msme.defaultDays) : "",
  makerChecker: Boolean(p?.approvals?.requireMakerChecker),
  autoConfirm: Boolean(p?.autoConfirmHighConfidence),
});

const sameForm = (a: Form, b: Form) =>
  a.pricePct.trim() === b.pricePct.trim() && a.priceAbs.trim() === b.priceAbs.trim() && a.msmeDays.trim() === b.msmeDays.trim() &&
  a.makerChecker === b.makerChecker && a.autoConfirm === b.autoConfirm;

const validate = (f: Form): Partial<Record<keyof Form, string>> => {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(f.pricePct.trim())) errors.pricePct = "A percentage from 0 to 99.99, e.g. 2 or 2.5";
  if (f.priceAbs.trim() && !/^\d+(\.\d{1,2})?$/.test(f.priceAbs.trim().replaceAll(",", ""))) errors.priceAbs = "An amount like 100 or 100.50";
  const days = Number(f.msmeDays.trim());
  if (!/^\d+$/.test(f.msmeDays.trim()) || days < 1 || days > 365) errors.msmeDays = "Whole days from 1 to 365";
  else if (days > 45) errors.msmeDays = "The MSMED Act caps this at 45 days — longer terms are not allowed for micro/small suppliers";
  return errors;
};

const MOCK_POLICY: PolicyRecord = { tolerance: { pricePct: "2", priceAbs: "100.00" }, msme: { defaultDays: 45 }, approvals: { requireMakerChecker: true } };

const inputCls =
  "h-9 w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="mt-1 text-[13px] text-[var(--sev-critical)]">{message}</p> : null;
}

function Editor({ entityId, entityName, server }: { entityId: string; entityName: string; server: PolicyRecord }) {
  const queryClient = useQueryClient();
  const { permissions, mocks } = useSession();
  const canEdit = mocks || can(permissions, "policy.manage", entityId);
  const saved = useMemo(() => formOf(server), [server]);
  const [form, setForm] = useState<Form>(saved);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const dirty = !sameForm(form, saved);
  const errors = validate(form);
  const invalid = Object.keys(errors).length > 0;

  // When the saved policy changes underneath (save, refetch) and there are
  // no local edits, follow it.
  useEffect(() => {
    if (!touched) setForm(saved);
  }, [saved, touched]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (patch: Partial<Form>) => {
    setTouched(true);
    setForm((f) => ({ ...f, ...patch }));
  };

  const discard = () => {
    setForm(saved);
    setTouched(false);
  };

  const save = async () => {
    if (invalid || !dirty) return;
    setSaving(true);
    try {
      const body = {
        tolerance: {
          pricePct: form.pricePct.trim(),
          ...(form.priceAbs.trim() ? { priceAbs: form.priceAbs.trim().replaceAll(",", "") } : {}),
        },
        msme: { defaultDays: Number(form.msmeDays.trim()) },
        approvals: { requireMakerChecker: form.makerChecker },
        autoConfirmHighConfidence: form.autoConfirm,
        ...(typeof server.revision === "number" ? { expectedRevision: server.revision } : {}),
      };
      if (mocks) {
        queryClient.setQueryData(["policy", entityId], { ...server, ...body });
        toast.info("Demo data — the policy is not saved to a server");
      } else {
        const next = await policyApi.put(entityId, body);
        queryClient.setQueryData(["policy", entityId], next);
        toast.success("Policy saved — it applies from the next check");
      }
      setTouched(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("Someone else changed this policy. Their version is loaded — re-apply your edits.");
        setTouched(false);
        await queryClient.invalidateQueries({ queryKey: ["policy", entityId] });
      } else if (e instanceof ApiError && e.status === 403) {
        toast.error("Your role cannot change policies.");
      } else {
        toast.error(e instanceof Error ? e.message : "Could not save the policy — try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const showErr = (k: keyof Form) => (touched ? errors[k] : undefined);

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-[var(--muted)]">
        Rules for <strong className="font-medium text-[var(--ink)]">{entityName}</strong> — matching tolerance, MSME deadline and approval
        requirements. Saved values apply from the next check.
      </p>
      {!canEdit ? (
        <p className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
          <Lock size={14} className="text-[var(--muted)]" aria-hidden="true" /> Your role can view these rules but not change them.
        </p>
      ) : null}

      <Card>
        <h3 className="text-sm font-semibold text-[var(--ink)]">Matching tolerance</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">An invoice price that differs from the order by more than this is flagged for review.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="pol-pct" className="mb-1 block text-[13px] font-medium text-[var(--muted)]">Price difference allowed (%)</label>
            <input id="pol-pct" className={cn(inputCls, "tnum", showErr("pricePct") ? "border-[var(--sev-critical)]" : "border-[var(--line)]")} inputMode="decimal" disabled={!canEdit}
              value={form.pricePct} onChange={(e) => set({ pricePct: e.target.value })} aria-invalid={Boolean(showErr("pricePct"))} aria-describedby="pol-pct-err" />
            <FieldError id="pol-pct-err" message={showErr("pricePct")} />
          </div>
          <div>
            <label htmlFor="pol-abs" className="mb-1 block text-[13px] font-medium text-[var(--muted)]">Or up to this much per line (₹)</label>
            <input id="pol-abs" className={cn(inputCls, "tnum", showErr("priceAbs") ? "border-[var(--sev-critical)]" : "border-[var(--line)]")} inputMode="decimal" disabled={!canEdit}
              value={form.priceAbs} onChange={(e) => set({ priceAbs: e.target.value })} aria-invalid={Boolean(showErr("priceAbs"))} aria-describedby="pol-abs-err" />
            <FieldError id="pol-abs-err" message={showErr("priceAbs")} />
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-[var(--ink)]">MSME payment deadline</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">Micro and small suppliers must be paid within this many days of acceptance (45 at most).</p>
        <div className="mt-3 sm:w-48">
          <label htmlFor="pol-msme" className="mb-1 block text-[13px] font-medium text-[var(--muted)]">Days</label>
          <input id="pol-msme" className={cn(inputCls, "tnum", showErr("msmeDays") ? "border-[var(--sev-critical)]" : "border-[var(--line)]")} inputMode="numeric" disabled={!canEdit}
            value={form.msmeDays} onChange={(e) => set({ msmeDays: e.target.value })} aria-invalid={Boolean(showErr("msmeDays"))} aria-describedby="pol-msme-err" />
        </div>
        <FieldError id="pol-msme-err" message={showErr("msmeDays")} />
      </Card>

      <Card>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" disabled={!canEdit}
            checked={form.makerChecker} onChange={(e) => set({ makerChecker: e.target.checked })} />
          <span>
            <span className="block text-sm font-medium text-[var(--ink)]">Maker → checker on approvals</span>
            <span className="mt-0.5 block text-sm text-[var(--muted)]">The person who creates a document cannot approve it — a second person must sign off.</span>
          </span>
        </label>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" disabled={!canEdit}
            checked={form.autoConfirm} onChange={(e) => set({ autoConfirm: e.target.checked })} />
          <span>
            <span className="block text-sm font-medium text-[var(--ink)]">Auto-confirm high-confidence extractions</span>
            <span className="mt-0.5 block text-sm text-[var(--muted)]">Skip manual review only when every extracted field reads high confidence.</span>
          </span>
        </label>
      </Card>

      {canEdit ? (
        <div
          className={cn(
            "sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-3 shadow-[var(--shadow-2)] md:bottom-4",
            dirty ? "border-[color-mix(in_srgb,var(--possible)_45%,transparent)] bg-[var(--surface)]" : "border-[var(--line)] bg-[var(--surface)]",
          )}
          role="region"
          aria-label="Save policy"
        >
          <p className="flex items-center gap-2 text-sm" aria-live="polite">
            {dirty ? (
              <><CircleDot size={14} className="text-[var(--possible)]" aria-hidden="true" /><span className="font-medium text-[var(--ink)]">Unsaved changes</span></>
            ) : (
              <><CircleCheck size={14} className="text-[var(--confirmed)]" aria-hidden="true" /><span className="text-[var(--muted)]">All changes saved</span></>
            )}
          </p>
          <div className="flex gap-2">
            <Btn variant="ghost" size="sm" icon={Undo2} disabled={!dirty || saving} onClick={discard}>Discard</Btn>
            <Btn size="sm" icon={saving ? Loader2 : Save} disabled={!dirty || saving || invalid} onClick={save} title={invalid ? "Fix the highlighted values first" : undefined}>
              {saving ? "Saving…" : "Save policy"}
            </Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PolicyEditor() {
  const { activeEntity, mocks } = useSession();
  const entityId = activeEntity?.id ?? "";
  const { data, isLoading, error, refetch } = useQuery<PolicyRecord>({
    queryKey: ["policy", entityId],
    queryFn: () => (mocksEnabled() ? Promise.resolve(MOCK_POLICY) : policyApi.get(entityId)),
    enabled: Boolean(entityId) || mocks,
  });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load the policy."} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="max-w-2xl space-y-5" aria-busy="true">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-[150px] w-full" />
        <Skeleton className="h-[130px] w-full" />
        <Skeleton className="h-[150px] w-full" />
      </div>
    );
  }
  // keyed by entity so a switch never carries another entity's draft over
  return <Editor key={entityId} entityId={entityId} entityName={activeEntity?.legalName ?? "this entity"} server={data} />;
}
