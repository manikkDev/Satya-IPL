// Typed v2 API surface. Every call checks NEXT_PUBLIC_USE_MOCKS first so UI
// work never waits on the backend (docs/plan/06 §8, 00 §7.7).

import { fetchJson } from "@/lib/api/client";
import { SERVER_URL } from "@/utils/commonHelper";
import { mocksEnabled } from "@/lib/flags";
import type { Today, GraphPayload, Page, Finding } from "@/lib/api/types";
import { mockToday, flagshipGraph, mockEntities } from "@/lib/mocks/flagship";
import {
  mockOrders, mockOrderDetail, mockInvestigations, mockCaseDetail,
  mockDrafts, mockDraftDetail, mockPayments, mockPaymentWorkbench,
  mockSuppliers, mockCompliance, mockCopilotAnswer,
  type OrderDetail, type OrderListRow, type Draft, type DraftDetail,
} from "@/lib/mocks/data";

/** Uniform supplier row for the UI — covers both mock and real API shapes. */
export type SupplierRow = {
  id: string; name: string; legalName?: string; tradeNames?: string[]; gstin: string;
  msme?: string; msmeFlag?: boolean;
  udyam?: { number: string; category: string; verifiedAt?: string };
  paymentTermsDays?: number;
  pan?: string;
  gstins?: { gstin: string; stateCode?: string; status?: string }[];
  bankAccounts?: {
    id?: string; masked?: string; accountMasked?: string; ifsc?: string;
    holderName?: string; accountHash?: string; status?: string;
    proposedBy?: string; approvedBy?: string[];
  }[];
  contacts?: { name?: string; email?: string; phone?: string }[];
  addresses?: { label?: string; line1?: string; city?: string; stateCode?: string; pin?: string }[];
  tags?: string[];
  openValue?: { amount: string; currency: string };
  overdue?: { amount: string; currency: string };
  issueCount: number;
};
type SuppliersPage = Page<SupplierRow>;
type PaymentsPage = typeof mockPayments;
type Compliance = typeof mockCompliance;
type InvestigationsPage = typeof mockInvestigations;

/** Shape returned by GET /api/v2/suppliers (B). */
type SupplierApi = {
  id: string; legalName: string; tradeNames?: string[];
  gstins?: { gstin: string; stateCode?: string; status?: string }[];
  pan?: string; udyam?: { number: string; category: "micro" | "small" | "medium"; verifiedAt?: string };
  msme?: boolean; paymentTermsDays?: number;
  bankAccounts?: {
    id?: string; accountMasked?: string; masked?: string; ifsc?: string;
    holderName?: string; accountHash?: string; status?: string;
    proposedBy?: string; approvedBy?: string[];
  }[];
  contacts?: { name?: string; email?: string; phone?: string }[];
  addresses?: { label?: string; line1?: string; city?: string; stateCode?: string; pin?: string }[];
  tags?: string[];
};

/** API supplier master record → the uniform row the UI renders. */
const normalizeSupplier = (s: SupplierApi): SupplierRow => ({
  id: s.id,
  name: s.legalName,
  legalName: s.legalName,
  tradeNames: s.tradeNames,
  gstin: s.gstins?.[0]?.gstin ?? "",
  msme: s.udyam?.category,
  msmeFlag: s.msme ?? Boolean(s.udyam?.category),
  udyam: s.udyam,
  paymentTermsDays: s.paymentTermsDays,
  pan: s.pan,
  gstins: s.gstins,
  bankAccounts: s.bankAccounts,
  contacts: s.contacts,
  addresses: s.addresses,
  tags: s.tags,
  openValue: undefined,
  overdue: undefined,
  issueCount: 0,
});

/** Shape returned by GET /api/v2/me (B). */
export type MeResponse = {
  user: { id: string; name: string; email: string; platformRole?: string };
  memberships: { groupId: string; entityId: string; roles: string[] }[];
  activeGroup: { id: string; name: string; plan?: string };
  entities: typeof mockEntities;
  permissions: Record<string, string[]>;
};

/** Shape returned by GET /api/v2/hsn/search (B). */
export type HsnResult = {
  code: string; description: string; chapter?: string;
  rate: string | null; cessRate?: string | null;
  effectiveFrom: string | null; notificationRef: string | null;
  conditional?: boolean;
};

/** B's document `view` — the raw BusinessDocument fields. */
export type DocView = {
  id: string; type: string; status: string; number?: string | null;
  externalRef?: string | null; date: string; entityId: string; supplierId?: string;
  fy?: string; revision?: number; issuedAt?: string; createdBy?: string; irn?: string;
  seller?: { name?: string; gstin?: string; stateCode?: string; address?: string }; buyer?: { name?: string; gstin?: string; stateCode?: string };
  shipTo?: { label?: string; line1?: string; city?: string; state?: string; stateCode?: string; pin?: string; contact?: string };
  placeOfSupply?: string; currency?: string;
  lines?: { lineNo: number; description: string; hsn?: string; qty?: string; uom?: string; rate?: string; taxableValue?: string; gstRate?: string; lineTotal?: string; cgst?: string; sgst?: string; igst?: string; scheduleDate?: string; brand?: string; mfr?: string }[];
  charges?: { label?: string; amount?: string }[];
  totals?: { taxable?: string; cgst?: string; sgst?: string; igst?: string; cess?: string; roundOff?: string; grand?: string };
  terms?: Record<string, unknown>; approvals?: { actor?: string; action?: string; role?: string; comment?: string; at?: string }[];
  contentHash?: string | null;
};

