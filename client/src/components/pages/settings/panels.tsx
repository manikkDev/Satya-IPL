"use client";

// Read-only settings panels wired to data the server already exposes:
// entities (GET /api/v2/entities), people & access (GET /api/v2/me),
// numbering + approval limits (the entity policy), suppliers, items, and
// this browser's AI-notice acknowledgement.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, MapPin, BadgeCheck, ShieldCheck, UserRound, Hash, Stamp, ScanText, RotateCcw, ArrowUpRight, Users, Package, Info } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { accountApi, policyApi, readLocal, writeLocal, AI_NOTICE_KEY, todayIst, fyOfDate, type EntityRecord } from "@/lib/api/v2-pages";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Money, DateText, ErrorState, EmptyState, Card, CardTitle, Btn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkBtn } from "@/components/pages/shared/link-btn";
import { docTypeLabel } from "@/components/pages/documents/labels";

const ReadOnlyNote = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-start gap-2 text-sm text-[var(--muted)]">
    <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> <span>{children}</span>
  </p>
);

const PanelSkeleton = ({ rows = 2 }: { rows?: number }) => (
  <div className="space-y-4" aria-busy="true">
    {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-40 w-full" />)}
  </div>
);

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/* ---------- organisation & entities ---------- */

const addressLine = (a?: { line1?: string; city?: string; state?: string; pin?: string }) =>
  a ? [a.line1, a.city, a.state, a.pin].filter(Boolean).join(", ") : "";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs text-[var(--muted)] sm:text-sm">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-[var(--ink)]">{children}</dd>
    </div>
  );
}

