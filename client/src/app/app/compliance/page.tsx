"use client";

// Compliance (/app/compliance) answers: "Which legal deadlines are at risk?"
// (docs/design/UI_SPEC.md §7). Overview first — six check cards with a status
// chip, count, ₹ at stake and next deadline. Choosing one (or ?tab=…) opens
// its detail: a collapsible "How this check works" panel, filter chips with
// counts and one aligned table with a single primary action per row.
// Disputed bills are "On hold — resolve dispute" → "Review issue", never
// "Record payment". Screening only: Satya doesn't file returns.
//
// Detail panels live in components/pages/compliance/*.

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader, FadeIn, CardGridSkeleton } from "@/components/ui/v2";
import { CHECKS, CheckCards, normaliseTab, summarise, type CheckSummary } from "@/components/pages/compliance/overview";
import { useSection, type SectionKey } from "@/components/pages/compliance/shared";
import { MsmePanel } from "@/components/pages/compliance/msme";
import { Gstr2bPanel } from "@/components/pages/compliance/gstr2b";
import { Rule37Panel } from "@/components/pages/compliance/rule37";
import { TdsPanel } from "@/components/pages/compliance/tds";
import { EwayPanel } from "@/components/pages/compliance/eway";
import { LutPanel } from "@/components/pages/compliance/lut";

const DocPreviewModal = dynamic(
  () => import("@/components/v2/doc-preview").then((m) => m.DocPreviewModal),
  { ssr: false },
);

/** Loads all six sections (shared cache with the panels) for the overview. */
function useSummaries() {
  const msme = useSection("msme");
  const gstr2b = useSection("gstr2b");
  const rule37 = useSection("rule37");
  const tds = useSection("tds");
  const eway = useSection("eway");
  const lut = useSection("lut");
  const queries = { msme, gstr2b, rule37, tds, eway, lut };
  const out: Partial<Record<SectionKey, { summary?: CheckSummary; loading: boolean; error: boolean }>> = {};
  for (const id of Object.keys(queries) as SectionKey[]) {
    const q = queries[id];
    let summary: CheckSummary | undefined;
    try {
      summary = q.data ? summarise(id, q.data) : undefined;
    } catch {
      summary = undefined;
    }
    out[id] = { summary, loading: q.isLoading, error: Boolean(q.error) };
  }
  return out;
}

function ComplianceInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = normaliseTab(params.get("tab"));
  const [picked, setPicked] = useState<SectionKey | null>(null);
  const selected: SectionKey = fromUrl ?? picked ?? "msme";
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const onView = useCallback((id: string) => setPreviewDoc(id), []);
  const panelRef = useRef<HTMLElement | null>(null);
  const summaries = useSummaries();
  const meta = useMemo(() => CHECKS.find((c) => c.id === selected) ?? CHECKS[0], [selected]);

  const select = (id: SectionKey) => {
    setPicked(id);
    const next = new URLSearchParams(params.toString());
    next.set("tab", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    // On narrow screens the detail sits below six cards — bring it into view.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const allLoading = Object.values(summaries).every((s) => s?.loading);

  return (
    <FadeIn className="page-stack">
      <PageHeader
        title="Compliance"
        description="Six legal checks on your recorded bills and payments — what’s at risk, by when, and the next step for each."
      />

      <section aria-label="Checks overview">
        {allLoading ? <CardGridSkeleton count={6} /> : <CheckCards selected={selected} onSelect={select} summaries={summaries} />}
      </section>

      <section
        ref={panelRef}
        id="check-panel"
        role="tabpanel"
        aria-labelledby={`check-tab-${selected}`}
        className="scroll-mt-24"
      >
        <div className="mb-5">
          <h2 className="type-section-title">{meta.name}</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-[var(--muted)]">{meta.question}</p>
        </div>
        <div key={selected} className="fade-in">
          {selected === "msme" ? <MsmePanel onView={onView} /> : null}
          {selected === "gstr2b" ? <Gstr2bPanel onView={onView} /> : null}
          {selected === "rule37" ? <Rule37Panel onView={onView} /> : null}
          {selected === "tds" ? <TdsPanel onView={onView} /> : null}
          {selected === "eway" ? <EwayPanel onView={onView} /> : null}
          {selected === "lut" ? <LutPanel onView={onView} /> : null}
        </div>
      </section>

      {previewDoc ? <DocPreviewModal documentId={previewDoc} onClose={() => setPreviewDoc(null)} /> : null}
    </FadeIn>
  );
}

export default function CompliancePage() {
  return (
    <Suspense fallback={<CardGridSkeleton count={6} />}>
      <ComplianceInner />
    </Suspense>
  );
}