export type DocLink = { fromId: string; toId: string; kind: string; certainty: string; basis?: string };

export type LifecycleLine = {
  lineNo: number; ordered: string; received: string; accepted: string;
  rejected?: string; returned?: string; invoicedQty?: string; invoicedValue?: string; paidValue?: string;
};

export type RenderModel = {
  document: DocView;
  entity: { legalName?: string; tradeName?: string; code?: string; gstin?: string; pan?: string; cin?: string; stateCode?: string; addresses?: { billing?: { line1?: string; city?: string; state?: string; pin?: string }; shipping?: { label?: string; line1?: string; city?: string; state?: string; pin?: string; contact?: string }[] } | null; letterhead?: { footerText?: string } | null } | null;
  supplier: {
    id: string; legalName: string; gstins?: { gstin: string; stateCode?: string }[];
    contacts?: { name?: string; email?: string; phone?: string }[];
    addresses?: { label?: string; line1?: string; city?: string; stateCode?: string; pin?: string }[];
    pan?: string; udyam?: { number?: string; category?: string }; paymentTermsDays?: number;
    bankAccounts?: { masked?: string; ifsc?: string }[];
  } | null;
  taxSummary: unknown[]; amountInWords: string | null; terms: Record<string, unknown> | null;
  verify: { url: string; hash: string } | null;
};

export type OrderActivity = {
  approvals: { actor?: string; action?: string; role?: string; comment?: string; at?: string }[];
  audit: { id: string; action: string; event: string; actor?: string; actorRole?: string; at?: string; statusCode?: number }[];
  decisions: { id: string; action?: string; reason?: string; scope?: unknown; findingId?: string; actor?: string; actorRole?: string; createdAt?: string }[];
  amendments: { id: string; number?: string; type?: string; status?: string; revision?: number; date?: string; supersedes?: string }[];
  meta: { createdBy?: string; createdAt?: string; issuedAt?: string | null; revision?: number; status?: string; contentHash?: string | null };
};

export type FileDoc = { id: string; filename?: string; mime?: string; sha256?: string; entityId?: string; status?: string };

export type EntityPolicy = {
  entityId?: string;
  tolerance?: { priceAbs?: string; pricePct?: string; qtyPctByUom?: Record<string, string> };
  msme?: { defaultDays?: number };
  approvals?: { requireMakerChecker?: boolean };
  autoConfirmHighConfidence?: boolean;
};

export type ItemRow = { id: string; code: string; description: string; hsn?: string; uom?: string; gstRate?: string };

export type IngestDraft = {
  id: string; fileId: string; status: "queued" | "parsing" | "extracting" | "needs_review" | "confirmed" | "failed";
  detectedType?: string; fields?: Record<string, { value?: string; confidence?: "high" | "check" | "low"; source?: string; quote?: string } | string>;
  lines?: { lineNo: number; description: string; qty?: string; uom?: string; rate?: string; amount?: string }[];
  issues?: { code?: string; message: string }[]; suggestions?: { supplierId?: string; supplierName?: string; poId?: string; poNumber?: string };
  confirmedDocumentId?: string; edits?: { actor: string; at: string; changed: string[] }[];
};

/** Real findings arrive as {code,severity,certainty,status,data:{message,evidence,amount}};
 *  UI expects {title,explanation,evidence[],calculation[],whatResolvesIt,exposure}.
 *  docNames resolves internal doc_* ids inside messages to real document numbers. */
const shortDocId = (id: string) => {
  const m = id.match(/^doc_bpi_([a-z]+)_(\d+)(?:_\d+)?$/);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : id.replace(/^doc_/, "");
};
const cleanText = (text: string, docNames?: Map<string, string>) =>
  text
    .replace(/doc_[\w]+/g, (id) => docNames?.get(id) ?? shortDocId(id))
    .replace(/invoiced (\d+(?:\.\d+)?) exceeds delivered (\d+(?:\.\d+)?)/gi, (_m, a, b) => `invoiced ${a} units, only ${b} delivered`)
    .replace(/(\d+(?:\.\d+)?) units delivered, none invoiced/gi, (_m, n) => `${n} units delivered, no invoice yet`)
    .replace(/\b(\d{4,}\.\d{2})\b/g, (_m, n) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);

