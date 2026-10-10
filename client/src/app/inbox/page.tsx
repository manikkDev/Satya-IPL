"use client";

import BusinessShell from "@/components/BusinessShell";
import ImportWorkspace from "@/components/ImportWorkspace";

export default function InboxPage() {
  return <BusinessShell title="Import records" subtitle="Start with a ready-made example or upload your CSVs. Review the records, save them and see the results."><ImportWorkspace /></BusinessShell>;
}
