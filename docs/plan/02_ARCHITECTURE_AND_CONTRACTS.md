# 02 — Architecture & Frozen Contracts

Contracts in this file are **binding between agents**. Change them only via `docs/plan/CONTRACT_CHANGES.md` (see 00 §3). Producers may add optional fields freely; removing/renaming requires a contract change.

---

## 1. System overview

```
                    ┌──────────────────────────── Vercel ───────────────────────────┐
 Browser ─────────► │ client (Next.js 15, App Router)  — Agent D                    │
                    └───────┬───────────────────────────────┬───────────────────────┘
                            │ REST /api/v2 (JWT)            │ SSE /api/v2/copilot (JWT)
                ┌───────────▼───────────┐        ┌──────────▼──────────────┐
                │ server  :5002  (B)    │◄──────►│ chatbot-backend :5001 (C)│  AI gateway + copilot
                │ Express, auth, RBAC,  │ user   │ Gemini key pool, RAG,    │
                │ documents, PO/PI,     │ token  │ doc-extraction LLM,      │
                │ cases, jobs, audit,   │ + int. │ usage meter              │
                │ graph projection      │ token  └──────────┬──────────────┘
                └──┬────────┬───────────┘                   │ internal
                   │        │ internal token                │
                   │  ┌─────▼───────────────────┐           │
                   │  │ ml-fl-service :8000 (A)  │◄──────────┘ (C may call engine for
                   │  │ FastAPI engine: tax,     │             validation/eval only)
                   │  │ reconcile, match, ML,    │
                   │  │ doc parse (QR/JWS/text)  │
                   │  └─────────────────────────┘
          ┌────────▼───────┐   ┌──────────────┐
          │ MongoDB (Atlas)│   │ Neo4j (Aura) │  derived graph, rebuildable
          │ source of truth│   │              │
          └────────────────┘   └──────────────┘
```

Rules:
- Only **server (B)** writes business data to MongoDB and Neo4j. Engine (A) is **stateless** (except baked model artifacts and read-only reference data like HSN master snapshot and IRP public keys). Gateway (C) owns only its AI collections (§4.6).
- Client never talks to engine directly. Client talks to server for everything except the copilot stream and AI usage, which go to the gateway.
- Every service exposes `GET /health` (liveness, no dependencies) and `GET /ready` (dependencies ok). Server additionally keeps legacy `GET /api/health`.
- Service-to-service calls carry header `x-internal-token: $NODE_INTERNAL_TOKEN`; user-context calls also forward `Authorization: Bearer <user JWT>`.

## 2. Cross-cutting conventions

| Topic | Convention |
|---|---|
| IDs | Prefixed ULIDs as strings: `grp_`, `ent_`, `usr_`, `sup_`, `itm_`, `doc_`, `file_`, `drf_` (extraction draft), `case_`, `snp_`, `fnd_`, `dec_`, `job_`, `evd_` (evidence), `conv_`. Library: `ulid` (Node) — Agent B provides `newId(prefix)`. Engine accepts any string IDs. Legacy IDs (e.g. `INV-041`, `PO-1001`) remain valid as `externalRef`. |
| Money | `{ "amount": "70800.00", "currency": "INR" }`; amount = decimal string, max 6 dp internally, displayed 2 dp. Never a JSON number. |
| Quantity | decimal string `"40"`, `"2.500"`; `uom` from allowed list (EA/NOS, BOX, SET, M, KG, L, PAIR, ROLL, LOT, plus UQC codes from GST master). |
| Percent | decimal string `"18"` meaning 18%. |
| Dates | ISO-8601 with offset, e.g. `2026-10-01T10:00:00+05:30`. Date-only business fields (invoice date) as `YYYY-MM-DD` plus `tz: "Asia/Kolkata"` implied. |
| FY | string `"2026-27"`; helper `fyOf(date)` (April start). |
| Errors | HTTP status + body `{ "error": { "code": "SNAKE_CASE", "message": "Plain-language message", "details": {...}, "requestId": "..." } }`. Codes listed per endpoint; common: `UNAUTHENTICATED` 401, `FORBIDDEN` 403 (with `details.reason`), `NOT_FOUND` 404, `VALIDATION_FAILED` 422 (with `details.fields[]`), `CONFLICT` 409 (stale revision/idempotency), `RATE_LIMITED` 429, `UPSTREAM_UNAVAILABLE` 503 (with `details.service`, `retryAfterMs`). |
| Pagination | `?limit=25&cursor=<opaque>` → `{ items:[], nextCursor: string|null, total?: number }`. |
| Idempotency | `Idempotency-Key` header required on POST that create documents/imports/uploads; same key + same body → same result; same key + different body → 409. |
| Concurrency | Mutable resources carry `revision` (int). Mutations send `expectedRevision`; mismatch → 409 `STALE_REVISION`. |
| Scoping | Every business document has `groupId` and `entityId`. Server resolves allowed entities from JWT memberships; any ID outside scope → 404 (not 403, to avoid existence leaks). |
| Evidence | `Evidence = { id, documentId, documentType, field, value?, locator: {kind: "pdf_text"|"pdf_region"|"csv_cell"|"json_path"|"qr_field"|"manual", page?, row?, column?, path?, quote?}, fileId?, observedAt }` |
| Certainty | enum `CONFIRMED | PROBABLE | POSSIBLE | AMBIGUOUS | INSUFFICIENT_EVIDENCE` (01 §5) |
| Actions | enum `APPROVE | REQUEST_CLARIFICATION | ESCALATE | PLACE_ON_HOLD` |
| Feature flags | env `FEATURE_V2_<NAME>=1`; server exposes resolved flags at `GET /api/v2/meta/flags` for the client. Names: `PO_WIZARD`, `DOC_INBOX`, `RECON_V2`, `GRAPH_V2`, `COPILOT_V2`, `COMPLIANCE`, `ML_V2`, `PUBLIC_SITE_V2`, `AI_USAGE_METER`. |

