"use client";

// PO/PI PDF rendered client-side from GET /documents/:id/render-model
// (06 §5.4). The server already resolved entity, supplier, tax summary,
// amount-in-words and the verify hash — the browser only draws them.

import { Document, Page, Text, View, StyleSheet, Image, pdf } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { RenderModel } from "@/lib/api/v2";

const ink = "#1d1a16";
const muted = "#6b6357";
const line = "#e3ddd4";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: ink, fontFamily: "Helvetica" },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottom: 1.5, borderColor: ink, paddingBottom: 10 },
  legalName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 8, color: muted, marginTop: 2 },
  docTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docMeta: { fontSize: 9, textAlign: "right", color: muted, marginTop: 3 },
  parties: { flexDirection: "row", gap: 24, marginTop: 14 },
  party: { flex: 1, border: 1, borderColor: line, borderRadius: 4, padding: 8 },
  partyLabel: { fontSize: 7, color: muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  partyName: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  table: { marginTop: 14, border: 1, borderColor: line },
  tr: { flexDirection: "row", borderBottom: 0.5, borderColor: line },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: muted, textTransform: "uppercase" },
  td: { fontSize: 8.5 },
  c1: { width: "6%", padding: 5 }, c2: { width: "34%", padding: 5 }, c3: { width: "12%", padding: 5 },
  c4: { width: "10%", padding: 5, textAlign: "right" }, c5: { width: "12%", padding: 5, textAlign: "right" },
  c6: { width: "12%", padding: 5, textAlign: "right" }, c7: { width: "14%", padding: 5, textAlign: "right" },
  totals: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 200, borderTop: 1.5, borderColor: ink },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 10, borderTop: 0.5, borderColor: line, marginTop: 3, paddingTop: 3 },
  words: { marginTop: 10, fontSize: 8.5, fontStyle: "italic", color: muted },
  terms: { marginTop: 14, borderTop: 0.5, borderColor: line, paddingTop: 8 },
  sectionTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", color: muted, marginBottom: 4 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  signBox: { borderTop: 1, borderColor: ink, paddingTop: 4, width: 160, fontSize: 8, color: muted, textAlign: "center" },
  qrBox: { alignItems: "center" },
  qrLabel: { fontSize: 6.5, color: muted, marginTop: 3, textAlign: "center" },
});

const money = (v?: string | null) => (v == null ? "—" : `₹${v}`);

export async function PoPdf({ model }: { model: RenderModel }) {
  const doc = model.document;
  const qr = model.verify?.url ? await QRCode.toDataURL(model.verify.url, { margin: 0, width: 120 }) : null;
  const addr = (model.entity?.addresses as { line1?: string; city?: string; state?: string; pin?: string }[] | undefined)?.[0];

  return (
    <Document title={`${doc.number ?? "Purchase order"}`} author={model.entity?.legalName ?? "Satya"}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View>
            <Text style={s.legalName}>{model.entity?.legalName ?? "Entity"}</Text>
            {model.entity?.tradeName ? <Text style={s.meta}>{model.entity.tradeName}</Text> : null}
            <Text style={s.meta}>GSTIN {model.entity?.gstin ?? "—"}{model.entity?.pan ? ` · PAN ${model.entity.pan}` : ""}</Text>
            {addr ? <Text style={s.meta}>{[addr.line1, addr.city, addr.state, addr.pin].filter(Boolean).join(", ")}</Text> : null}
          </View>
          <View>
            <Text style={s.docTitle}>PURCHASE ORDER</Text>
            <Text style={s.docMeta}>{doc.number ?? "Draft"}</Text>
            <Text style={s.docMeta}>Date: {doc.date}</Text>
            {doc.externalRef ? <Text style={s.docMeta}>Ref: {doc.externalRef}</Text> : null}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.partyLabel}>Buyer</Text>
            <Text style={s.partyName}>{doc.buyer?.name ?? model.entity?.legalName ?? "—"}</Text>
            <Text style={s.meta}>GSTIN {doc.buyer?.gstin ?? model.entity?.gstin ?? "—"}</Text>
          </View>
          <View style={s.party}>
            <Text style={s.partyLabel}>Supplier</Text>
            <Text style={s.partyName}>{model.supplier?.legalName ?? doc.seller?.name ?? "—"}</Text>
            <Text style={s.meta}>GSTIN {model.supplier?.gstins?.[0]?.gstin ?? doc.seller?.gstin ?? "—"}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={[s.tr, { backgroundColor: "#faf7f2" }]}>
            <Text style={[s.th, s.c1]}>#</Text><Text style={[s.th, s.c2]}>Description</Text>
            <Text style={[s.th, s.c3]}>HSN</Text><Text style={[s.th, s.c4]}>Qty</Text>
            <Text style={[s.th, s.c5]}>Rate</Text><Text style={[s.th, s.c6]}>GST %</Text>
            <Text style={[s.th, s.c7]}>Amount</Text>
          </View>
          {(doc.lines ?? []).map((l) => (
            <View key={l.lineNo} style={s.tr}>
              <Text style={[s.td, s.c1]}>{l.lineNo}</Text>
              <Text style={[s.td, s.c2]}>{l.description}</Text>
              <Text style={[s.td, s.c3]}>{l.hsn ?? "—"}</Text>
              <Text style={[s.td, s.c4]}>{l.qty} {l.uom}</Text>
              <Text style={[s.td, s.c5]}>{money(l.rate)}</Text>
              <Text style={[s.td, s.c6]}>{l.gstRate ?? "—"}</Text>
              <Text style={[s.td, s.c7]}>{money(l.lineTotal ?? l.taxableValue)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          <View style={s.totalsBox}>
            <View style={s.totRow}><Text style={{ color: muted }}>Taxable value</Text><Text>{money(doc.totals?.taxable)}</Text></View>
            {Number(doc.totals?.igst ?? 0) > 0 ? (
              <View style={s.totRow}><Text style={{ color: muted }}>IGST</Text><Text>{money(doc.totals?.igst)}</Text></View>
            ) : (
              <>
                <View style={s.totRow}><Text style={{ color: muted }}>CGST</Text><Text>{money(doc.totals?.cgst)}</Text></View>
                <View style={s.totRow}><Text style={{ color: muted }}>SGST</Text><Text>{money(doc.totals?.sgst)}</Text></View>
              </>
            )}
            <View style={[s.totRow, s.grand]}><Text>Grand total</Text><Text>{money(doc.totals?.grand)}</Text></View>
          </View>
        </View>

        {model.amountInWords ? <Text style={s.words}>{model.amountInWords}</Text> : null}

        {model.terms ? (
          <View style={s.terms}>
            <Text style={s.sectionTitle}>Terms</Text>
            {Object.entries(model.terms).map(([k, v]) => (
              <Text key={k} style={{ fontSize: 8, marginTop: 2, color: ink }}>
                {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: {String(v)}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text style={s.signBox}>Authorised signatory</Text>
          {qr ? (
            <View style={s.qrBox}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not DOM */}
              <Image src={qr} style={{ width: 52, height: 52 }} />
              <Text style={s.qrLabel}>Verify this document{model.verify?.hash ? `\n${model.verify.hash.slice(0, 16)}…` : ""}</Text>
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}

export async function downloadDocumentPdf(model: RenderModel, filename?: string) {
  const element = await PoPdf({ model });
  const blob = await pdf(element).toBlob();
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? `${model.document.number?.replaceAll("/", "-") ?? "document"}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