export function EntitiesPanel() {
  const { entities: sessionEntities } = useSession();
  const mocks = mocksEnabled();
  const q = useQuery({ queryKey: ["entities-full"], queryFn: () => accountApi.entities(), enabled: !mocks });
  const items: EntityRecord[] = mocks ? (sessionEntities as unknown as EntityRecord[]) : q.data ?? [];

  if (!mocks && q.error) return <ErrorState message={errMsg(q.error, "Could not load entities.")} onRetry={() => q.refetch()} />;
  if (!mocks && q.isLoading) return <PanelSkeleton />;
  if (!items.length) return <EmptyState icon={Building2} title="No entities yet" body="Entities are the companies your group buys for. Ask your Satya administrator to add one." />;

  return (
    <div className="space-y-4">
      <ReadOnlyNote>These details print on your purchase orders. Changing them is done by your Satya administrator.</ReadOnlyNote>
      {items.map((e) => {
        const gstins = e.gstins?.map((g) => g.gstin) ?? (e.gstin ? [e.gstin] : []);
        return (
          <Card key={e.id}>
            <CardTitle icon={Building2} hint={e.code}>{e.legalName}</CardTitle>
            <dl className="divide-y divide-[var(--line)]">
              {e.tradeName && e.tradeName !== e.legalName ? <Row label="Trade name">{e.tradeName}</Row> : null}
              <Row label="GSTIN">{gstins.length ? gstins.map((g) => <span key={g} className="font-code mr-3">{g}</span>) : "Not recorded"}</Row>
              <Row label="PAN"><span className="font-code">{e.pan ?? "Not recorded"}</span></Row>
              {e.cin ? <Row label="CIN"><span className="font-code">{e.cin}</span></Row> : null}
              <Row label="Billing address">{addressLine(e.addresses?.billing) || "Not recorded"}</Row>
              {e.addresses?.shipping?.length ? (
                <Row label="Delivery addresses">
                  <ul className="space-y-1.5">
                    {e.addresses.shipping.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <MapPin size={13} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                        <span>{s.label ? <strong className="font-medium">{s.label}: </strong> : null}{addressLine(s)}{s.contact ? <span className="text-[var(--muted)]"> · {s.contact}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                </Row>
              ) : null}
              <Row label="Export LUT">
                {e.lut?.length ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {e.lut.map((l) => (
                      <span key={l.arn} className="inline-flex items-center gap-1">
                        <BadgeCheck size={13} className="text-[var(--confirmed)]" aria-hidden="true" />
                        <span className="font-code text-xs">{l.arn}</span> <span className="text-[var(--muted)]">FY {l.fy}, to <DateText value={l.validTo} /></span>
                      </span>
                    ))}
                  </span>
                ) : "None on record"}
                {" "}<Link href="/app/compliance" className="text-sm font-medium text-[var(--accent)] hover:underline">Manage in Compliance</Link>
              </Row>
              {e.letterhead?.footerText ? <Row label="Letterhead footer">{e.letterhead.footerText}</Row> : null}
            </dl>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- people & access ---------- */

const PERMISSION_WORDS: Record<string, string> = {
  "po.approve": "Approve purchase orders",
  "doc.upload": "Upload and confirm documents",
  "import.data": "Import bank statements and GST files",
  "master.manage": "Manage suppliers and items",
  "finding.decide": "Decide on findings",
  "payment.release.maker": "Prepare payment releases",
  "payment.release.checker": "Approve payment releases",
  "supplier.bank.maker": "Propose supplier bank changes",
  "supplier.bank.checker": "Approve supplier bank changes",
  "evidence.export": "Export evidence packs",
  "audit.read": "Read the review history",
  "copilot.use": "Ask Satya questions",
  "policy.manage": "Change entity policies",
  "entity.manage": "Manage entities",
  "reports.view": "View reports",
};
const roleWord = (r: string) => r.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export function PeoplePanel() {
  const mocks = mocksEnabled();
  const { user, entities, activeEntity } = useSession();
  const q = useQuery({ queryKey: ["me-full"], queryFn: () => accountApi.me(), enabled: !mocks, staleTime: 5 * 60_000 });

  if (mocks) {
    return (
      <Card>
        <CardTitle icon={UserRound}>{user?.name ?? "Demo user"}</CardTitle>
        <ReadOnlyNote>Demo mode — people and roles come from the live server.</ReadOnlyNote>
      </Card>
    );
  }
  if (q.error) return <ErrorState message={errMsg(q.error, "Could not load your access.")} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <PanelSkeleton />;

  const me = q.data;
  const nameOf = (id: string) => (id === "*" ? "All entities" : entities.find((e) => e.id === id)?.legalName ?? me.entities.find((e) => e.id === id)?.legalName ?? id);
  const perms = [...new Set([...(me.permissions[activeEntity?.id ?? ""] ?? []), ...(me.permissions["*"] ?? [])])].sort();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle icon={UserRound} hint={me.activeGroup.name}>You</CardTitle>
        <dl className="divide-y divide-[var(--line)]">
          <Row label="Name">{me.user.name}</Row>
          <Row label="Email">{me.user.email}</Row>
          <Row label="Group">{me.activeGroup.name}{me.activeGroup.plan ? <span className="text-[var(--muted)]"> · {me.activeGroup.plan} plan</span> : null}</Row>
          <Row label="Roles">
            <ul className="space-y-1">
              {me.memberships.map((m, i) => (
                <li key={i}>{m.roles.map(roleWord).join(", ")} <span className="text-[var(--muted)]">— {nameOf(m.entityId)}</span></li>
              ))}
            </ul>
          </Row>
        </dl>
      </Card>
      <Card>
        <CardTitle icon={ShieldCheck} hint={activeEntity?.legalName}>What you can do here</CardTitle>
        {perms.length ? (
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {perms.map((p) => (
              <li key={p} className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
                <BadgeCheck size={14} className="shrink-0 text-[var(--confirmed)]" aria-hidden="true" /> {PERMISSION_WORDS[p] ?? p}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--muted)]">No permissions on this entity.</p>}
        <p className="mt-4 text-sm text-[var(--muted)]">
          Makers can’t also be checkers: whoever prepares an order, bank change or payment release needs a colleague to approve it.
        </p>
      </Card>
      <ReadOnlyNote>Inviting people and changing roles is done by your Satya administrator.</ReadOnlyNote>
    </div>
  );
}

/* ---------- numbering & approval limits ---------- */

const previewNumber = (pattern: string, code: string, fy: string, seq: number) =>
  pattern
    .replaceAll("{ENT}", code)
    .replaceAll("{FY}", fy)
    .replace(/\{SEQ:(\d+)\}/g, (_m, n) => String(seq).padStart(Number(n), "0"))
    .replaceAll("{SEQ}", String(seq));

export function NumberingPanel() {
  const { activeEntity } = useSession();
  const entityId = activeEntity?.id ?? "";
  const mocks = mocksEnabled();
  const q = useQuery({ queryKey: ["policy", entityId], queryFn: () => policyApi.get(entityId), enabled: Boolean(entityId) && !mocks });

  if (mocks) return <ReadOnlyNote>Demo mode — numbering series come from the live server.</ReadOnlyNote>;
  if (q.error) return <ErrorState message={errMsg(q.error, "Could not load numbering.")} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <PanelSkeleton />;

  const currentFy = fyOfDate(todayIst());
  const code = activeEntity?.code ?? "ENT";
  // one row per document type: the current-FY series if it exists, else the template
  const byType = new Map<string, { docType: string; pattern: string; nextSeq?: number; fy?: string }>();
  for (const n of q.data.numbering ?? []) {
    const existing = byType.get(n.docType);
    if (n.fy === currentFy || !existing || (existing.fy !== currentFy && !n.fy)) byType.set(n.docType, n);
  }
  const series = [...byType.values()];
  const doa = q.data.doa ?? [];

  return (
    <div className="space-y-4">
      <Card pad={false} className="overflow-hidden">
        <div className="px-5 pt-5"><CardTitle icon={Hash} hint={`FY ${currentFy}`}>Document numbering</CardTitle></div>
        {series.length ? (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-[var(--line)] bg-[var(--surface-2)]/60 text-[13px] font-semibold text-[var(--muted)]">
                  <th scope="col" className="px-5 py-2.5 text-left">Document</th>
                  <th scope="col" className="px-5 py-2.5 text-left">Pattern</th>
                  <th scope="col" className="px-5 py-2.5 text-left">Next number</th>
                </tr>
              </thead>
              <tbody>
                {series.map((n) => (
                  <tr key={n.docType} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-5 py-2.5 text-[var(--ink)]">{docTypeLabel(n.docType)}</td>
                    <td className="font-code px-5 py-2.5 text-xs text-[var(--ink-2)]">{n.pattern}</td>
                    <td className="font-code px-5 py-2.5 text-xs text-[var(--ink)]">{previewNumber(n.pattern, code, n.fy ?? currentFy, n.nextSeq ?? 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 pb-5 text-sm text-[var(--muted)]">No numbering series set up for this entity.</p>}
      </Card>

      <Card pad={false} className="overflow-hidden">
        <div className="px-5 pt-5"><CardTitle icon={Stamp}>Who can approve how much</CardTitle></div>
        {doa.length ? (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-[var(--line)] bg-[var(--surface-2)]/60 text-[13px] font-semibold text-[var(--muted)]">
                  <th scope="col" className="px-5 py-2.5 text-left">Document</th>
                  <th scope="col" className="px-5 py-2.5 text-right">Up to</th>
                  <th scope="col" className="px-5 py-2.5 text-left">Roles</th>
                </tr>
              </thead>
              <tbody>
                {doa.map((d, i) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-5 py-2.5 text-[var(--ink)]">{docTypeLabel(d.docType)}</td>
                    <td className="px-5 py-2.5 text-right"><Money value={d.maxAmount} /></td>
                    <td className="px-5 py-2.5 text-[var(--ink-2)]">{d.roles.map(roleWord).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 pb-5 text-sm text-[var(--muted)]">No approval limits set — any approver can approve any amount.</p>}
      </Card>
      <ReadOnlyNote>Numbering series and approval limits are set by your Satya administrator.</ReadOnlyNote>
    </div>
  );
}

/* ---------- AI & data ---------- */

export function AiPanel() {
  const [ack, setAck] = useState<boolean | null>(null);
  useEffect(() => setAck(readLocal(AI_NOTICE_KEY) === "1"), []);
  return (
    <Card className="max-w-2xl">
      <CardTitle icon={ScanText}>AI reading of documents</CardTitle>
      <p className="text-sm leading-relaxed text-[var(--ink-2)]">
        Scans and photos are read by an external AI service. On the demo plan that is Google Gemini’s free tier, where inputs
        may be used to improve Google’s products — upload sample documents, or only documents your company has agreed to share
        this way. PDFs with a text layer and e-invoice QR codes are read without AI.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
        <p className="text-sm text-[var(--ink)]">
          {ack === null ? "Checking…" : ack ? "You accepted this notice in this browser." : "You have not accepted this notice in this browser yet."}
        </p>
        {ack ? (
          <Btn size="sm" variant="secondary" icon={RotateCcw} onClick={() => { writeLocal(AI_NOTICE_KEY, null); setAck(false); toast.success("The notice will show again before your next upload"); }}>
            Show the notice again
          </Btn>
        ) : (
          <LinkBtn href="/app/documents" icon={ArrowUpRight}>Go to Documents</LinkBtn>
        )}
      </div>
    </Card>
  );
}

/* ---------- masters ---------- */

export function SuppliersPanel() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  if (error) return <ErrorState message={errMsg(error, "Could not load suppliers.")} onRetry={() => refetch()} />;
  if (isLoading) return <PanelSkeleton rows={1} />;
  const items = data?.items ?? [];
  if (!items.length) {
    return <EmptyState icon={Users} title="No suppliers yet" body="Suppliers are added when you raise your first purchase order." actionLabel="Create a purchase order" onAction={() => router.push("/app/orders/new")} />;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]"><span className="tnum">{items.length}</span> supplier{items.length === 1 ? "" : "s"} on record</p>
        <LinkBtn href="/app/suppliers" icon={ArrowUpRight}>Open suppliers</LinkBtn>
      </div>
      <Card pad={false} className="overflow-hidden">
        <ul>
          {items.map((s) => (
            <li key={s.id}>
              <Link href={`/app/suppliers/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3 transition-colors last:border-0 hover:bg-[var(--surface-2)]/60">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--ink)]">{s.legalName ?? s.name}</span>
                  <span className="font-code mt-0.5 block text-xs text-[var(--muted)]">{s.gstin || "No GSTIN"}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  {s.msme ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--likely-soft)] px-2 py-0.5 font-medium text-[var(--likely)]"><BadgeCheck size={12} aria-hidden="true" /> MSME · {s.msme}</span> : null}
                  {s.paymentTermsDays != null ? <span className="tnum">{s.paymentTermsDays}-day terms</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function ItemsPanel() {
  const router = useRouter();
  const mocks = mocksEnabled();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["items"],
    queryFn: () => (mocks ? Promise.resolve({ items: [{ id: "itm_1", code: "CP-100", description: "Centrifugal pump 1 kW", hsn: "8413", uom: "NOS", gstRate: "18" }] }) : v2.items()),
  });
  if (error) return <ErrorState message={errMsg(error, "Could not load items.")} onRetry={() => refetch()} />;
  if (isLoading) return <PanelSkeleton rows={1} />;
  const items = data?.items ?? [];
  if (!items.length) {
    return <EmptyState icon={Package} title="No items yet" body="Items are saved to this list when you add them while raising a purchase order." actionLabel="Create a purchase order" onAction={() => router.push("/app/orders/new")} />;
  }
  return (
    <Card pad={false} className="overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/60 text-[13px] font-semibold text-[var(--muted)]">
              <th scope="col" className="px-4 py-2.5 text-left">Code</th>
              <th scope="col" className="px-4 py-2.5 text-left">Description</th>
              <th scope="col" className="px-4 py-2.5 text-left">HSN</th>
              <th scope="col" className="px-4 py-2.5 text-left">Unit</th>
              <th scope="col" className="px-4 py-2.5 text-right">GST</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-[var(--line)] last:border-0 text-[var(--ink-2)]">
                <td className="font-code px-4 py-2.5 text-xs text-[var(--ink)]">{item.code}</td>
                <td className="px-4 py-2.5">{item.description}</td>
                <td className="font-code px-4 py-2.5 text-xs">{item.hsn ?? "—"}</td>
                <td className="px-4 py-2.5">{item.uom ?? "—"}</td>
                <td className="tnum px-4 py-2.5 text-right">{item.gstRate ? `${item.gstRate}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