## 3. Core domain types (TypeScript notation; Python engine uses equivalent Pydantic models)

```ts
type DocType =
  | "PR" | "RFQ" | "QUOTATION"
  | "PI_IN"        // proforma invoice received from supplier
  | "PI_OUT"       // proforma invoice issued by our entity (seller side)
  | "PO" | "PO_AMENDMENT" | "PO_ACK" | "RELEASE_ORDER"
  | "INVOICE_IN"   // supplier tax invoice (purchase)
  | "INVOICE_OUT"  // our tax invoice (sales)
  | "CREDIT_NOTE_IN" | "DEBIT_NOTE_OUT" | "CREDIT_NOTE_OUT" | "DEBIT_NOTE_IN"
  | "DELIVERY_CHALLAN" | "EWAY_BILL" | "LR"
  | "GRN" | "QC" | "RETURN"
  | "PAYMENT_OUT" | "PAYMENT_IN" | "ADVANCE_OUT" | "REMITTANCE_ADVICE"
  | "TDS_ENTRY" | "GSTR2B_ENTRY" | "IMS_ACTION" | "BANK_LINE" | "SUPPLIER_STATEMENT_LINE";

type Party = { name: string; gstin?: string; pan?: string; stateCode?: string; address?: Address;
               udyam?: { number: string; category: "micro"|"small"|"medium" }; supplierId?: string };
type Address = { line1: string; line2?: string; city: string; stateCode: string; pincode: string; country: "IN" | string };

type DocLine = {
  lineNo: number; itemId?: string; sku?: string; description: string; specs?: Record<string,string>;
  hsn?: string; uom: string; qty: string; rate?: string; discountPct?: string;
  taxableValue?: string; gstRate?: string; cgst?: string; sgst?: string; igst?: string; cess?: string; lineTotal?: string;
  scheduleDate?: string;               // PO delivery schedule for this line/batch
  refs?: { poId?: string; poLineNo?: number; grnId?: string; grnLineNo?: number; invoiceId?: string; invoiceLineNo?: number };
  acceptedQty?: string; rejectedQty?: string; rejectReason?: string;   // QC
  batch?: string;
};

type BusinessDocument = {
  id: string; groupId: string; entityId: string; type: DocType;
  number: string;                 // human/document number as printed (e.g. "VPPL/PO/26-27/000123", "INV-041")
  externalRef?: string;           // id in source system
  date: string;                   // document date YYYY-MM-DD
  fy: string;
  status: "draft"|"pending_approval"|"approved"|"issued"|"acknowledged"|"partially_fulfilled"|"fulfilled"
        |"short_closed"|"cancelled"|"posted"|"reversed"|"confirmed"|"rejected";
  revision: number; supersedes?: string;   // amendments
  seller: Party; buyer: Party; shipTo?: Address; placeOfSupply?: string;  // state code
  currency: string; fx?: { rate: string; source: string; date: string };
  lines: DocLine[];
  charges?: { kind: "freight"|"packing"|"insurance"|"other"; description: string; amount: string; hsnOrSac?: string; gstRate?: string }[];
  totals?: { taxable: string; cgst: string; sgst: string; igst: string; cess: string; roundOff: string; grand: string };
  payment?: { utr?: string; mode?: "NEFT"|"RTGS"|"IMPS"|"UPI"|"CHEQUE"|"OTHER"; amount: string; valueDate?: string;
              bankAccountMasked?: string; allocations?: { documentId: string; amount: string; basis: "reference"|"reviewer"|"remittance" }[];
              tdsAmount?: string; reversalOf?: string };
  gst?: { irn?: string; ackNo?: string; ackDate?: string; signedQr?: { verified: boolean; keyId?: string; fields?: Record<string,string> };
          ewayBillNo?: string; reverseCharge?: boolean; lut?: { arn: string; fy: string }; supplyType?: "B2B"|"EXPWP"|"EXPWOP"|"SEZWP"|"SEZWOP" };
  terms?: { paymentTerms?: string; creditDays?: number; advancePct?: string; deliveryTerms?: string; inspection?: string;
            warranty?: string; penalty?: string; validityDays?: number; freeText?: string[] };
  source: { channel: "created_in_satya"|"upload_pdf"|"upload_image"|"csv"|"excel"|"json"|"einvoice_json"|"bank_csv"|"gstr2b_json"|"api";
            fileId?: string; extractionDraftId?: string; sourceSystem?: string };
  provenance: "USER_PROVIDED"|"SYSTEM_GENERATED"|"EXTRACTED_REVIEWED"|"CONSTRUCTED_DEMO";
  observedAt: string; createdAt: string; createdBy: string; updatedAt: string;
};

type Finding = {
  id: string; code: string; title: string; severity: "info"|"low"|"medium"|"high"|"critical";
  certainty: Certainty; exposure?: { min: Money; max: Money } | Money;
  documentIds: string[]; evidence: Evidence[]; explanation: string;
  calculation: { step: string; formula?: string; value?: string; evidenceIds?: string[] }[];
  candidates?: { documentId: string; score?: string; why: string }[];   // when AMBIGUOUS
  recommendedAction: Action; actionScope?: { holdAmount?: Money; approveAmount?: Money };
  whatResolvesIt: string; detector: "rule"|"ml"|"hybrid"; detectorVersion: string;
  harmlessVariance?: boolean;
};
```

