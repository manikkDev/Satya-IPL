"use client";

// Settings (/app/settings) — 06 §5.11. The entity policy is editable (local
// draft, Save/Discard, unsaved-changes guard). Everything else shows the
// real records the server already has — entities, your access, numbering,
// approval limits, suppliers, items — read-only, with no placeholder
// controls. Sections sit in a grouped left rail on desktop (one section at
// a time) and a sideways-scrolling tab row on phones.

import { useState } from "react";
import { PageHeader, FadeIn, BtnLink } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PolicyEditor } from "@/components/pages/settings/policy-editor";
import { EntitiesPanel, PeoplePanel, NumberingPanel, AiPanel, SuppliersPanel, ItemsPanel } from "@/components/pages/settings/panels";
import { pageTabsList, pageTabsTrigger } from "@/components/pages/shared/page-tabs";
import { cn } from "@/lib/utils";

type Section = readonly [value: string, label: string, hint: string];
const GROUPS: { label: string; items: readonly Section[] }[] = [
  { label: "Rules", items: [["policy", "Checks & deadlines", "Matching tolerance, MSME days, approvals"], ["numbering", "Numbering & approvals", "Document numbers and who approves what"]] },
  { label: "Company", items: [["organisation", "Company details", "Legal name, GSTIN, PAN, LUT"], ["people", "People & access", "Who can do what"]] },
  { label: "Master data", items: [["suppliers", "Suppliers", "Supplier list and bank details"], ["items", "Items", "Item codes, HSN and GST rates"]] },
  { label: "Privacy", items: [["ai", "AI & data", "What the assistant may read"]] },
];
const ALL = GROUPS.flatMap((g) => g.items);

const railTrigger =
  "w-full justify-start rounded-[var(--radius-sm)] px-3 py-2.5 text-left data-[state=active]:bg-[var(--surface-2)] data-[state=active]:shadow-none";

export default function SettingsPage() {
  const [tab, setTab] = useState<string>("policy");
  const current = ALL.find(([v]) => v === tab);

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="Settings"
        description="The rules Satya checks against, your company details, people and master data."
        actions={<BtnLink href="/app/setup" variant="secondary">Setup checklist</BtnLink>}
      />

      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        {/* phones/tablets: one sideways row */}
        <TabsList className={cn(pageTabsList, "lg:hidden")}>
          {ALL.map(([value, label]) => <TabsTrigger key={value} value={value} className={pageTabsTrigger}>{label}</TabsTrigger>)}
        </TabsList>

        {/* desktop: grouped rail */}
        <nav aria-label="Settings sections" className="hidden lg:block">
          <div className="sticky top-24 space-y-5">
            {GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-1.5 px-3 text-[13px] font-semibold text-[var(--muted)]">{g.label}</p>
                <TabsList className="flex w-full flex-col items-stretch gap-0.5 bg-transparent p-0">
                  {g.items.map(([value, label]) => (
                    <TabsTrigger key={value} value={value} className={railTrigger}>{label}</TabsTrigger>
                  ))}
                </TabsList>
              </div>
            ))}
          </div>
        </nav>

        <div className="mt-6 min-w-0 lg:mt-0">
          {current ? (
            <div className="mb-5">
              <h2 className="type-section-title">{current[1]}</h2>
              <p className="mt-1 text-[15px] text-[var(--muted)]">{current[2]}</p>
            </div>
          ) : null}
          {/* forceMount keeps an unsaved policy draft alive while browsing other tabs */}
          <TabsContent value="policy" forceMount className="mt-0 data-[state=inactive]:hidden"><PolicyEditor /></TabsContent>
          <TabsContent value="organisation" className="mt-0"><EntitiesPanel /></TabsContent>
          <TabsContent value="people" className="mt-0"><PeoplePanel /></TabsContent>
          <TabsContent value="numbering" className="mt-0"><NumberingPanel /></TabsContent>
          <TabsContent value="suppliers" className="mt-0"><SuppliersPanel /></TabsContent>
          <TabsContent value="items" className="mt-0"><ItemsPanel /></TabsContent>
          <TabsContent value="ai" className="mt-0"><AiPanel /></TabsContent>
        </div>
      </Tabs>
    </FadeIn>
  );
}
