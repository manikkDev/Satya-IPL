"use client";

import { useEffect, useState } from "react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi } from "@/lib/business-api";

type Evaluation = { ready: boolean; modelVersion?: string; source?: string; pairCount?: number; episodeCount?: number; test?: { precision: number; recall: number; prAuc: number; brier: number; samples: number }; highConfidence?: { coverage: number; precision: number | null; count: number }; limitations?: string[]; message?: string };
export default function EvaluationPage() {
  const [report, setReport] = useState<Evaluation | null>(null);
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { businessApi.evaluation().then((data) => { setRaw(data); setReport(data as Evaluation); }).catch((error) => setError(error.message)); }, []);
  return <BusinessShell title="Model performance" subtitle="Understand how record-matching suggestions are tested, and where human review is still needed.">
    <State error={error} loading={!report && !error} />
    {report && <><div className="satya-notice warning"><strong>Test results, not a guarantee.</strong> The model is tested on constructed examples, not verified company data. Suggestions never approve a payment automatically.<p className="mt-2 text-xs">Test data source: {report.source || "No trained model loaded"}</p></div>
      {report.ready && report.test ? <><div className="satya-metric-grid">{[
        ["Correct suggestions", `${(report.test.precision * 100).toFixed(1)}%`, "Precision: how many suggested matches were right in the test"],
        ["True matches found", `${(report.test.recall * 100).toFixed(1)}%`, "Recall: how many real test matches were detected"],
        ["Examples tested", String(report.test.samples), `${report.pairCount ?? "—"} record pairs across the full demo dataset`],
        ["High-confidence suggestions", `${((report.highConfidence?.coverage || 0) * 100).toFixed(1)}%`, `${report.highConfidence?.count || 0} test suggestions with a score of at least 98%`],
      ].map(([label, value, detail]) => <article className="satya-metric" key={label}><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>)}</div><div className="satya-two-column"><Panel title="How to use these scores" detail="A matching score helps prioritize review. It is not proof that two records belong together."><ul className="satya-list"><li>Open the source records before confirming a match.</li><li>Check invoice references, delivery details and payment evidence.</li><li>Keep uncertain matches unresolved until the missing information is available.</li><li>Use the score alongside the records, not instead of them.</li></ul></Panel><Panel title="Known limitations" detail={`Model version: ${report.modelVersion || "Not supplied"}`}><ul className="satya-list">{report.limitations?.map((limit) => <li key={limit}>{limit}</li>)}</ul>{!report.limitations?.length && <p className="text-muted-foreground">No additional limitations were listed in this report. The demo-data limitation still applies.</p>}</Panel></div><Panel title="Technical details" detail="For teams reviewing the model and its test results."><p className="text-sm text-muted-foreground mb-4">The XGBoost model is compared with a logistic baseline. Separate training, calibration and test examples are used.</p><details><summary>View the full evaluation report</summary><pre className="satya-code mt-4">{JSON.stringify(raw, null, 2)}</pre></details></Panel></> : <Panel title="No trained matching model is loaded"><p className="text-muted-foreground">{report.message || "Record checks and stored calculations are still available. Model suggestions will appear after a trained model is loaded."}</p></Panel>}
      <Panel title="About the data"><p className="text-muted-foreground">The equipment-company records are fictional demo examples. Public procurement and invoice datasets are planned separately and are not presented as this company’s real records.</p></Panel>
    </>}
  </BusinessShell>;
}