## 4. MongoDB collections (owner: B unless stated)

All business collections carry `groupId`, `entityId` (where meaningful), `createdAt`, `updatedAt`, `createdBy`. Shared Mongoose schema factory sets `minimize:false`, `timestamps:true`, strict mode.

| Collection | Key fields | Indexes |
|---|---|---|
| `groups` | id, name, legalName, plan, settings | id unique |
| `entities` | id, groupId, code (short, used in numbering), legalName, tradeName, gstin, pan, cin, stateCode, addresses{billing,shipping[]}, aato band [CFG: `"<5cr"|"5-10cr"|">=10cr"`], einvoiceApplicable, lut[{arn,fy,validFrom,validTo}], bankAccounts, letterhead{logoFileId, stampFileId, signatureFileId, footerText, colors}, parentEntityId? | groupId+code unique; gstin |
| `users` (extend existing) | id, email, name, passwordHash, platformRole?, memberships[{groupId, entityId|"*", roles[]}], active, mfa? | email unique |
| `suppliers` | id, groupId, legalName, tradeNames[], gstins[{gstin,stateCode,status?}], pan, udyam{number,category,verifiedAt?}, msme(bool), bankAccounts[{id, accountMasked, ifsc, accountHash, status: "active"|"pending_change"|"inactive", approvedBy[]}], paymentTermsDays, contacts[], tags | groupId+pan; groupId+gstins.gstin; text index on names |
| `items` | id, groupId, code, description, specs, hsn, uom, defaultGstRate?, aliases[] (supplier descriptions learned from confirmed matches) | groupId+code unique; text index |
| `hsn_master` (global, read-mostly) | code (4/6/8 digit), description, chapter, rates[{rate, cessRate?, effectiveFrom, effectiveTo?, notificationRef}], uqc? | code unique |
| `policies` | entityId, tolerance{priceAbs, pricePct, qtyPctByUom{}}, doa[{docType, maxAmount, roles[]}], numbering[{docType, pattern, nextSeq, fy}], msme{defaultDays:45}, approvals{requireMakerChecker:true}, termsTemplates[{id,name,docType,clauses[]}] | entityId unique |
| `documents` | BusinessDocument (§3) | groupId+entityId+type+date; groupId+type+number; groupId+"seller.gstin"+number+fy (dup detection); "payment.utr"; links |
| `document_links` | id, groupId, fromId, toId, kind ("FULFILS"|"RECEIVES"|"INSPECTS"|"BILLS"|"SETTLES"|"ADJUSTS"|"AMENDS"|"RETURNS"|"REPORTED_IN"|"DUPLICATE_OF"|"SAME_AS"), certainty, confidence?, amount?, qty?, basis ("reference"|"reviewer"|"model"|"rule"), createdBy, decisionId? | fromId; toId; groupId+kind |
| `files` (+ GridFS bucket `uploads`) | id, groupId, entityId, filename, mime, size (≤10 MB), sha256, pages?, uploadedBy, retentionUntil | sha256+groupId unique |
| `extraction_drafts` | id, groupId, entityId, fileId, status ("queued"|"parsing"|"extracting"|"needs_review"|"confirmed"|"failed"), detectedType, method ("einvoice_qr"|"text_layer"|"vision_llm"|"csv"|"json"), fields{name:{value, confidence, sources[], issues[]}}, lines[], issues[], aiUsage{model, tokens}, confirmedDocumentId? | groupId+status |
| `cases` (investigations) | id, groupId, entityId, kind ("po"|"supplier_period"|"payment"|"custom"), subjectIds[], title, status ("open"|"in_review"|"resolved"|"escalated"|"on_hold"), latestSnapshotId, revision, assignee, priority | groupId+status; subjectIds |
| `snapshots` (immutable) | id (hash of inputs+engine version), caseId, knowledgeTime, engineVersion, modelVersion, ledger{}, lines[], findings[], links[], ambiguities[], recommendation{}, graph{nodes,edges}, createdAt | caseId+createdAt |
| `findings` (denormalised from latest snapshot for querying) | Finding + caseId, snapshotId, status ("open"|"resolved"|"accepted_risk") | groupId+status+severity; code |
| `decisions` | id, caseId, findingId?, action, scope, reason, actor, actorRole, expectedRevision, makerId?, checkerId?, createdAt | caseId |
| `jobs` | id, kind, status, progress, payloadRef, result, error, attempts, runAfter | status+runAfter |
| `audit_log` | seq, groupId, actor, action, target, before?, after?, ip?, at, prevHash, hash (SHA-256 chain) | groupId+seq unique |
| `conversations` (owned by C) | id, groupId, userId, title, messages[{role, content, citations, toolCalls, usage}], summary | groupId+userId+updatedAt |
| `ai_key_state` (C) | keyHash (sha256 of key, never the key), alias ("key-07"), status, cooldownUntil, dayKey (PT date), counts{model:{rpd, tokens}}, lastErrorCode | keyHash unique |
| `ai_usage_daily` (C) | dayKey, model, task, requests, inputTokens, outputTokens, fallbacks | dayKey+model+task |
| `rag_chunks` (C) | id, groupId, sourceType ("document_text"|"note"|"policy"|"help"|"finding"), sourceId, text, embedding (768 floats), embeddingModel, tokens | groupId+sourceType; Atlas Vector Search index `rag_vec` on embedding (if available) |

