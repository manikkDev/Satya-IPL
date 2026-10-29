"use client";

// Settings (/app/settings) — section index per 06 §5.11. Policy and masters
// are already live on B's endpoints; the rest of the editors open as their
// APIs land.

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Users, Stamp, Hash, Sparkles, Plug, Check, type LucideIcon } from "lucide-react";
import { v2, type EntityPolicy } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ErrorState, PageHeader, FadeIn, Card } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

const SECTIONS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Building2, title: "Organisation & entities", body: "Legal names, GSTINs (live checksum), addresses, PAN/CIN, turnover band, LUT entries." },
  { icon: Users, title: "Users & roles", body: "Invite people, assign roles per entity — and see why makers can't also be checkers." },
  { icon: Hash, title: "Numbering", body: "Series patterns with live preview, e.g. VPPL/PO/26-27/000124. GST invoice numbers stay ≤ 16 characters." },
  { icon: Stamp, title: "Branding", body: "Letterhead logo, stamp and signature images, colours — previewed on a sample PO." },
  { icon: Sparkles, title: "AI & data policy", body: "Choose paid/consented AI processing for real documents, consent per entity, usage history." },
  { icon: Plug, title: "Integrations", body: "Tally export and bank CSV formats (coming soon)." },
];

const inputCls = "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/50 px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--surface)]";

