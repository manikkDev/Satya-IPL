"use client";

// Evidence-pack PDF (06 §5.6, 07 P3). Renders one investigation — balances,
// issues with certainty, calculation steps, documents and decisions — from
// the snapshot already on screen. No figures are recomputed here; the engine's
// decimal strings are drawn as-is.

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { mockCaseDetail } from "@/lib/mocks/data";

type CaseDetail = typeof mockCaseDetail;

const ink = "#1d1a16";
const muted = "#6b6357";
const line = "#e3ddd4";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: ink, fontFamily: "Helvetica" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 8.5, color: muted, marginTop: 4 },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, color: muted },
  card: { border: 0.5, borderColor: line, borderRadius: 3, padding: 8, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  balances: { flexDirection: "row", gap: 8, marginTop: 6 },
  balance: { flex: 1, border: 0.5, borderColor: line, borderRadius: 3, padding: 8 },
  bLabel: { fontSize: 7.5, color: muted },
  bValue: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 3 },
  fTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  fMeta: { fontSize: 7.5, color: muted, marginTop: 2 },
  fBody: { fontSize: 8.5, marginTop: 4, lineHeight: 1.45 },
  small: { fontSize: 7.5, color: muted, marginTop: 3 },
  footer: { position: "absolute", bottom: 26, left: 40, right: 40, fontSize: 7, color: muted, borderTop: 0.5, borderColor: line, paddingTop: 5 },
});

const money = (m?: { amount: string; currency: string } | null) => (m ? `₹${m.amount}` : "—");
const CERT: Record<string, string> = { CONFIRMED: "Confirmed", PROBABLE: "Likely", POSSIBLE: "Possible", AMBIGUOUS: "Unclear — needs decision", INSUFFICIENT_EVIDENCE: "Missing information" };

export function EvidencePack({ data }: { data: CaseDetail }) {
  const { case: caseData, snapshot, documents, decisions } = data;
  const b = snapshot.balances;
  return (
    <Document title={`Evidence pack — ${caseData.title}`} author="Satya">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Evidence pack</Text>
        <Text style={s.sub}>
          {caseData.title} · {caseData.status} · generated {new Date().toISOString().slice(0, 10)} · revision {caseData.revision}
        </Text>

        {b && (
          <View style={s.balances}>
            <View style={s.balance}><Text style={s.bLabel}>What you really owe</Text><Text style={s.bValue}>{money(b.supported)}</Text></View>
            <View style={s.balance}><Text style={s.bLabel}>Amount under question</Text><Text style={s.bValue}>{money(b.disputed)}</Text></View>
            <View style={s.balance}><Text style={s.bLabel}>What your books show</Text><Text style={s.bValue}>{money(b.recorded)}</Text></View>
          </View>
        )}

        <Text style={s.h2}>Recommendation</Text>
        <Text style={s.fBody}>{snapshot.recommendation.reasons.join(" ")}</Text>
        {snapshot.recommendation.scope?.holdAmount && (
          <Text style={s.small}>Suggested hold: {money(snapshot.recommendation.scope.holdAmount)}{snapshot.recommendation.scope.approveAmount ? ` · approve: ${money(snapshot.recommendation.scope.approveAmount)}` : ""}</Text>
        )}

        <Text style={s.h2}>Issues ({snapshot.findings.length})</Text>
        {snapshot.findings.map((f) => (
          <View key={f.id} style={s.card} wrap={false}>
            <View style={s.row}>
              <Text style={s.fTitle}>{f.title}</Text>
              <Text style={s.fMeta}>{f.severity} · {CERT[f.certainty] ?? f.certainty}</Text>
            </View>
            <Text style={s.fBody}>{f.explanation}</Text>
            {"amount" in (f.exposure ?? {}) && <Text style={s.small}>At risk: {money(f.exposure as { amount: string; currency: string })}</Text>}
            <Text style={s.small}>Would settle this: {f.whatResolvesIt}</Text>
            {f.evidence.length > 0 && (
              <Text style={s.small}>Evidence: {f.evidence.map((e) => `${e.documentType} · ${e.field}`).join("  |  ")}</Text>
            )}
            {f.calculation.length > 0 && (
              <View style={{ marginTop: 3 }}>
                {f.calculation.map((step, i) => (
                  <Text key={i} style={s.small}>{i + 1}. {step.step}{step.value ? ` → ${step.value}` : ""}</Text>
                ))}
              </View>
            )}
          </View>
        ))}

        <Text style={s.h2}>Documents ({documents.length})</Text>
        {documents.map((doc) => (
          <View key={doc.id} style={s.row}>
            <Text style={s.fBody}>{doc.number} · {doc.type}</Text>
            <Text style={s.fMeta}>{doc.date} · {doc.status}{doc.amount ? ` · ${money(doc.amount)}` : ""}</Text>
          </View>
        ))}

        <Text style={s.h2}>Decisions ({decisions.length})</Text>
        {decisions.map((d) => (
          <View key={d.id} style={{ marginBottom: 4 }}>
            <Text style={s.fBody}>{d.action.replaceAll("_", " ").toLowerCase()} — {d.reason}</Text>
            <Text style={s.small}>{d.actor} · {d.role.replaceAll("_", " ")} · {d.createdAt}</Text>
          </View>
        ))}
        {decisions.length === 0 && <Text style={s.small}>No decisions recorded on this check yet.</Text>}

        <Text style={s.footer} fixed>
          Satya evidence pack — every figure above traces to a document listed here. Generated for internal review and audit; not a legal filing.
        </Text>
      </Page>
    </Document>
  );
}

export async function downloadEvidencePack(data: CaseDetail) {
  const blob = await pdf(<EvidencePack data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `evidence-pack-${data.case.id}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
