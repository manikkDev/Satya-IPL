"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import RiskShell, { ErrorPanel, LoadingPanel } from "@/components/risk/RiskShell";
import { api } from "@/lib/api";

function Fairness() {
  const [report,setReport]=useState(null); const [error,setError]=useState("");
  useEffect(()=>{api.fl.fairness().then(setReport).catch((reason)=>setError(reason.message));},[]);
  return <RiskShell title="Responsible-AI audit" subtitle="Performance and false-positive rates are compared across institutions. PaySim contains no demographic attributes, so this is operational—not demographic—fairness.">{error&&<ErrorPanel message={error}/>} {!report?<LoadingPanel/>:<section className="rounded-2xl border bg-card p-6"><div className="mb-6 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">{report.scope}</div><div className="space-y-5">{report.groups.map((group)=><div key={group.group}><div className="mb-2 flex justify-between text-sm"><span className="font-medium">{group.group}</span><span>PR-AUC {(group.pr_auc*100).toFixed(2)}% · FPR {(group.false_positive_rate*100).toFixed(2)}%</span></div><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-indigo-500" style={{width:`${Math.max(2,group.pr_auc*100)}%`}}/></div></div>)}</div><div className="mt-8 grid gap-3 md:grid-cols-3"><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Audit principle</p><p className="mt-1 font-medium">Compare error burden, not accuracy alone</p></div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Protected attributes</p><p className="mt-1 font-medium">Not available in PaySim</p></div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Production requirement</p><p className="mt-1 font-medium">BAF + legal fairness review</p></div></div></section>}</RiskShell>;
}

export default function FairnessPage(){return <ProtectedRoute allowedRoles={["analyst","admin"]}><Fairness/></ProtectedRoute>;}
