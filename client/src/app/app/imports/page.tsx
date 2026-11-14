"use client";

// Import hub (/app/imports): one place to bring data in — TallyPrime XML,
// bank statements (CSV/XLSX/MT940), GSTR-2B JSON and CSV/XLSX templates for
// masters and documents. Upload → we check the file and show what will be
// created, what is already in Satya and which rows need fixing → import →
// automatic checks (case attachment, linking, GSTR-2B match, reconcile,
// exact payment allocation) run in the background and the result shows
// what was linked, what was flagged and what waits for review.

import { useState } from "react";
import { PageHeader, FadeIn } from "@/components/ui/v2";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/components/v2/session";
import { NewImport } from "./_components/new-import";
import { ImportHistory } from "./_components/history";
import { Gstr2bTab } from "./_components/gstr2b-tab";
import { KeysTab } from "./_components/keys-tab";

export default function ImportsPage() {
  const { activeEntity, hasPermission } = useSession();
  const entityId = activeEntity?.id ?? "";
  const canImport = hasPermission("import.data", entityId || undefined) || hasPermission("doc.upload", entityId || undefined) || hasPermission("master.manage", entityId || undefined);
  const [tab, setTab] = useState("new");

  return (
    <FadeIn className="mx-auto w-full max-w-[1100px] text-[15px]">
      <PageHeader
        eyebrow="Data"
        title="Import hub"
        description="Bring in data from Tally, your bank, the GST portal or a spreadsheet. We check every file before anything is saved, skip what is already here, and run the checks automatically afterwards."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-auto">
            <TabsTrigger value="new" className="px-3.5 py-1.5 text-[14px]">New import</TabsTrigger>
            <TabsTrigger value="history" className="px-3.5 py-1.5 text-[14px]">History</TabsTrigger>
            <TabsTrigger value="gstr2b" className="px-3.5 py-1.5 text-[14px]">GSTR-2B match</TabsTrigger>
            <TabsTrigger value="keys" className="px-3.5 py-1.5 text-[14px]">Connector keys</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="new"><NewImport entityId={entityId} canImport={canImport} /></TabsContent>
        <TabsContent value="history"><ImportHistory /></TabsContent>
        <TabsContent value="gstr2b"><Gstr2bTab entityId={entityId} canImport={canImport} /></TabsContent>
        <TabsContent value="keys"><KeysTab entityId={entityId} canImport={hasPermission("import.data", entityId || undefined)} /></TabsContent>
      </Tabs>
    </FadeIn>
  );
}
