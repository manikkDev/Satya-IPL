"use client";

// Workspace page (/app/model): live model card from the evaluation service,
// rendered inside the app shell. Same view as the public /research/model.

import Link from "next/link";
import { PageHeader } from "@/components/ui/v2";
import { ModelCardView } from "@/components/pitch/model-card-view";

export default function ModelPerformancePage() {
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow="Trust"
        title="Model performance"
        description="How well each model does, on which data, with intervals. Every number comes from the latest evaluation run and carries its data source. None of it is real-customer accuracy unless it is labelled backtest, shadow or live."
        actions={
          <Link href="/research#methods" className="text-sm font-medium text-[var(--accent)] underline underline-offset-[3px]">
            Methodology
          </Link>
        }
      />
      <ModelCardView variant="app" />
    </div>
  );
}