Atlas M0 allows at most **3 search/vector indexes** [V] — reserve: `rag_vec` (vector), `documents_text` (search, optional), one spare.

## 5. Server API v2 (owner: B) — `https://<api>/api/v2`

All require JWT unless noted. RBAC per 01 §8.

### 5.1 Auth & meta
- `POST /auth/login` {email,password} → {token, user:{id,name,email}, memberships, groups} (keep `/api/auth/login` working).
- `POST /auth/signup` (creates a new group + first entity in trial plan; privileged roles never self-assignable).
- `GET /me` → {user, memberships, activeGroup, entities, permissions:{[entityId]: string[]}}
- `GET /meta/flags` (public) → {flags:{PO_WIZARD:true,...}}
- `GET /meta/health` (public) → {server, engine, gateway, mongo, neo4j: "ok"|"waking"|"down"}

### 5.2 Organisation & masters
- `GET/POST/PATCH /entities`, `GET /entities/:id`
- `GET/POST/PATCH /suppliers`, `GET /suppliers/:id` (+ `/suppliers/:id/summary` → open POs, deliveries, invoices, payments, findings, msme deadlines)
- `POST /suppliers/:id/bank-accounts` (creates `pending_change`), `POST /suppliers/:id/bank-accounts/:accId/approve` (checker)
- `GET/POST/PATCH /items`, `GET /items/search?q=` (text + alias)
- `GET /hsn/search?q=&date=` → [{code, description, rate (effective on date), effectiveFrom, notificationRef}]
- `GET/PUT /policies/:entityId`
- `POST /files` (multipart, ≤10 MB, Idempotency-Key) → {fileId, sha256, duplicateOf?}; `GET /files/:id` (stream, scoped)

