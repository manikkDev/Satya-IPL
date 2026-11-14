"use client";

// Workspace page (/app/model): live model card from the evaluation service,
// rendered inside the app shell. Same view as the public /research/model.

import { PageHeader, BtnLink } from "@/components/ui/v2";
import { ModelCardView } from "@/components/pitch/model-card-view";

export default function ModelPerformancePage() {
  return (
    <div>
      <PageHeader
        title="Model performance"
        description="How accurate Satya’s matching and reading are, measured on labelled data — each number shows where it comes from."
        actions={<BtnLink href="/research#methods" variant="secondary">How it’s measured</BtnLink>}
      />
      <ModelCardView variant="app" />
    </div>
  );
}
