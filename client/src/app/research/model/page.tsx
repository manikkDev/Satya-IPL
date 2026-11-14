// Public, read-only model card (/research/model). Same live data as the
// workspace page /app/model.

import type { Metadata } from "next";
import Link from "next/link";
import { PitchPage, PitchHero } from "@/components/pitch/page-shell";
import { ModelCardView } from "@/components/pitch/model-card-view";

export const metadata: Metadata = {
  title: "Model performance",
  description: "Live, provenance-labelled evaluation results for Satya's matching, extraction and copilot models, with confidence intervals and calibration.",
};

export default function PublicModelPage() {
  return (
    <PitchPage current="/research/model">
      <PitchHero eyebrow="Model performance" title="Every number with its denominator, interval and data source">
        <p>
          This page reads the latest evaluation run directly. Each figure is labelled with where its data came from:
          synthetic, BPI-2019 derived or demo. None of these is a real customer, so none of them is a promise about your
          invoices. Real-customer figures will appear only after a pilot backtest, labelled as such.
        </p>
        <p className="text-[15px] text-[var(--muted)]">
          Why we report it this way: <Link href="/research#methods" className="text-[var(--accent)] underline underline-offset-[3px]">methods and literature</Link>
          {" · "}
          <Link href="/guide" className="text-[var(--accent)] underline underline-offset-[3px]">how a pilot measures it on your data</Link>
        </p>
      </PitchHero>
      <div className="mt-12">
        <ModelCardView variant="public" />
      </div>
    </PitchPage>
  );
}