function PolicyEditor() {
  const { activeEntity, hasPermission } = useSession();
  const queryClient = useQueryClient();
  const entityId = activeEntity?.id ?? "";
  const { data, isLoading, error, refetch } = useQuery<EntityPolicy>({
    queryKey: ["policy", entityId],
    queryFn: () =>
      mocksEnabled()
        ? Promise.resolve({ tolerance: { pricePct: "2" }, msme: { defaultDays: 45 }, approvals: { requireMakerChecker: true } })
        : v2.policy(entityId),
    enabled: !!entityId,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const canEdit = mocksEnabled() || hasPermission("policy.manage", entityId);

  const patch = (path: string, value: string | number | boolean) => {
    const next = JSON.parse(JSON.stringify(data ?? {})) as Record<string, Record<string, unknown>>;
    const [group, key] = path.split(".");
    next[group] = { ...(next[group] ?? {}), [key]: value };
    void queryClient.setQueryData(["policy", entityId], next);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (!mocksEnabled()) await v2.putPolicy(entityId, data!);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      alert("Could not save the policy — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load the policy."} onRetry={() => refetch()} />;

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-xs text-[var(--muted)]">
        Rules for <strong>{activeEntity?.legalName ?? "this entity"}</strong> — matching tolerance, MSME deadline, and
        approval requirements. Saved values take effect on the next check.
      </p>

      <Card>
        <h3 className="text-sm font-semibold text-[var(--ink)]">Matching tolerance</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">Price variance beyond this is flagged for review.</p>
        <div className="mt-3 flex items-end gap-3">
          <div className="w-40">
            <label className="mb-1 block text-xs text-[var(--muted)]">Price variance %</label>
            <input className={inputCls} inputMode="decimal" disabled={!canEdit}
              value={data?.tolerance?.pricePct ?? ""} onChange={(e) => patch("tolerance.pricePct", e.target.value)} />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs text-[var(--muted)]">Absolute ₹ (optional)</label>
            <input className={inputCls} inputMode="decimal" disabled={!canEdit}
              value={data?.tolerance?.priceAbs ?? ""} onChange={(e) => patch("tolerance.priceAbs", e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-[var(--ink)]">MSME payment deadline</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">Micro/small suppliers must be paid within this many days.</p>
        <div className="mt-3 w-40">
          <input className={inputCls} inputMode="numeric" disabled={!canEdit}
            value={data?.msme?.defaultDays ?? ""} onChange={(e) => patch("msme.defaultDays", Number(e.target.value) || 0)} />
        </div>
      </Card>

      <Card>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 accent-[var(--accent)]" disabled={!canEdit}
            checked={!!data?.approvals?.requireMakerChecker}
            onChange={(e) => patch("approvals.requireMakerChecker", e.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-[var(--ink)]">Maker → checker on approvals</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              The person who creates a document cannot approve it — a second person must sign off.
            </span>
          </span>
        </label>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1 accent-[var(--accent)]" disabled={!canEdit}
            checked={!!data?.autoConfirmHighConfidence}
            onChange={(e) => patch("autoConfirmHighConfidence", e.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-[var(--ink)]">Auto-confirm high-confidence extractions</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              Skip manual review only when every field reads high confidence — you can still unconfirm later.
            </span>
          </span>
        </label>
      </Card>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !canEdit}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50">
          {saved ? <Check size={15} /> : null} {saving ? "Saving…" : saved ? "Saved" : "Save policy"}
        </button>
        {!canEdit && <p className="text-xs text-[var(--muted)]">Your role can view policies but not change them.</p>}
      </div>
    </div>
  );
}

function SuppliersPanel() {
  const { hasPermission, mocks } = useSession();
  const { data } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  const items = data?.items ?? [];
  const canEdit = mocks || hasPermission("master.manage");
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">{items.length} supplier{items.length === 1 ? "" : "s"} on record</p>
        {canEdit && <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-medium text-[var(--accent-strong)]">Add via the PO wizard or POST /api/v2/suppliers</span>}
      </div>
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">{s.legalName ?? s.name}</p>
              <p className="font-code mt-0.5 text-[11px] text-[var(--muted)]">{s.gstin || "no GSTIN"}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              {s.msme && <span className="rounded-full bg-[var(--likely-soft)] px-2 py-0.5 font-medium text-[var(--likely)]">{s.msme} enterprise</span>}
              {s.paymentTermsDays != null && <span>{s.paymentTermsDays}d terms</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["items"],
    queryFn: () => (mocksEnabled() ? Promise.resolve({ items: [{ id: "itm_1", code: "CP-100", description: "Centrifugal pump 1 kW", hsn: "8413", uom: "NOS", gstRate: "18" }] }) : v2.items()),
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]"><th className="py-2">Code</th><th>Description</th><th>HSN</th><th>UOM</th><th>GST</th></tr></thead>
      <tbody>
        {(data?.items ?? []).map((item) => (
          <tr key={item.id} className="border-b border-[var(--line)] text-[var(--ink-2)]">
            <td className="py-2 font-code text-xs">{item.code}</td>
            <td>{item.description}</td>
            <td className="font-code text-xs">{item.hsn ?? "—"}</td>
            <td>{item.uom ?? "—"}</td>
            <td>{item.gstRate ? `${item.gstRate}%` : "—"}</td>
          </tr>
        ))}
        {!data?.items?.length && <tr><td colSpan={5} className="py-6 text-center text-xs text-[var(--muted)]">No items yet — add them with POST /api/v2/items.</td></tr>}
      </tbody>
    </table>
  );
}

export default function SettingsPage() {
  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Settings"
        description="Group and entity setup, people, approvals and masters."
      />

      <Tabs defaultValue="policy">
        <TabsList className="flex-wrap">
          <TabsTrigger value="policy">Policy</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="more">More settings</TabsTrigger>
        </TabsList>
        <TabsContent value="policy"><PolicyEditor /></TabsContent>
        <TabsContent value="suppliers"><SuppliersPanel /></TabsContent>
        <TabsContent value="items"><ItemsPanel /></TabsContent>
        <TabsContent value="more">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SECTIONS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--ink-2)]/25">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Icon size={16} className="text-[var(--muted)]" aria-hidden="true" /> {title}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-[var(--muted)]">
            These editors open as their APIs land. Meanwhile, the <Link href="/dashboard" className="text-[var(--accent)] underline">current workspace</Link> stays available.
          </p>
        </TabsContent>
      </Tabs>
    </FadeIn>
  );
}