### 5.3 Purchase documents (PO/PI/amendments)
- `POST /documents/draft` {type, entityId, ...partial BusinessDocument} → draft with `id`, `revision:0`
- `PATCH /documents/:id` {expectedRevision, patch} (drafts only)
- `POST /documents/:id/compute` → engine tax computation result (lines with taxes, totals, warnings[]) — server proxies engine `/v2/tax/compute`; debounce on client.
- `POST /documents/:id/submit` → status `pending_approval`; DoA routing → {approvers:[{role, userIds}]}
- `POST /documents/:id/approve` {expectedRevision, comment} (SoD enforced) ; `POST /documents/:id/reject` {reason}
- `POST /documents/:id/issue` → assigns number from series (atomic `findOneAndUpdate` on policies.numbering), status `issued`, computes `contentHash` (SHA-256 of canonical JSON) → {number, contentHash, verifyUrl}
- `POST /documents/:id/amend` → creates `PO_AMENDMENT` draft with `supersedes`, revision+1
- `POST /documents/:id/short-close` {lines:[{lineNo, qty}], reason}; `POST /documents/:id/cancel` {reason}
- `GET /documents?type=&status=&entityId=&supplierId=&q=&from=&to=` (paginated)
- `GET /documents/:id` → document + links + lifecycle per line `{lineNo, ordered, received, accepted, rejected, invoiced, paid, open}` (strings) + caseId
- `GET /documents/:id/render-model` → everything the PDF needs: document, entity letterhead (signed file URLs), supplier, tax summary by HSN/rate, amount in words, terms, verify QR payload `{url, hash}`
- `GET /verify/:hash` (public) → {valid, type, number, entityName, date, grandTotal} — lets a supplier verify a PO PDF is genuine.

### 5.4 Ingestion
- `POST /ingest/files/:fileId/extract` → {draftId} (job). Orchestration (B): engine `/v2/docs/parse` → if `needsLlm`, gateway `/internal/llm/extract` → engine `/v2/docs/validate` → draft `needs_review` (or auto-confirm if all fields high-confidence AND policy allows).
- `GET /ingest/drafts?status=` ; `GET /ingest/drafts/:id` ; `PATCH /ingest/drafts/:id` {fields, lines} (human corrections; each correction logged)
- `POST /ingest/drafts/:id/confirm` → creates `BusinessDocument` (provenance `EXTRACTED_REVIEWED`), links evidence locators, triggers reconciliation for affected cases.
- `POST /ingest/structured` (existing JSON bundle path, upgraded to v2 types) and `POST /ingest/csv/preview` + `POST /ingest/csv/commit` (existing CSV mapping flow, kept).
- `POST /ingest/bank` (CSV with mapping) ; `POST /ingest/gstr2b` (official GSTR-2B JSON download) ; `POST /ingest/ims` (IMS action export)

### 5.5 Investigations & decisions
- `GET /cases?status=&severity=&entityId=&q=` ; `GET /cases/:id` → case + latest snapshot (+ `?snapshot=<id>` or `?asOf=<ISO>` for replay)
- `POST /cases/:id/reconcile` → job ; `GET /jobs/:id`
- `POST /cases/:id/scenarios` {changes:[...]} → what-if snapshot (not persisted as latest)
- `POST /cases/:id/decisions` {expectedRevision, snapshotId, findingId?, action, scope?, reason, review?:{kind:"confirm_duplicate"|"allocate_payment"|"accept_variance"|"link_documents", ...}} → {decision, job}
- `GET /findings?status=&severity=&code=&entityId=` (cross-case worklist)
- `GET /cases/:id/evidence-pack` → JSON bundle the client renders to PDF

