// ROI calculator (/roi). Inputs, defaults and sources are in
// content/pitch/roi.ts; the interactive part is a client component.

import type { Metadata } from "next";
import Link from "next/link";
import { PitchPage, PitchHero, Callout } from "@/components/pitch/page-shell";
import { RoiCalculator } from "@/components/pitch/roi-calculator";

export const metadata: Metadata = {
  title: "ROI calculator",
  description:
    "Estimate hours freed, MSME interest avoided, 43B(h) deduction kept and duplicate payments stopped. Every formula visible, every default sourced.",
};

export default function RoiPage() {
  return (
    <PitchPage current="/roi">
      <PitchHero eyebrow="ROI calculator" title="What is the evidence chain worth to you?">
        <p>
          Put in your own volumes and payables. Each default is marked as a <strong className="font-semibold text-[var(--ink)]">benchmark</strong>{" "}
          (with its source), a <strong className="font-semibold text-[var(--ink)]">statutory</strong> value, an{" "}
          <strong className="font-semibold text-[var(--ink)]">assumption</strong> or a{" "}
          <strong className="font-semibold text-[var(--ink)]">placeholder</strong> for you to replace. Benchmarks describe AP
          automation in general. They are not Satya results.
        </p>
      </PitchHero>
      <div className="mt-8 print:hidden">
        <Callout tone="honest" title="How to read this">
          <p>
            This is a planning estimate, not a quote or a guarantee. The figures that matter come from a pilot: a backtest
            on 12–24 months of your own data and a shadow-mode run. <Link href="/guide" className="text-[var(--accent)] underline underline-offset-[3px]">See how a pilot works</Link>.
          </p>
          <p className="text-sm text-[var(--muted)]">
            Don&apos;t convert the global $9.84-per-invoice benchmark into rupees: Indian costs differ, so this calculator works from
            your staff cost and time instead.
          </p>
        </Callout>
      </div>
      <div className="mt-10">
        <RoiCalculator />
      </div>
    </PitchPage>
  );
}
