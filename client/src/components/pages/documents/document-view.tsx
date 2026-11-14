"use client";

// Read-only view of one posted document (/app/documents/doc_…) — used for
// invoices, GRNs, QC reports and notes that are not tied to an order page.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, FileText, Link2 } from "lucide-react";
import { docsApi, resolveDocumentHref, type DocDetail } from "@/lib/api/v2-pages";
import { Money, Qty, DateText, ErrorState, Card, CardTitle, StatusBadge, FadeIn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkBtn } from "@/components/pages/shared/link-btn";
import { docTypeLabel } from "@/components/pages/documents/labels";

const LINK_WORD: Record<string, string> = {
  FULFILS: "fulfils", RECEIVES: "receives goods for", INSPECTS: "inspects", BILLS: "bills",
  SETTLES: "settles", ADJUSTS: "adjusts", AMENDS: "amends", RETURNS: "returns goods from",
  REPORTED_IN: "is reported in", DUPLICATE_OF: "duplicates", SAME_AS: "is the same as",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] text-[var(--ink)]">{children}</dd>
    </div>
  );
}

/** One linked record, named by its type and number (never its internal id). */
function LinkedDoc({ id, word, outgoing, self }: { id: string; word: string; outgoing: boolean; self: string }) {
  const q = useQuery({ queryKey: ["document", id], queryFn: () => docsApi.get(id), staleTime: 5 * 60_000 });
  const d = q.data;
  const other = (
    <Link href={`/app/documents/${id}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
      {d ? `${docTypeLabel(d.type)} ${d.number ?? d.externalRef ?? ""}`.trim() : q.isError ? "a linked record" : "…"}
    </Link>
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-[15px]">
      <span className="text-[var(--ink-2)]">
        {outgoing ? <>This {self} {word} {other}</> : <>{other} {word} this {self}</>}
      </span>
      {d?.date ? <span className="text-[14px] text-[var(--muted)]"><DateText value={d.date} />{d.totals?.grand ? <> · <Money value={d.totals.grand} /></> : null}</span> : null}
    </li>
  );
}

export function DocumentView({ id }: { id: string }) {
  const docQ = useQuery({ queryKey: ["document", id], queryFn: () => docsApi.get(id) });
  const hrefQ = useQuery({ queryKey: ["document-href", id], queryFn: () => resolveDocumentHref(id), enabled: docQ.isSuccess });

  if (docQ.error) return <ErrorState message={docQ.error instanceof Error ? docQ.error.message : "Document not found."} onRetry={() => docQ.refetch()} />;
  if (docQ.isLoading || !docQ.data) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const doc: DocDetail = docQ.data;
  const t = doc.totals ?? {};
  const orderHref = hrefQ.data && hrefQ.data !== `/app/documents/${doc.id}` ? hrefQ.data : null;
  const source = (doc as unknown as { source?: { extractionDraftId?: string; channel?: string } }).source;

  return (
    <FadeIn className="space-y-6">
      <Link href="/app/documents" className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
        <ArrowLeft size={15} aria-hidden="true" /> Invoices & documents
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="type-eyebrow mb-1.5">{docTypeLabel(doc.type)}{doc.seller?.name ? ` · ${doc.seller.name}` : ""}</p>
          <h1 className="type-page-title break-all">{doc.number ?? doc.externalRef ?? "Unnumbered document"}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[15px] text-[var(--muted)]">
            <DateText value={doc.date} /> <StatusBadge status={doc.status} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {orderHref ? (
            <LinkBtn href={orderHref} variant="primary" size="md" icon={ArrowUpRight}>
              {orderHref.startsWith("/app/orders") ? "Open the order" : "Open payments"}
            </LinkBtn>
          ) : null}
          {source?.extractionDraftId ? (
            <LinkBtn href={`/app/documents/${source.extractionDraftId}`} size="md" icon={FileText}>Source upload</LinkBtn>
          ) : null}
        </div>
      </div>

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier / seller">{doc.seller?.name ?? "—"}</Field>
          <Field label="Seller GSTIN"><span className="tnum">{doc.seller?.gstin ?? "—"}</span></Field>
          <Field label="Buyer">{doc.buyer?.name ?? "—"}</Field>
          <Field label="Grand total">{t.grand ? <Money value={t.grand} /> : "—"}</Field>
        </dl>
      </Card>

      {doc.lines?.length ? (
        <Card pad={false} className="overflow-hidden">
          <div className="px-5 pt-5"><CardTitle>Lines</CardTitle></div>
          <div className="table-scroll">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-y border-[var(--line)] bg-[var(--surface-2)]/60 text-[13px] font-semibold text-[var(--muted)]">
                  <th scope="col" className="px-4 py-2.5 text-left">#</th>
                  <th scope="col" className="px-4 py-2.5 text-left">Description</th>
                  <th scope="col" className="px-4 py-2.5 text-left">HSN</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Qty</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Rate</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Taxable</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => (
                  <tr key={l.lineNo} className="border-b border-[var(--line)] last:border-0 text-[var(--ink-2)]">
                    <td className="tnum px-4 py-2.5">{l.lineNo}</td>
                    <td className="px-4 py-2.5 text-[var(--ink)]">{l.description}</td>
                    <td className="tnum px-4 py-2.5 text-[14px]">{l.hsn ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right"><Qty value={l.qty ?? null} uom={l.uom} /></td>
                    <td className="px-4 py-2.5 text-right">{l.rate ? <Money value={l.rate} /> : "—"}</td>
                    <td className="px-4 py-2.5 text-right">{l.taxableValue ? <Money value={l.taxableValue} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-1.5 border-t border-[var(--line)] px-5 py-4 text-[15px]">
            {([["Taxable", t.taxable], ["CGST", t.cgst], ["SGST", t.sgst], ["IGST", t.igst], ["Grand total", t.grand]] as const).map(([label, value]) =>
              value && (label === "Grand total" || value !== "0.00") ? (
                <div key={label} className="contents">
                  <dt className={label === "Grand total" ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]"}>{label}</dt>
                  <dd className={label === "Grand total" ? "text-right font-semibold text-[var(--ink)]" : "text-right text-[var(--ink-2)]"}><Money value={value} /></dd>
                </div>
              ) : null,
            )}
          </dl>
        </Card>
      ) : null}

      {doc.links?.length ? (
        <Card>
          <CardTitle icon={Link2} description="How this record connects to the rest of the trail.">Linked records</CardTitle>
          <ul className="divide-y divide-[var(--line)]">
            {doc.links.map((l) => {
              const outgoing = l.fromId === doc.id;
              const other = outgoing ? l.toId : l.fromId;
              const word = LINK_WORD[l.kind] ?? l.kind.replaceAll("_", " ").toLowerCase();
              return <LinkedDoc key={`${l.fromId}-${l.toId}-${l.kind}`} id={other} word={word} outgoing={outgoing} self={docTypeLabel(doc.type).toLowerCase()} />;
            })}
          </ul>
        </Card>
      ) : null}
    </FadeIn>
  );
}
