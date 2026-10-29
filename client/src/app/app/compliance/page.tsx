"use client";

// Compliance (/app/compliance) — docs/plan/06 §5.9. Each row explains the rule
// in one line; Satya finds issues, it does not file returns or give tax advice.

import { useQuery } from "@tanstack/react-query";
import { v2 } from "@/lib/api/v2";
import { Money, DateText, ErrorState, Term, PageHeader, FadeIn } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { daysLeftText } from "@/lib/format";

export default function CompliancePage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["compliance"], queryFn: () => v2.compliance() });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />;

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Compliance"
        description="Satya helps you find issues in your documents — it does not file returns or give tax advice."
      />

      {isLoading || !data ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <Tabs defaultValue="msme">
          <TabsList className="flex-wrap">
            <TabsTrigger value="msme"><Term of="MSME">MSME</Term> 45-day</TabsTrigger>
            <TabsTrigger value="gstr2b"><Term of="GSTR2B">GSTR-2B</Term> match</TabsTrigger>
            <TabsTrigger value="rule37">Rule 37</TabsTrigger>
            <TabsTrigger value="tds"><Term of="TDS">TDS</Term></TabsTrigger>
            <TabsTrigger value="eway">e-invoice & e-way</TabsTrigger>
            <TabsTrigger value="lut"><Term of="LUT">LUT</Term></TabsTrigger>
          </TabsList>

          <TabsContent value="msme">
            <p className="mb-3 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
              Micro and small suppliers must be paid within 45 days of acceptance — late payment costs 3× the RBI rate
              in compound interest, and you lose the tax deduction until paid.
            </p>
            <ul className="space-y-2.5">
              {data.msme.map((row) => (
                <li key={row.documentId} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--ink)]">{row.invoice} · {row.supplier}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{row.note}</p>
                  </div>
                  <div className="text-right">
                    <p className="tnum text-sm font-semibold text-[var(--ink)]"><Money value={row.amount} /></p>
                    <p className={`text-xs ${row.daysLeft <= 7 ? "font-medium text-[var(--sev-medium)]" : "text-[var(--muted)]"}`}>
                      {daysLeftText(row.daysLeft)} · due <DateText value={row.dueDate} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="gstr2b">
            <p className="mb-3 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
              Your GST credit counts only if the supplier reported the invoice — check what is missing in GSTR-2B
              before claiming.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Matched", String(data.gstr2b.matched)],
                ["Missing in 2B", String(data.gstr2b.missingIn2B.length)],
                ["Missing in books", String(data.gstr2b.missingInBooks.length)],
                ["GST credit at risk", <Money key="r" value={data.gstr2b.itcAtRisk} />],
              ].map(([label, value], i) => (
                <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3.5 transition-colors hover:border-[var(--ink-2)]/25">
                  <p className="text-[11px] text-[var(--muted)]">{label}</p>
                  <p className="tnum mt-1 text-lg font-semibold tracking-tight text-[var(--ink)]">{value}</p>
                </div>
              ))}
            </div>
            {data.gstr2b.missingIn2B.length > 0 && (
              <ul className="mt-4 space-y-2">
                {data.gstr2b.missingIn2B.map((row) => (
                  <li key={row.invoice} className="rounded-[var(--radius-sm)] border border-[var(--possible)]/40 bg-[var(--possible-soft)] px-4 py-3 text-sm leading-relaxed text-[var(--ink-2)]">
                    <span className="font-medium text-[var(--ink)]">{row.invoice}</span> · {row.supplier} · <Money value={row.amount} /> — not in GSTR-2B for {data.gstr2b.period}. Ask the supplier to report it; <Money value={row.tax} /> of credit is at risk.
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {(["rule37", "tds", "eway", "lut"] as const).map((tab) => (
            <TabsContent key={tab} value={tab}>
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--line)] bg-[var(--surface)] p-6 text-sm leading-relaxed text-[var(--muted)]">
                {{
                  rule37: "If a supplier invoice (value + tax) stays unpaid 180 days, the GST credit you claimed must be reversed with interest — upcoming risks will list here.",
                  tds: "Whether tax should have been deducted at source on each payment — thresholds depend on the financial year and your turnover band.",
                  eway: "Consignments over ₹50,000 need an e-way bill number; suppliers above the e-invoice threshold need an IRN on their invoice.",
                  lut: "Export/SEZ supplies without IGST need a Letter of Undertaking valid for the invoice's financial year.",
                }[tab]}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </FadeIn>
  );
}
