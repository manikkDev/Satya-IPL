"use client";

// Settings (/app/settings) — 06 §5.11. The entity policy is editable (local
// draft, Save/Discard, unsaved-changes guard). Everything else shows the
// real records the server already has — entities, your access, numbering,
// approval limits, suppliers, items — read-only, with no placeholder
// controls.

import { useState } from "react";
import { PageHeader, FadeIn, BtnLink } from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PolicyEditor } from "@/components/pages/settings/policy-editor";
import { EntitiesPanel, PeoplePanel, NumberingPanel, AiPanel, SuppliersPanel, ItemsPanel } from "@/components/pages/settings/panels";

const TABS = [
  ["policy", "Policy"],
  ["organisation", "Organisation"],
  ["people", "People & access"],
  ["numbering", "Numbering & approvals"],
  ["suppliers", "Suppliers"],
  ["items", "Items"],
  ["ai", "AI & data"],
] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<string>("policy");
  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Settings"
        description="Approval rules, company details, people, numbering and master data for your workspace."
        actions={<BtnLink href="/app/setup" variant="secondary" size="sm">Setup checklist</BtnLink>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            {TABS.map(([value, label]) => <TabsTrigger key={value} value={value} className="whitespace-nowrap">{label}</TabsTrigger>)}
          </TabsList>
        </div>
        {/* forceMount keeps an unsaved policy draft alive while browsing other tabs */}
        <TabsContent value="policy" forceMount className="mt-5 data-[state=inactive]:hidden"><PolicyEditor /></TabsContent>
        <TabsContent value="organisation" className="mt-5"><EntitiesPanel /></TabsContent>
        <TabsContent value="people" className="mt-5"><PeoplePanel /></TabsContent>
        <TabsContent value="numbering" className="mt-5"><NumberingPanel /></TabsContent>
        <TabsContent value="suppliers" className="mt-5"><SuppliersPanel /></TabsContent>
        <TabsContent value="items" className="mt-5"><ItemsPanel /></TabsContent>
        <TabsContent value="ai" className="mt-5"><AiPanel /></TabsContent>
      </Tabs>
    </FadeIn>
  );
}