const normalizeFinding = (f: Record<string, unknown>, index = 0, docNames?: Map<string, string>): Finding => {
  const d = (f.data ?? {}) as Record<string, unknown>;
  const message = cleanText(String(d.message ?? f.title ?? f.message ?? "").trim(), docNames);
  const title = cleanText((f.title as string) || message || String(f.code ?? "Finding").replaceAll("_", " ").toLowerCase(), docNames);
  const rawEvidence = (f.evidence ?? d.evidence ?? []) as Record<string, unknown>[];
  return {
    id: String(f.id ?? f._id ?? `${f.caseId ?? "case"}:${f.code ?? "finding"}:${index}`),
    caseId: f.caseId,
    code: (f.code ?? d.code) as string,
    severity: String(f.severity ?? d.severity ?? "info").toLowerCase(),
    certainty: String(f.certainty ?? d.certainty ?? "POSSIBLE").toUpperCase(),
    status: (f.status ?? "open") as string,
    title,
    explanation: cleanText((f.explanation as string) || message || title, docNames),
    whatResolvesIt: (f.whatResolvesIt as string) || (d.resolution as string) || "",
    exposure: (f.exposure ?? (d.amount ? { amount: d.amount, currency: "INR" } : undefined)) as Finding["exposure"],
    evidence: rawEvidence.map((e, i) => ({
      id: String(e.id ?? `ev-${i}`),
      documentId: String(e.documentId ?? e.docId ?? ""),
      documentType: String(e.documentType ?? "document"),
      field: String(e.field ?? ""),
      value: e.value as string | undefined,
      locator: (e.locator ?? { kind: "manual" }) as never,
      observedAt: String(e.observedAt ?? f.createdAt ?? ""),
    })) as Finding["evidence"],
    calculation: (Array.isArray(f.calculation) ? f.calculation : Array.isArray(d.calculation) ? d.calculation : []) as Finding["calculation"],
    candidates: (f.candidates ?? d.candidates) as Finding["candidates"],
    harmlessVariance: f.harmlessVariance as boolean | undefined,
  } as unknown as Finding;
};

/** Engine doc types → graph lane; neo4j nodes only carry `type`. */
const typeToStage = (type: string): GraphPayload["nodes"][number]["stage"] =>
  type === "FINDING"
    ? "finding"
    : type === "SUPPLIER" || type === "ENTITY"
      ? "party"
      : type === "PO" || type === "PI_IN" || type === "PI_OUT"
        ? "order"
        : type === "DELIVERY_CHALLAN" || type === "LR"
          ? "dispatch"
          : type === "GRN" || type === "DELIVERY"
            ? "receipt"
            : type === "QC"
              ? "inspection"
              : type === "PAYMENT_OUT" || type === "PAYMENT_IN" || type === "ADVANCE_OUT" || type === "REMITTANCE_ADVICE" || type === "BANK_LINE"
                ? "payment"
                : type === "GSTR2B_ENTRY" || type === "IMS_ACTION" || type === "CREDIT_NOTE_IN" || type === "CREDIT_NOTE_OUT"
                  ? "tax"
                  : "invoice";

/** B's /cases/:id/graph payload (neo4j or snapshot fallback) → GraphPayload.
 *  Neo4j projections lack timeline/label/explanation — fill honest defaults. */
const normalizeGraph = (g: GraphPayload & { snapshotId?: string }): GraphPayload => ({
  nodes: (g.nodes ?? []).map((n) => ({
    ...n,
    stage: n.stage ?? typeToStage(String(n.type ?? "")),
    label: n.label ?? (n as unknown as Record<string, unknown>).number ?? n.id,
    type: (n.type ?? "OTHER") as GraphPayload["nodes"][number]["type"],
  })),
  edges: (g.edges ?? []).map((e, i) => ({
    ...e,
    id: e.id ?? `e-${e.source}-${e.target}-${e.kind ?? i}`,
    kind: (e.kind ?? (e as unknown as Record<string, unknown>).type ?? "LINKED") as string,
    label: e.label ?? String(e.kind ?? "linked").replaceAll("_", " ").toLowerCase(),
    explanation: e.explanation ?? ((e as unknown as Record<string, unknown>).basis as string) ?? "",
    certainty: e.certainty ?? "CONFIRMED",
    evidenceIds: e.evidenceIds ?? [],
  })),
  timeline: g.timeline ?? [],
  source: g.source ?? "snapshot",
});

const moneyOf = (v: unknown, currency = "INR") =>
  v && typeof v === "object" ? (v as { amount: string; currency: string }) : v != null ? { amount: String(v), currency } : undefined;

/** Engine emits balances as {recordedPayable, evidenceSupportedPayable,
 *  disputedExposure} flat decimal strings; the page reads
 *  {supported, disputed, recorded} Money objects. Accepts both. */
const normalizeBalances = (raw: Record<string, unknown> | undefined) => {
  if (!raw) return undefined;
  const supported = moneyOf(raw.supported ?? raw.evidenceSupportedPayable ?? raw.supportedOutstanding);
  const recorded = moneyOf(raw.recorded ?? raw.recordedPayable ?? raw.recordedOutstanding ?? raw.canonicalOutstanding);
  const disputed = moneyOf(raw.disputed ?? raw.disputedExposure);
  if (!supported && !recorded && !disputed) return undefined;
  const d = disputed ?? { amount: Math.max(0, Number(recorded?.amount ?? 0) - Number(supported?.amount ?? 0)).toFixed(2), currency: "INR" };
  return {
    supported: supported ?? { amount: "0.00", currency: "INR" },
    recorded: recorded ?? { amount: "0.00", currency: "INR" },
    disputed: d,
  };
};

/** Engine recommendation.reasons are finding codes — present them as
 *  the finding titles (or readable code words), deduplicated. */