### 5.6 Graph (projection owner: B; visualisation: D)
- `GET /graph/case/:id?asOf=` → `GraphPayload`
- `GET /graph/document/:id/neighborhood?depth=1..2`
- `GET /graph/path?from=<docId>&to=<docId>` (shortest evidence path, max 6 hops)
- `GET /graph/supplier/:id` (supplier network: entities, POs, invoices, payments, duplicate-vendor links)
```ts
type GraphPayload = {
  nodes: { id: string; type: DocType|"SUPPLIER"|"ENTITY"|"ITEM"|"FINDING"; label: string; subtitle?: string;
           stage: "order"|"dispatch"|"receipt"|"inspection"|"invoice"|"payment"|"tax"|"party"|"finding";
           amount?: Money; qty?: string; date?: string; status?: string; severity?: string; documentId?: string }[];
  edges: { id: string; source: string; target: string; kind: string; certainty: Certainty; amount?: Money; qty?: string;
           label: string; explanation: string; evidenceIds: string[] }[];
  timeline: { at: string; nodeIds: string[]; edgeIds: string[] }[];   // for replay scrubber
  source: "neo4j" | "snapshot";                                       // degraded mode indicator
};
```

### 5.7 Compliance & dashboard
- `GET /dashboard/today?entityId=` → {moneyAtRisk: Money, holds:{count, amount}, approvalsWaiting, deadlines:[{kind:"MSME_45"|"RULE_37_180"|"EINVOICE_30"|"PO_DELIVERY", documentId, supplier, dueDate, daysLeft, amount}], itcAtRisk: Money, topFindings: Finding[] (5)}
- `GET /compliance/gstr2b?period=YYYY-MM` → matched/missing/mismatched lists ; `GET /compliance/msme` ; `GET /compliance/rule37` ; `GET /compliance/tds?fy=`

### 5.8 Audit & admin
- `GET /audit?target=&actor=&from=&to=` ; `GET /audit/verify` → {chainValid, brokenAt?}
- `GET/POST/PATCH /users` (admin), `POST /users/:id/memberships`

## 6. Engine API v2 (owner: A) — internal, `x-internal-token` required

Base `http://ml-fl-service:8000`. All money/qty as decimal strings. Request/response Pydantic models live in `ml-fl-service/satya_engine/contracts_v2.py`.

