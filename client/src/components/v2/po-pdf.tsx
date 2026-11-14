"use client";

// PO/PI PDF rendered client-side from GET /documents/:id/render-model
// (06 §5.4). The server already resolved entity, supplier, tax summary,
// amount-in-words and the verify hash — the browser only draws them.

import { Document, Page, Text, View, StyleSheet, Image, pdf } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { RenderModel, DocView } from "@/lib/api/v2";

const ink = "#1d1a16";
const muted = "#6b6357";
const line = "#e3ddd4";
const soft = "#faf7f2";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 8.5, color: ink, fontFamily: "Helvetica" },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottom: 1.5, borderColor: ink, paddingBottom: 10 },
  legalName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 7.5, color: muted, marginTop: 2 },
  docTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right", letterSpacing: 1 },
  docMeta: { fontSize: 8.5, textAlign: "right", color: muted, marginTop: 3 },
  docNo: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right", marginTop: 3 },
  strip: { flexDirection: "row", gap: 18, marginTop: 10, paddingVertical: 6, borderBottom: 0.5, borderColor: line },
  stripLabel: { fontSize: 6.5, color: muted, textTransform: "uppercase", letterSpacing: 0.6 },
  stripValue: { fontSize: 8.5, marginTop: 1.5 },
  parties: { flexDirection: "row", gap: 10, marginTop: 12 },
  party: { flex: 1, border: 1, borderColor: line, borderRadius: 3, padding: 8 },
  partyLabel: { fontSize: 6.5, color: muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  partyName: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  partyMeta: { fontSize: 7.5, color: muted, marginTop: 2 },
  table: { marginTop: 12, border: 1, borderColor: line },
  tr: { flexDirection: "row", borderBottom: 0.5, borderColor: line },
  th: { fontSize: 7, fontFamily: "Helvetica-Bold", color: muted, textTransform: "uppercase" },
  td: { fontSize: 8 },
  c1: { width: "5%", padding: 5 }, c2: { width: "35%", padding: 5 }, c3: { width: "10%", padding: 5 },
  c4: { width: "7%", padding: 5 }, c5: { width: "9%", padding: 5, textAlign: "right" }, c6: { width: "12%", padding: 5, textAlign: "right" },
  c7: { width: "8%", padding: 5, textAlign: "right" }, c8: { width: "14%", padding: 5, textAlign: "right" },
  totalsWrap: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  words: { fontSize: 8, fontStyle: "italic", color: muted, maxWidth: 300 },
  totalsBox: { width: 200, borderTop: 1.5, borderColor: ink },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 10, borderTop: 0.5, borderColor: line, marginTop: 3, paddingTop: 3 },
  panels: { flexDirection: "row", gap: 10, marginTop: 12 },
  panel: { flex: 1, border: 1, borderColor: line, borderRadius: 3, padding: 8 },
  panelTitle: { fontSize: 7, fontFamily: "Helvetica-Bold", textTransform: "uppercase", color: muted, marginBottom: 4 },
  kv: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  terms: { marginTop: 12, borderTop: 0.5, borderColor: line, paddingTop: 8 },
  term: { fontSize: 7.5, marginTop: 2, color: ink },
  footer: { position: "absolute", bottom: 28, left: 36, right: 36 },
  signRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  signBox: { borderTop: 1, borderColor: ink, paddingTop: 4, width: 140, fontSize: 7.5, color: muted, textAlign: "center" },
  signName: { fontSize: 7, color: muted, textAlign: "center", marginTop: 2 },
  qrBox: { alignItems: "center" },
  qrLabel: { fontSize: 6, color: muted, marginTop: 3, textAlign: "center" },
});

const money = (v?: string | number | null) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const titleCase = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()).trim();
const TERM_LABEL: Record<string, string> = {
  paymentTerms: "Payment terms", creditDays: "Credit days", advancePct: "Advance",
  deliveryTerms: "Delivery", expectedDelivery: "Expected delivery", inspection: "Inspection",
  warranty: "Warranty", packing: "Packing", ldClause: "Liquidated damages", freightTerms: "Freight",
};
const TERMS_FIXED = [
  "The bill and delivery challan must clearly mention this purchase order number.",
  "The invoice must state the applicable HSN/SAC codes as required under GST law.",
  "Original signed invoice and relevant documents must accompany the material at delivery.",
  "If nothing contrary is heard within 24 hours of receipt, this order is treated as accepted.",
];