const prettifyReasons = (reasons: unknown, findings: Finding[]): string[] => {
  const titles = new Map(findings.map((f) => [f.code, f.title]));
  return [...new Set((Array.isArray(reasons) ? reasons : []).map(String))].map(
    (r) => titles.get(r) ?? r.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
  );
};

export type DashboardSummary = {
  openValue: string; casesByStatus: Record<string, number>;
  issuesBySeverity: Record<string, number>; findingsByCertainty: Record<string, number>;
  openInvestigations: number;
  aging: Record<"0-30" | "31-60" | "61-90" | "90+", number>;
  spendBySupplier: { supplierId: string; value: string; docs: number }[];
  monthlySeries: { month: string; value: string; docs: number }[];
  unallocatedPayments: { documentId: string; amount: string; allocated: string; counterparty?: string; date?: string; utr?: string; mode?: string }[];
  recentDecisions: { id?: string; action?: string; reason?: string; actor?: string; createdAt?: string; caseId?: string }[];
};

export type ComplianceSummary = {
  msme45: { count: number; items: { documentId?: string; supplier?: string; dueDate?: string; amount?: unknown }[] };
  rule37: { count: number; items: { documentId?: string; itcAtRisk?: string }[]; itcAtRisk: string };
  tdsSummary: Record<string, number>;
  itcSummary: { total: string; blockedOrAtRisk: string };
  einvoiceCoverage: { withIrn: number; invoices: number; pct: number };
  creditNotesUnapplied: { count: number; items: { documentId: string; number?: string; date?: string; total?: string }[] };
  note?: string;
};

const mock = <T>(value: T): Promise<T> => Promise.resolve(structuredClone(value));
const qs = (params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  return query ? `?${query}` : "";
};