| Endpoint | Purpose | Request → Response (summary) |
|---|---|---|
| `GET /health`, `GET /ready` | liveness/readiness | `{ok, service:"satya-engine", engineVersion, modelVersion, hsnMasterVersion}` |
| `POST /v2/tax/compute` | GST computation for a document | `{seller:{gstin?,stateCode}, buyer:{gstin?,stateCode}, placeOfSupply, docDate, supplyType, reverseCharge, lut?, currency, lines:[{lineNo,hsn,qty,rate,discountPct?,uom,gstRateOverride?}], charges[], roundOff:true}` → `{lines:[{lineNo,taxableValue,gstRate,rateSource:{hsn,effectiveFrom,notificationRef}|"override",cgst,sgst,igst,cess,lineTotal}], charges[], taxSummary:[{hsn,gstRate,taxable,cgst,sgst,igst,cess}], totals, amountInWords, warnings:[{code,message}], flags:{ewayBillRequired, einvoiceExpected, hsnDigitsRequired, tds393Applicable?}}` |
| `POST /v2/reconcile/case` | Deterministic reconstruction + findings | `{caseId, entityPolicy, knowledgeTime?, documents: BusinessDocument[], links: DocumentLink[], reviews:{confirmedDuplicates:{}, paymentAllocations:{}, acceptedVariances:{}}, scenario?}` → `{snapshotId, engineVersion, modelVersion, ledger, lines:[lifecycle per PO line], findings: Finding[], links:[proposed+confirmed], ambiguities[], recommendation:{action, scope, reasons[]}, graph: GraphPayload}` |
| `POST /v2/match/candidates` | Blocking + scoring + conformal sets | `{task:"invoice_po_line"|"grn_po_line"|"invoice_invoice_dup"|"payment_invoice"|"supplier_supplier"|"item_item", anchors:[...], pool:[...], alpha?:"0.05"}` → `{results:[{anchorId, predictionSet:[{candidateId, probability, contributions:[{feature,value,impact}]}], certainty, abstainReason?}]}` |
| `POST /v2/allocate/payment` | Exact subset-sum allocation | `{payment, openInvoices[], credits[], tdsPolicy}` → `{solutions:[{allocations[], residual}], unique:boolean, certainty}` |
| `POST /v2/anomaly/score` | Price/amount anomaly | `{documents[], history[]}` → `{scores:[{documentId, lineNo?, score, method, baseline, explanation}]}` |
| `POST /v2/compliance/deadlines` | MSME 45d, Rule 37, e-invoice 30d, delivery schedule | `{documents[], suppliers[], payments[], asOf}` → `{deadlines[]}` |
| `POST /v2/docs/parse` | Deterministic doc parse | multipart file or `{fileBase64, mime}` → `{detectedType?, method, pages, textLayer:{present, chars}, qr:{found, verified, keyId?, fields?}, extracted?: partial BusinessDocument, needsLlm:boolean, pageImages?: [{page, pngBase64}] (≤3 pages, ≤1600px), issues[]}` |
| `POST /v2/docs/validate` | Validate extracted fields | `{draft: partial BusinessDocument, qrFields?, textLayer?}` → `{fields:{name:{value, confidence, issues[]}}, lines[], issues:[{code,severity,message,field?}], suggestions:{supplierMatch?, poMatch?}}` |
| `POST /v2/validate/gstin` | Checksum + state | `{gstin}` → `{wellFormed, checksumValid, stateCode, panEmbedded, entityTypeHint}` |
| `GET /v2/models/status` | Model cards | `{models:[{task, version, trainedAt, dataSources[], metrics:{prAuc, rocAuc, ece, conformalCoverage, avgSetSize, abstentionRate}, limitations[]}]}` |
| `GET /v2/evaluation/report` | Full evaluation report (for `/research` page) | JSON report |
| `POST /v2/train` (admin, internal, disabled in prod) | Retrain from labelled decisions | job descriptor |

Legacy `/reconcile`, `/import/preview`, etc. stay until B switches over (flag `RECON_V2`).

## 7. AI Gateway & Copilot API (owner: C) — `https://<chat>/`

| Endpoint | Auth | Contract |
|---|---|---|
| `GET /health`, `GET /ready` | none | `{ok, service:"satya-ai-gateway", llm:"available"|"degraded"|"evidence_only"}` |
| `POST /api/v2/copilot/chat` | JWT | body `{conversationId?, message, context?:{page, caseId?, documentId?, supplierId?, entityId?}}` → **SSE** events (see below) |
| `GET /api/v2/copilot/conversations` / `GET /:id` / `DELETE /:id` | JWT | scoped to user + group |
| `GET /api/v2/ai/usage` | JWT | `{mode:"llm"|"evidence_only", models:[{model, task, remainingToday: number|null, limitToday: number|null, estimate:boolean}], keys:{total, active, cooling, exhausted, invalid}, resetsAt (ISO, next midnight America/Los_Angeles), currentKeyAlias?: "key-07" (admins only)}` |
| `POST /api/v2/copilot/feedback` | JWT | `{messageId, rating: "up"|"down", reason?}` |
| `POST /internal/llm/extract` | internal | `{task:"invoice"|"po"|"pi"|"grn"|"challan"|"bank_statement"|"generic", pageImages?[], text?, schemaVersion, dataPolicy:"demo"|"consented"|"paid"}` → `{extracted: partial BusinessDocument, fieldConfidence:{[field]: number}, quotes:{[field]: {page, quote}}, model, usage:{inputTokens, outputTokens}}` or 503 `{error:{code:"AI_UNAVAILABLE"}}` |
| `POST /internal/llm/embed` | internal | `{texts[], taskType:"RETRIEVAL_DOCUMENT"|"RETRIEVAL_QUERY"}` → `{vectors[][], model, dims:768}` |
| `POST /internal/rag/index` | internal | `{groupId, sourceType, sourceId, text}` → `{chunks}` (server calls after document confirm) |

SSE event types (`event:` line), each `data:` is JSON:
`status` {stage: "understanding"|"retrieving"|"checking"|"writing", detail} · `tool` {name, args(sanitised), ms, ok} · `token` {text} · `answer` {content (final, placeholders resolved), answerType, certainty, citations:[{n, evidenceId, label, documentId, href}], facts:{...}, cards?:[{label,value,detail}], suggestedFollowUps[], graphRef?} · `usage` (same shape as /ai/usage, abbreviated) · `error` {code, message} · `done` {messageId}.

