"use client";

// Ask Satya (/app/ask). Deep links: ?about=<question or record>&case=<caseId>.

import { Suspense } from "react";
import { AskWorkspace } from "@/components/copilot/AskWorkspace";

export default function AskPage() {
  return (
    <Suspense fallback={<div role="status" className="p-8 text-sm text-[var(--muted)]">Loading Ask Satya…</div>}>
      <AskWorkspace />
    </Suspense>
  );
}