export async function PoPdf({ model }: { model: RenderModel }) {
  const doc = model.document as DocView;
  const qr = model.verify?.url ? await QRCode.toDataURL(model.verify.url, { margin: 0, width: 120 }) : null;
  const entity = model.entity;
  const supplier = model.supplier;
  const terms = (model.terms ?? doc.terms ?? {}) as Record<string, unknown>;
  const billing = entity?.addresses?.billing;
  const supplierAddr = supplier?.addresses?.[0];
  const shipTo = doc.shipTo ?? entity?.addresses?.shipping?.[0];
  const gst = supplier?.gstins?.[0]?.gstin ?? doc.seller?.gstin;
  const payKeys = ["paymentTerms", "creditDays", "advancePct"];
  const delKeys = ["deliveryTerms", "expectedDelivery", "inspection", "warranty", "packing", "ldClause", "freightTerms"];
  const pick = (keys: string[]) => keys.filter((k) => terms[k] != null && terms[k] !== "");
  const restTerms = Object.keys(terms).filter((k) => ![...payKeys, ...delKeys, "termsList"].includes(k) && terms[k] != null && terms[k] !== "");
  const termsList = Array.isArray(terms.termsList) ? (terms.termsList as string[]) : TERMS_FIXED;
  const approver = [...(doc.approvals ?? [])].reverse().find((a) => a.action === "approve" || a.role);

  const kv = (k: string, v: unknown, suffix = "") => (
    <View style={s.kv} key={k}>
      <Text style={{ color: muted }}>{TERM_LABEL[k] ?? titleCase(k)}</Text>
      <Text>{String(v)}{suffix}</Text>
    </View>
  );

  return (
    <Document title={`${doc.number ?? "Purchase order"}`} author={entity?.legalName ?? "Satya"}>
      <Page size="A4" style={s.page}>
        {/* letterhead */}
        <View style={s.head}>
          <View style={{ maxWidth: "62%" }}>
            <Text style={s.legalName}>{entity?.tradeName ?? entity?.legalName ?? "Entity"}</Text>
            {entity?.legalName && entity.legalName !== entity.tradeName ? <Text style={s.meta}>{entity.legalName}</Text> : null}
            {billing ? <Text style={s.meta}>{[billing.line1, billing.city, billing.state, billing.pin].filter(Boolean).join(", ")}</Text> : null}
            <Text style={s.meta}>
              {entity?.gstin ? `GSTIN ${entity.gstin}` : ""}{entity?.pan ? `   PAN ${entity.pan}` : ""}{entity?.cin ? `   CIN ${entity.cin}` : ""}
            </Text>
          </View>
          <View>
            <Text style={s.docTitle}>PURCHASE ORDER</Text>
            <Text style={s.docNo}>{doc.number ?? "Draft"}</Text>
            <Text style={s.docMeta}>Date: {doc.date}{doc.fy ? ` · FY ${doc.fy}` : ""}</Text>
            <Text style={s.docMeta}>Currency: {doc.currency ?? "INR"}{doc.revision ? ` · Rev R${doc.revision}` : ""}</Text>
          </View>
        </View>

        {/* meta strip */}
        <View style={s.strip}>
          <View><Text style={s.stripLabel}>Ref no.</Text><Text style={s.stripValue}>{doc.externalRef ?? "—"}</Text></View>
          <View><Text style={s.stripLabel}>PO date</Text><Text style={s.stripValue}>{doc.date}</Text></View>
          <View><Text style={s.stripLabel}>Place of supply</Text><Text style={s.stripValue}>{doc.placeOfSupply ? `State code ${doc.placeOfSupply}` : "—"}</Text></View>
          <View><Text style={s.stripLabel}>Payment terms</Text><Text style={s.stripValue}>{terms.paymentTerms ? String(terms.paymentTerms) : supplier?.paymentTermsDays ? `${supplier.paymentTermsDays} days` : "—"}</Text></View>
        </View>

        {/* parties */}
        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.partyLabel}>Supplier (from)</Text>
            <Text style={s.partyName}>{supplier?.legalName ?? doc.seller?.name ?? "—"}</Text>
            {supplierAddr ? <Text style={s.partyMeta}>{[supplierAddr.line1, supplierAddr.city, supplierAddr.pin].filter(Boolean).join(", ")}</Text> : null}
            <Text style={s.partyMeta}>{gst ? `GSTIN ${gst}` : ""}{supplier?.pan ? ` · PAN ${supplier.pan}` : ""}</Text>
            {supplier?.udyam?.category ? <Text style={s.partyMeta}>{supplier.udyam.category} enterprise · MSMED registered</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.partyLabel}>Buyer (bill to)</Text>
            <Text style={s.partyName}>{doc.buyer?.name ?? entity?.legalName ?? "—"}</Text>
            {billing ? <Text style={s.partyMeta}>{[billing.line1, billing.city, billing.state, billing.pin].filter(Boolean).join(", ")}</Text> : null}
            <Text style={s.partyMeta}>GSTIN {doc.buyer?.gstin ?? entity?.gstin ?? "—"}</Text>
          </View>
          <View style={s.party}>
            <Text style={s.partyLabel}>Ship to</Text>
            <Text style={s.partyName}>{shipTo?.label ?? (shipTo ? "Delivery site" : "Same as billing")}</Text>
            {shipTo ? <Text style={s.partyMeta}>{[shipTo.line1, shipTo.city, shipTo.state, shipTo.pin].filter(Boolean).join(", ")}</Text> : null}
            {shipTo?.contact ? <Text style={s.partyMeta}>{shipTo.contact}</Text> : null}
          </View>
        </View>

        {/* lines */}
        <View style={s.table}>
          <View style={[s.tr, { backgroundColor: soft }]}>
            <Text style={[s.th, s.c1]}>#</Text><Text style={[s.th, s.c2]}>Particulars</Text>
            <Text style={[s.th, s.c3]}>HSN</Text><Text style={[s.th, s.c4]}>UOM</Text>
            <Text style={[s.th, s.c5]}>Qty</Text><Text style={[s.th, s.c6]}>Rate</Text>
            <Text style={[s.th, s.c7]}>GST</Text><Text style={[s.th, s.c8]}>Amount</Text>
          </View>
          {(doc.lines ?? []).map((l) => (
            <View key={l.lineNo} style={s.tr}>
              <Text style={[s.td, s.c1]}>{l.lineNo}</Text>
              <View style={s.c2}>
                <Text style={s.td}>{l.description}</Text>
                {l.scheduleDate ? <Text style={{ fontSize: 6.5, color: muted, marginTop: 1 }}>Delivery by {l.scheduleDate}</Text> : null}
              </View>
              <Text style={[s.td, s.c3]}>{l.hsn ?? "—"}</Text>
              <Text style={[s.td, s.c4]}>{l.uom ?? "—"}</Text>
              <Text style={[s.td, s.c5]}>{l.qty}</Text>
              <Text style={[s.td, s.c6]}>{money(l.rate)}</Text>
              <Text style={[s.td, s.c7]}>{l.gstRate ? `${l.gstRate}%` : "—"}</Text>
              <Text style={[s.td, s.c8]}>{money(l.lineTotal ?? l.taxableValue ?? (Number(l.qty ?? 0) * Number(l.rate ?? 0)))}</Text>
            </View>
          ))}
          {(doc.charges ?? []).map((c, i) => (
            <View key={`ch-${i}`} style={s.tr}>
              <Text style={[s.td, s.c1]}></Text>
              <Text style={[s.td, s.c2, { color: muted }]}>{c.label ?? "Additional charge"}</Text>
              <Text style={[s.td, s.c3]}></Text><Text style={[s.td, s.c4]}></Text><Text style={[s.td, s.c5]}></Text>
              <Text style={[s.td, s.c6]}></Text><Text style={[s.td, s.c7]}></Text>
              <Text style={[s.td, s.c8]}>{money(c.amount)}</Text>
            </View>
          ))}
        </View>

        {/* totals + words */}
        <View style={s.totalsWrap}>
          <View style={{ maxWidth: "55%" }}>
            {model.amountInWords ? <Text style={s.words}>{model.amountInWords}</Text> : null}
          </View>
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

        {/* payment + delivery panels */}
        {(pick(payKeys).length > 0 || pick(delKeys).length > 0 || restTerms.length > 0 || supplier?.bankAccounts?.length) && (
          <View style={s.panels}>
            <View style={s.panel}>
              <Text style={s.panelTitle}>Payment details</Text>
              {pick(payKeys).map((k) => kv(k, terms[k], k === "advancePct" ? "%" : k === "creditDays" ? " days" : ""))}
              {supplier?.bankAccounts?.[0] ? kv("vendorBank", `${supplier.bankAccounts[0].masked ?? ""} ${supplier.bankAccounts[0].ifsc ?? ""}`.trim()) : null}
            </View>
            <View style={s.panel}>
              <Text style={s.panelTitle}>Delivery &amp; logistics</Text>
              {pick(delKeys).map((k) => kv(k, terms[k], k === "warranty" && /^\d+$/.test(String(terms[k])) ? " months" : ""))}
              {restTerms.map((k) => kv(k, terms[k]))}
            </View>
          </View>
        )}

        {/* terms */}
        <View style={s.terms}>
          <Text style={s.panelTitle}>Terms &amp; conditions</Text>
          {termsList.map((t, i) => <Text key={i} style={s.term}>{i + 1}. {t}</Text>)}
        </View>

        {/* footer: signatories + verify QR */}
        <View style={s.footer} fixed>
          <View style={s.signRow}>
            <View>
              <Text style={s.signBox}>Prepared by</Text>
              <Text style={s.signName}>{doc.createdBy ?? ""}</Text>
            </View>
            <View>
              <Text style={s.signBox}>Approved by</Text>
              <Text style={s.signName}>{approver?.actor ?? ""}</Text>
            </View>
            <View>
              <Text style={s.signBox}>For {entity?.legalName ?? "the entity"}</Text>
              <Text style={s.signName}>Authorised signatory</Text>
            </View>
            {qr ? (
              <View style={s.qrBox}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not DOM */}
                <Image src={qr} style={{ width: 48, height: 48 }} />
                <Text style={s.qrLabel}>Verify this document{model.verify?.hash ? `\n${model.verify.hash.slice(0, 16)}…` : ""}</Text>
              </View>
            ) : null}
          </View>
          {entity?.letterhead?.footerText ? <Text style={[s.meta, { marginTop: 8, textAlign: "center" }]}>{entity.letterhead.footerText}</Text> : null}
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