## 8. Neo4j schema (projection owner: B)

Labels: `Group, Entity, Supplier, Item, HSN, Document` (+ secondary label per type: `PO, PI, Invoice, GRN, QC, Payment, CreditNote, Challan, EwayBill, GSTR2B`), `Finding`.
Relationships: `(:Entity)-[:SUBSIDIARY_OF]->(:Entity)`, `(:Document)-[:ISSUED_BY]->(:Entity|:Supplier)`, `(:Document)-[:ADDRESSED_TO]->(...)`, `(:Document)-[:LINKS {kind, certainty, confidence, amount, qty, basis, evidenceIds}]->(:Document)`, `(:Document)-[:ORDERS]->(:Item)`, `(:Item)-[:CLASSIFIED_AS]->(:HSN)`, `(:Finding)-[:FLAGS]->(:Document)`, `(:Supplier)-[:SAME_AS {certainty}]->(:Supplier)`.
Every node/relationship has `groupId`; every query filters by `groupId` (parameterised templates only, no user-supplied Cypher). Projection is rebuilt idempotently from MongoDB (`MERGE` by id). If Neo4j is unavailable, graph endpoints return `GraphPayload` built from the snapshot with `source:"snapshot"`.
Do **not** depend on the GDS plugin in production (not assumed available on Aura Free); compute any graph analytics in the engine.

## 9. Environment variables (complete list)

| Service | Variable | Notes |
|---|---|---|
| all | `NODE_INTERNAL_TOKEN` | same value in server, gateway, engine |
| server, gateway | `JWT_SECRET` | same value |
| server | `DB_URI`, `APP_DB_NAME=satya`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `ENGINE_API_URL`, `GATEWAY_API_URL`, `ALLOWED_ORIGINS`, `PUBLIC_APP_URL`, `DEMO_MODE`, `SEED_DEMO_USERS`, `DEMO_PASSWORD`, `RATE_LIMIT_*`, `FEATURE_V2_*`, `MAX_UPLOAD_MB=10` |
| gateway | `GEMINI_API_KEYS` (comma-separated; **never committed**), `GEMINI_MODEL_LADDER_CHAT`, `GEMINI_MODEL_LADDER_EXTRACT`, `GEMINI_EMBED_MODEL=gemini-embedding-001`, `GEMINI_FREE_LIMITS_JSON` (per-model RPM/RPD used for estimates), `AI_DATA_POLICY=demo_only|paid_or_consented`, `GRAPH_API_URL` (server), `ML_API_URL`, `DB_URI` (for AI collections), `ALLOWED_ORIGINS`, `GROQ_KEY` (optional secondary provider) |
| engine | `PORT=8000`, `MODEL_ARTIFACT_DIR`, `HSN_MASTER_PATH`, `IRP_KEYS_DIR`, `GATEWAY_API_URL` (not required), thread caps (`OMP_NUM_THREADS=2` …) |
| client | `NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_CHATBOT_URL`, `NEXT_PUBLIC_FEATURE_*`, `NEXT_PUBLIC_SITE_URL` |

Local development: `chatbot-backend/.env` already contains `GEMINI_API_KEYS` (68 keys, gitignored). Production: the human pastes the same value into Render env (`sync:false`).

## 10. Deployment constraints (design for them)

- **Render free web services**: 512 MB RAM, spin down when idle and cold-start on next request (tens of seconds); free instance hours are limited per workspace per month — do **not** add keep-alive pingers. UI must handle cold starts (06 §9). No background workers on free plan → jobs run in-process from the Mongo `jobs` collection with a poller (exists; B hardens).
- **Vercel**: client only; no long-running server work in Next.js route handlers (keep proxies thin, ≤10 s).
- **MongoDB Atlas free tier**: small storage; ≤3 search/vector indexes [V]; files ≤10 MB each in GridFS; keep demo data compact.
- **Neo4j Aura Free**: node/relationship caps and inactivity pausing apply — check current limits in the Aura console; graph must be rebuildable and optional.
- **Gemini free tier**: per-project RPM/RPD limits, reset at midnight Pacific; inputs may be used to improve Google products [V] → see data policy (00 §4.8).