export const v2 = {
  today: (entityId?: string): Promise<Today> =>
    mocksEnabled()
      ? mock(mockToday)
      : fetchJson<Today>(`/api/v2/dashboard/today${entityId ? `?entityId=${encodeURIComponent(entityId)}` : ""}`).then((t) => ({
          ...t,
          topFindings: (t.topFindings ?? []).map((f, i) => normalizeFinding(f as unknown as Record<string, unknown>, i)),
        })),

  orders: (params: Record<string, string> = {}): Promise<Page<OrderListRow>> =>
    mocksEnabled()
      ? mock({ items: mockOrders, nextCursor: null, total: mockOrders.length })
      : fetchJson<Page<OrderListRow>>(`/api/v2/orders${qs(params)}`),

  order: (id: string): Promise<OrderDetail> =>
    mocksEnabled()
      ? mock(mockOrderDetail)
      : fetchJson<DocView & { links: DocLink[]; lifecycle: LifecycleLine[] | null; caseId: string | null }>(
          `/api/v2/documents/${encodeURIComponent(id)}`,
        ).then(async (doc) => {
          // B4 returns DocumentLinks but not the linked docs themselves —
          // fetch each counterpart to populate the Documents tab.
          const linkedIds = [...new Set(doc.links.flatMap((l) => [l.fromId, l.toId]))].filter((id2) => id2 !== doc.id);
          const linkedDocs = await Promise.all(
            linkedIds.slice(0, 20).map((id2) => v2.document(id2).catch(() => null)),
          );
          const computedGrand = (doc.lines ?? []).reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.rate ?? 0), 0);
          const docWithTotals = { ...doc, totals: doc.totals ?? (computedGrand ? { grand: computedGrand.toFixed(2) } : doc.totals) };
          return {
          order: docWithTotals as unknown as OrderDetail["order"],
          lifecycle: (((Array.isArray(doc.lifecycle) ? doc.lifecycle : (doc.lifecycle as { lines?: LifecycleLine[] } | null)?.lines) ?? doc.lines?.map((l) => ({
            lineNo: l.lineNo, ordered: l.qty ?? "0", received: "0", accepted: "0", rejected: "0",
            invoiced: "0", paid: "0", open: l.qty ?? "0",
          }))) ?? []).map((line) => {
            const raw = line as Record<string, unknown> & { lineNo: number };
            const src = doc.lines?.find((l) => l.lineNo === raw.lineNo);
            return {
              lineNo: raw.lineNo,
              description: src?.description ?? "",
              ordered: String(raw.ordered ?? "0"), received: String(raw.received ?? "0"),
              accepted: String(raw.accepted ?? "0"), rejected: String(raw.rejected ?? "0"),
              invoiced: String(raw.invoicedQty ?? raw.invoiced ?? "0"),
              paid: String(raw.paidValue ?? raw.paid ?? "0"),
              open: String(raw.open ?? Math.max(0, Number(raw.ordered ?? 0) - Number(raw.received ?? 0))),
            };
          }),
          schedule: (doc.lines ?? [])
            .map((l, i) => {
              const sd = (l as { scheduleDate?: string }).scheduleDate;
              if (!sd) return null;
              const receivedQty = 0;
              return {
                batch: `Batch ${i + 1}`, qty: l.qty ?? "0", dueDate: sd,
                receivedQty: String(receivedQty),
                overdue: new Date(`${sd}T00:00:00`).getTime() < Date.now() && receivedQty < Number(l.qty ?? 0),
              };
            })
            .filter(Boolean) as OrderDetail["schedule"],
          documents: linkedDocs.filter((d): d is NonNullable<typeof d> => d !== null).map((d) => ({
            id: d.id,
            type: d.type,
            number: d.number ?? d.externalRef ?? d.id,
            date: d.date,
            amount: d.totals?.grand ? { amount: d.totals.grand, currency: "INR" } : undefined,
            status: d.status,
          })),
          graph: {
            nodes: [
              {
                id: doc.id, type: doc.type, label: doc.number ?? doc.externalRef ?? doc.id,
                stage: "order" as const, status: doc.status, date: doc.date,
                amount: doc.totals?.grand ? { amount: doc.totals.grand, currency: "INR" } : undefined,
              },
              ...[...new Set(doc.links.flatMap((l) => [l.fromId, l.toId]))]
                .filter((id2) => id2 !== doc.id)
                .map((id2) => ({
                  id: id2, type: "OTHER" as const, label: id2,
                  stage: "document" as const, status: "unknown",
                })),
            ],
            edges: doc.links.map((link, i) => ({
              id: `e${i}`, source: link.fromId, target: link.toId, kind: link.kind,
              certainty: (link.certainty || "CONFIRMED") as "CONFIRMED", label: link.kind.replaceAll("_", " "),
              explanation: link.basis || link.kind, evidenceIds: [link.fromId, link.toId],
            })),
            timeline: [{ at: doc.date, nodeIds: [doc.id], edgeIds: [] }],
            source: "live" as const,
          },
          history: [] as OrderDetail["history"],
          caseId: doc.caseId ?? "",
        };
        }),

  cases: (params: Record<string, string> = {}): Promise<InvestigationsPage> =>
    mocksEnabled()
      ? mock(mockInvestigations)
      : fetchJson(`/api/v2/cases${qs(params)}`),

  reconcileCase: (id: string): Promise<{ job?: { id: string; status: string } }> =>
    fetchJson(`/api/v2/cases/${encodeURIComponent(id)}/reconcile`, { method: "POST", body: JSON.stringify({}) }),

  job: (id: string): Promise<{ id: string; status: string; result?: Record<string, unknown>; error?: string }> =>
    fetchJson(`/api/v2/jobs/${encodeURIComponent(id)}`),

  case: (id: string): Promise<typeof mockCaseDetail> =>
    mocksEnabled()
      ? mock(mockCaseDetail)
      : fetchJson<Record<string, unknown>>(`/api/v2/cases/${encodeURIComponent(id)}`).then((d) => {
          const snap = (d.snapshot ?? null) as Record<string, unknown> | null;
          const docNames = new Map(
            (Array.isArray(d.documents) ? d.documents : []).map((doc) => {
              const raw = doc as Record<string, unknown>;
              return [String(raw.id ?? ""), String(raw.number ?? raw.externalRef ?? raw.id ?? "")] as [string, string];
            }).filter(([k]) => k),
          );
          return {
            case: { id: d.id, title: d.title, status: d.status, kind: d.kind, subjectIds: d.subjectIds, entityId: d.entityId, groupId: d.groupId },
            snapshot: snap
              ? (() => {
                  const snapFindings = (Array.isArray(snap.findings) ? snap.findings : []).map((f, i) =>
                    normalizeFinding(f as Record<string, unknown>, i, docNames),
                  );
                  const rec = (snap.recommendation ?? null) as Record<string, unknown> | null;
                  return {
                    ...snap,
                    findings: snapFindings,
                    lines: (Array.isArray(snap.lines) ? snap.lines : []).map((l) => {
                      const r = l as Record<string, unknown>;
                      return {
                        lineNo: Number(r.lineNo ?? 0),
                        ordered: String(r.ordered ?? "0"),
                        received: String(r.received ?? "0"),
                        accepted: String(r.accepted ?? "0"),
                        rejected: String(r.rejected ?? "0"),
                        invoiced: String(r.invoiced ?? r.invoicedQty ?? "0"),
                        paid: String(r.paid ?? r.paidValue ?? "0"),
                        open: String(r.open ?? "0"),
                      };
                    }),
                    balances: normalizeBalances((snap.balances ?? snap.ledger) as Record<string, unknown> | undefined),
                    recommendation: rec
                      ? { ...rec, reasons: prettifyReasons(rec.reasons, snapFindings) }
                      : null,
                  };
                })()
              : null,
            documents: (Array.isArray(d.documents) ? d.documents : []).map((doc) => {
              const raw = doc as Record<string, unknown>;
              const totals = (raw.totals ?? {}) as Record<string, unknown>;
              return {
                ...raw,
                number: raw.number ?? raw.externalRef ?? raw.id,
                status: raw.status ?? "recorded",
                amount: moneyOf(raw.amount ?? totals.grand),
              };
            }),
            decisions: (Array.isArray(d.decisions) ? d.decisions : []).map((x) => {
              const raw = x as Record<string, unknown>;
              return {
                id: raw.id,
                action: raw.action ?? "DECIDED",
                reason: raw.reason ?? raw.note ?? raw.comment ?? "",
                actor: raw.actor ?? raw.actorName ?? raw.user ?? "—",
                role: raw.role ?? raw.actorRole ?? "team_member",
                createdAt: raw.createdAt ?? raw.at ?? "",
                scope: raw.scope,
              };
            }),
            findings: (Array.isArray(d.findings) ? d.findings : []).map((f, i) => normalizeFinding(f as Record<string, unknown>, i, docNames)),
          } as unknown as typeof mockCaseDetail;
        }),

  dashboardSummary: (): Promise<DashboardSummary> =>
    fetchJson<DashboardSummary>(`/api/v2/dashboard/summary`),

  complianceSummary: (): Promise<ComplianceSummary> =>
    fetchJson<ComplianceSummary>(`/api/v2/compliance/summary`),

  /** MSME 45-day list — supplier page reads `data.msme` rows. */
  compliance: (): Promise<{ msme: unknown[]; [k: string]: unknown }> =>
    mocksEnabled()
      ? mock({ msme: [] })
      : fetchJson<{ items?: unknown[]; msme?: unknown[] }>(`/api/v2/compliance/msme`)
        .then((d) => ({ ...d, msme: d.msme ?? d.items ?? [] })),

  findings: (params: Record<string, string> = {}): Promise<Page<Finding>> =>
    mocksEnabled()
      ? mock({ items: mockToday.topFindings, nextCursor: null, total: mockToday.topFindings.length })
      : fetchJson<Page<Record<string, unknown>>>(`/api/v2/findings${qs(params)}`).then((page) => ({
          ...page,
          items: page.items.map((f, i) => normalizeFinding(f as Record<string, unknown>, i)),
        })),

  graph: (caseId: string, asOf?: string): Promise<GraphPayload> =>
    mocksEnabled()
      ? mock(flagshipGraph)
      : fetchJson<GraphPayload>(`/api/v2/cases/${encodeURIComponent(caseId)}/graph${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`).then(
          (g) => normalizeGraph(g),
        ),

  drafts: (params: Record<string, string> = {}): Promise<{ items: Draft[] }> =>
    mocksEnabled()
      ? mock({ items: mockDrafts })
      : fetchJson<{ items: IngestDraft[]; nextCursor: string | null }>(`/api/v2/ingest/drafts${qs(params)}`).then(
          (page) => ({
            items: page.items.map((draft) => ({
              id: draft.id,
              filename: draft.detectedType ? `${draft.detectedType.replaceAll("_", " ").toLowerCase()} · ${draft.id.slice(-6)}` : draft.id,
              detectedType: draft.detectedType,
              status: draft.status,
              uploadedAt: "",
              method: "vision_llm" as const,
              issue: draft.issues?.[0]?.message,
            })),
          }),
        ),

  draft: (id: string): Promise<DraftDetail> =>
    mocksEnabled()
      ? mock(mockDraftDetail)
      : fetchJson<IngestDraft>(`/api/v2/ingest/drafts/${encodeURIComponent(id)}`).then((draft) => ({
          draft: {
            id: draft.id,
            filename: `file ${draft.fileId?.slice(-8) ?? draft.id}`,
            detectedType: draft.detectedType,
            status: draft.status,
            uploadedAt: "",
            method: "vision_llm" as const,
            issue: draft.issues?.[0]?.message,
          },
          fields: [{
            group: "Extracted fields",
            items: Object.entries(draft.fields ?? {}).map(([name, field]) => {
              const f = typeof field === "object" && field !== null ? field : { value: String(field) };
              return {
                name,
                label: name.replaceAll("_", " "),
                value: String(f.value ?? ""),
                confidence: (f.confidence === "high" || f.confidence === "check" || f.confidence === "low" ? f.confidence : "check") as "high" | "check" | "low",
                source: f.source ?? "extraction",
                quote: f.quote ?? "",
              };
            }),
          }],
          lines: (draft.lines ?? []).map((line) => ({
            lineNo: line.lineNo, description: line.description,
            qty: line.qty ?? "", rate: line.rate ?? "", amount: line.amount ?? "",
          })),
          issues: (draft.issues ?? []).map((issue) => ({ severity: "medium", message: issue.message })),
          suggestions: {
            supplier: draft.suggestions?.supplierName,
            po: draft.suggestions?.poNumber,
          },
        })),

  payments: (params: Record<string, string> = {}): Promise<PaymentsPage> =>
    mocksEnabled() ? mock(mockPayments) : fetchJson(`/api/v2/payments${qs(params)}`),

  paymentWorkbench: (id: string): Promise<typeof mockPaymentWorkbench> =>
    mocksEnabled()
      ? mock(mockPaymentWorkbench)
      : fetchJson(`/api/v2/payments/${encodeURIComponent(id)}/allocate`),

  allocatePayment: (id: string, body: { allocations: { documentId: string; amount: string }[]; reason: string; expectedRevision?: number }) =>
    fetchJson(`/api/v2/payments/${encodeURIComponent(id)}/allocate`, { method: "POST", body: JSON.stringify(body) }),

  importBankCsv: (entityId: string, mapping: Record<string, string>, rows: Record<string, string>[]): Promise<{ created: number; deduped: number; errors: number }> =>
    fetchJson(`/api/v2/import/bank-csv`, { method: "POST", body: JSON.stringify({ entityId, mapping, rows }) }),

  suppliers: (params: Record<string, string> = {}): Promise<SuppliersPage> =>
    mocksEnabled()
      ? mock(mockSuppliers)
      : fetchJson<{ items: SupplierApi[]; nextCursor: string | null }>(`/api/v2/suppliers${qs(params)}`).then(
          (page) => ({
            items: page.items.map(normalizeSupplier),
            nextCursor: page.nextCursor,
            total: page.items.length,
          }),
        ),

  supplier: (id: string): Promise<SupplierRow | null> =>
    mocksEnabled()
      ? mock(((mockSuppliers.items as SupplierRow[]).find((s) => s.id === id) ?? null) as SupplierRow | null)
      : fetchJson<SupplierApi>(`/api/v2/suppliers/${encodeURIComponent(id)}`).then(normalizeSupplier),

  me: (): Promise<MeResponse> => fetchJson(`/api/v2/me`),

  // B's document lifecycle (02 §3.4). `view` returns the raw BusinessDocument;
  // the UI normalises it to the shapes the mock pages were built against.
  documents: (params: Record<string, string> = {}): Promise<Page<DocView>> =>
    fetchJson(`/api/v2/documents${qs(params)}`),

  document: (id: string): Promise<DocView & { links: DocLink[]; lifecycle: LifecycleLine[] | null; caseId: string | null }> =>
    fetchJson(`/api/v2/documents/${encodeURIComponent(id)}`),

  orderActivity: (id: string): Promise<OrderActivity> =>
    mocksEnabled()
      ? mock({
          approvals: [{ actor: "usr_sanjay", action: "issue", role: "ap_manager", at: "2026-10-05T10:00:00+05:30" }],
          audit: [
            { id: "aud_1", action: "POST /api/v2/documents/doc_po1001/submit", event: "submit", actor: "usr_sanjay", actorRole: "buyer", at: "2026-10-05T09:30:00+05:30", statusCode: 200 },
            { id: "aud_2", action: "POST /api/v2/documents/doc_po1001/approve", event: "approve", actor: "usr_priya", actorRole: "ap_manager", at: "2026-10-05T09:55:00+05:30", statusCode: 200 },
          ],
          decisions: [{ id: "dec_1", action: "REQUEST_CLARIFICATION", reason: "Asked supplier for the missing remittance advice.", actor: "usr_priya", actorRole: "ap_manager", createdAt: "2026-10-27T16:40:00+05:30" }],
          amendments: [],
          meta: { createdBy: "usr_sanjay", createdAt: "2026-10-05T09:00:00+05:30", issuedAt: "2026-10-05T10:00:00+05:30", revision: 1, status: "partially_fulfilled" },
        })
      : fetchJson(`/api/v2/documents/${encodeURIComponent(id)}/activity`),

  renderModel: (id: string): Promise<RenderModel> =>
    mocksEnabled()
      ? mock({
          document: {
            id, type: "PO", status: "issued", number: "VPPL/PO/26-27/000123", date: "2026-10-28",
            entityId: mockEntities[0].id, supplierId: "sup_mehta",
            seller: { name: "Mehta Engineering Works", gstin: "27AAAPM1120F1Z5" },
            buyer: { name: mockEntities[0].legalName, gstin: mockEntities[0].gstin },
            lines: mockOrderDetail.lifecycle.map((l, i) => ({
              lineNo: l.lineNo, description: l.description, hsn: i === 0 ? "8413" : undefined, qty: l.ordered, uom: "NOS",
              rate: "1180.00", taxableValue: "100000.00", gstRate: "18", cgst: "9000.00", sgst: "9000.00", igst: "0.00", lineTotal: "118000.00",
            })),
            totals: { taxable: "100000.00", cgst: "9000.00", sgst: "9000.00", igst: "0.00", grand: "118000.00" },
            terms: { deliveryTerms: "FOR destination", creditDays: "30", warranty: "12", inspection: "On receipt" },
            contentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
          } as DocView,
          entity: {
            legalName: mockEntities[0].legalName, tradeName: mockEntities[0].tradeName, code: mockEntities[0].code,
            gstin: mockEntities[0].gstin, stateCode: mockEntities[0].stateCode,
            addresses: {
              billing: { line1: "Plot 42, MIDC Phase II", city: "Pune", state: "Maharashtra", pin: "411019" },
              shipping: [{ label: "Works", line1: "Plot 42, MIDC Phase II", city: "Pune", state: "Maharashtra", pin: "411019", contact: "Stores · 98220 00000" }],
            },
          },
          supplier: { id: "sup_mehta", legalName: "Mehta Engineering Works", gstins: [{ gstin: "27AAAPM1120F1Z5", stateCode: "27" }] },
          taxSummary: [{ gstRate: "18", taxable: "100000.00", cgst: "9000.00", sgst: "9000.00", igst: "0.00" }],
          amountInWords: "Rupees One Lakh Eighteen Thousand Only",
          terms: { deliveryTerms: "FOR destination", creditDays: "30", warranty: "12", inspection: "On receipt" },
          verify: { url: "https://satya.app/verify/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", hash: "a1b2c3d4" },
        })
      : fetchJson(`/api/v2/documents/${encodeURIComponent(id)}/render-model`),

  documentAction: (id: string, action: "compute" | "submit" | "approve" | "reject" | "issue" | "amend" | "short-close" | "cancel", body?: unknown) =>
    fetchJson(`/api/v2/documents/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  createDraft: (body: unknown): Promise<DocView> =>
    fetchJson(`/api/v2/documents/draft`, { method: "POST", body: JSON.stringify(body) }),

  patchDocument: (id: string, body: unknown): Promise<DocView> =>
    fetchJson(`/api/v2/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),

  // files + ingestion (B5)
  uploadFile: async (file: File, entityId?: string): Promise<FileDoc> => {
    const form = new FormData();
    form.append("file", file);
    if (entityId) form.append("entityId", entityId);
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const response = await fetch(`${SERVER_URL}/api/v2/files`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || `Upload failed (${response.status})`);
    }
    return response.json();
  },

  extractFile: (fileId: string): Promise<{ draftId: string; status: string; draft: IngestDraft }> =>
    fetchJson(`/api/v2/ingest/files/${encodeURIComponent(fileId)}/extract`, { method: "POST" }),

  ingestDrafts: (params: Record<string, string> = {}): Promise<{ items: IngestDraft[]; nextCursor: string | null }> =>
    fetchJson(`/api/v2/ingest/drafts${qs(params)}`),

  ingestDraft: (id: string): Promise<IngestDraft> =>
    fetchJson(`/api/v2/ingest/drafts/${encodeURIComponent(id)}`),

  patchIngestDraft: (id: string, body: unknown): Promise<IngestDraft> =>
    fetchJson(`/api/v2/ingest/drafts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),

  confirmIngestDraft: (id: string): Promise<{ documentId: string; status: string }> =>
    fetchJson(`/api/v2/ingest/drafts/${encodeURIComponent(id)}/confirm`, { method: "POST" }),

  // entity policy (B3)
  policy: (entityId: string): Promise<EntityPolicy> =>
    fetchJson(`/api/v2/policies/${encodeURIComponent(entityId)}`),
  putPolicy: (entityId: string, body: Partial<EntityPolicy>): Promise<EntityPolicy> =>
    fetchJson(`/api/v2/policies/${encodeURIComponent(entityId)}`, { method: "PUT", body: JSON.stringify(body) }),

  items: (params: Record<string, string> = {}): Promise<{ items: ItemRow[] }> =>
    fetchJson(`/api/v2/items${qs(params)}`),
  itemSearch: (q: string): Promise<{ items: ItemRow[] }> =>
    fetchJson(`/api/v2/items/search${qs({ q })}`),
  createItem: (body: unknown): Promise<ItemRow> =>
    fetchJson(`/api/v2/items`, { method: "POST", body: JSON.stringify(body) }),
  createSupplier: (body: unknown): Promise<SupplierApi> =>
    fetchJson(`/api/v2/suppliers`, { method: "POST", body: JSON.stringify(body) }),

  // public verify (02 §5.3)
  verify: (hash: string): Promise<{ valid: boolean; type?: string; number?: string; entityName?: string; date?: string; grandTotal?: string; status?: string }> =>
    fetchJson(`/api/v2/verify/${encodeURIComponent(hash)}`),

  hsnSearch: (q: string, date?: string): Promise<{ items: HsnResult[] }> =>
    fetchJson(`/api/v2/hsn/search${qs({ q, ...(date ? { date } : {}) })}`),

  complianceSection: <S extends keyof Compliance>(section: S, params: Record<string, string> = {}): Promise<Compliance[S]> =>
    mocksEnabled()
      ? mock(mockCompliance[section])
      : fetchJson<Compliance[S]>(`/api/v2/compliance/${section}${qs(params)}`),

  markItcReversed: (documentId: string, reversed: boolean, note?: string): Promise<{ documentId: string; itcReversed: unknown }> =>
    fetchJson(`/api/v2/compliance/itc-reversal`, { method: "POST", body: JSON.stringify({ documentId, reversed, note }) }),

  saveGstMeta: (documentId: string, body: { irn?: string; ewb?: string; irnStatus?: "not_applicable" | null; ewbStatus?: "not_required" | null; note?: string }): Promise<{ documentId: string; gst: Record<string, unknown> }> =>
    fetchJson(`/api/v2/compliance/gst-meta`, { method: "POST", body: JSON.stringify({ documentId, ...body }) }),

  tdsDecision: (body: { paymentId: string; action: "record" | "waive"; section?: string; rate?: string; amount?: string; note?: string }): Promise<{ paymentId: string; tdsEntryId?: string }> =>
    fetchJson(`/api/v2/compliance/tds-decision`, { method: "POST", body: JSON.stringify(body) }),

  importGstr2b: (entityId: string, gstr2b: unknown, period?: string): Promise<{ created: number; deduped: number; errors?: number }> =>
    fetchJson(`/api/v2/import/gstr2b`, { method: "POST", body: JSON.stringify({ entityId, gstr2b, period }) }),

  updateEntity: (id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> =>
    fetchJson(`/api/v2/entities/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),

  entities: (): Promise<{ entities: typeof mockEntities }> =>
    mocksEnabled() ? mock({ entities: mockEntities }) : fetchJson(`/api/v2/entities`),
};

export { mockCopilotAnswer };
