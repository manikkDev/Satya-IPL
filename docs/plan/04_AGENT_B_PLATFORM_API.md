# 04 — Agent B: Platform API, Domain, Graph & Infra (`server/**` + root infra files)

You are the integration hub: identity, permissions, persistence, document lifecycle, orchestration of engine/gateway, Neo4j projection, deployment files, CI. You are also the **contract custodian** (you edit `02_ARCHITECTURE_AND_CONTRACTS.md` only after a change is agreed in `CONTRACT_CHANGES.md`). Read 00, 01 (§3, §8, §9), 02 (all).

Owner test command:
```bash
docker compose up -d mongo neo4j ml-fl-service      # dependencies
cd server && npm test                               # node --test, must be green
```

---

## 1. Current state
- Express app (`server/src/index.js`), Mongoose models (`Business.js` generic factory with `minimize:false`, `User`, `AuditLog`, `ChatConversation`, legacy `Consent`, `ErasureRequest`), routes `businessRoutes.js` (cases, imports, CSV preview/commit, decisions, jobs, scenarios), `businessAuth.js`, legacy `consentRoutes`, `flProgress`, `graph.js` (legacy risk graph), `userRoutes`, utils `businessService.js` (engine calls, Neo4j projection), `audit.js`, rate limits, JWT, demo seeding (`seedDemoUsers.js`), 15 contract tests in `server/test/business.test.mjs`.
- Roles today: `ops_analyst`, `ap_manager`, `auditor`, `admin`; single `companyId` per user.
- Deps include unused `googleapis`, `socket.io` (verify usage before removal).

## 2. Target layout
```
server/src/
  index.js  app.js (express app factory, testable)  config/
  lib/ ids.js money.js(format only) errors.js validate.js(zod) flags.js http.js(timeouts, retry, circuit breaker) fy.js
  auth/ jwt.js passwords.js middleware.js (authenticate, loadScope) rbac.js (can(), requirePermission(), sod.js)
  models/ Group Entity User Supplier Item HsnMaster Policy Document DocumentLink File ExtractionDraft Case Snapshot Finding Decision Job AuditLog Conversation(legacy read)
  services/ engine.js gateway.js numbering.js approvals.js documents.js ingest.js reconcile.js graph/{projector.js, queries.js, fromSnapshot.js} dashboard.js compliance.js audit.js storage.js(GridFS) seed/{demoV2.js, hsn.js}
  routes/v2/ auth.js me.js meta.js entities.js suppliers.js items.js hsn.js policies.js files.js documents.js ingest.js cases.js findings.js graph.js dashboard.js compliance.js audit.js users.js verify.js research.js
  routes/legacy/ (existing v1 routes kept until client migrates; remove consent/fl/risk-graph)
  jobs/ runner.js handlers/{reconcile.js, extract.js, project.js, index.js}
test/ v2/*.test.mjs + existing business.test.mjs
```
Dependencies to add (justify in STATUS): `zod` (validation), `ulid`, `helmet`, `multer` (memory storage, size-limited) or `busboy`, `file-type` (magic-byte sniffing). Remove unused `googleapis`; remove `socket.io` only if unused by client (check `client/src` for `socket.io-client`).

---

## 3. Tasks

### P0-B0 — Pitch safety (30 Oct, first hour)
1. Add `lib/flags.js` (`isOn(name)` reading `FEATURE_V2_<NAME>`), `GET /api/v2/meta/flags`. Defaults: all off in production, on in development.
2. Ask the human (STATUS line, bold) to either pause Render auto-deploy and Vercel production deploys until the pitch ends, or accept that every push deploys. Do not modify `render.yaml autoDeploy` yourself without that confirmation.
3. Add `mem_limit`/`cpus` to `docker-compose.yml` services (engine 2g/2, server 768m/1, gateway 768m/1, client 1.5g/2, mongo 1g, neo4j 1.5g with `NEO4J_server_memory_heap_max__size=512m`, `NEO4J_server_memory_pagecache_size=256m`).

### P1-B1 — Cleanup legacy (½ day)
Remove consent/erasure/FL-progress/risk-graph routes & models and any banking leftovers not used by Satya; keep `/api/health`. Grep `client/src` to make sure the client no longer calls them (if it does, coordinate with D via handoff before removal). Remove legacy env vars from `render.yaml` (`PROGRESS_WEBHOOK`, `FLOWER_PYTHON`) after A confirms.

### P1-B2 — Identity, groups, entities, memberships (1½ days)
- Models `Group`, `Entity`, extend `User` with `memberships[]` (02 §4). Migration script `scripts/migrate-v1-users.mjs` (idempotent): each legacy `companyId` → a Group + one Entity; legacy roles map: `ops_analyst→buyer+ap_clerk`, `ap_manager→ap_manager`, `auditor→auditor`, `admin→group_admin`.
- JWT claims: `{sub, gid (active group), mem: [{e: entityId|"*", r: roles[]}], prole?}`; expiry 12 h; `POST /auth/switch-group` if a user belongs to several groups (CA persona).
- `POST /auth/signup` creates a trial Group + Entity + `group_admin` user; never allows self-assigning other roles to other users; email normalised; password policy ≥ 10 chars, not in a small common-password list; bcrypt cost 12.
- `loadScope` middleware attaches `req.scope = {groupId, entityIds, rolesByEntity, permissions}`; query helper `scoped(Model, req)` that always injects `groupId` and `entityId ∈ entityIds`. **Every** v2 route uses it (add a test that iterates registered v2 routes and asserts a scope check exists, e.g. via a route metadata registry).
- `rbac.js`: permission names exactly from 01 §8 (e.g. `po.create`, `po.approve`, `grn.record`, `qc.record`, `doc.upload`, `finding.decide`, `payment.release.maker`, `payment.release.checker`, `supplier.bank.maker`, `supplier.bank.checker`, `policy.manage`, `user.manage`, `evidence.export`, `copilot.use`, `audit.read`). `sod.js`: rules from 01 §8 with explicit denial reasons.
**Tests:** cross-group IDs → 404; role matrix table-driven test (each role × permission); SoD denials; signup cannot escalate.

### P1-B3 — Masters & policies (1 day)
- `Supplier` (with bank-account maker-checker workflow and `accountHash` = HMAC-SHA256(accountNo, server secret); store only masked + hash), `Item` (aliases), `HsnMaster` (seeded from A's `assets/hsn_master.*.json.gz` by `services/seed/hsn.js`; versioned; read-only API `GET /hsn/search` — or proxy to engine lookup to avoid duplication: **decision: server stores a copy for search/autocomplete; engine remains authoritative for rates in tax computation**).
- `Policy` per entity: tolerances, DoA matrix, numbering series, MSME defaults, terms templates (seed sensible defaults: payment terms, delivery, inspection, warranty, penalty/LD, dispute/jurisdiction, GST compliance clause, e-invoice/e-way-bill clause, MSME clause — mark templates "sample — review with your legal adviser").
- GSTIN validation on save by calling engine `/v2/validate/gstin` (or a JS port of the checksum in `lib/` with identical tests; **decision: JS port allowed for instant form validation, tests use the same fixtures as A**).

### P2-B4 — Documents & PO/PI lifecycle (3 days)
- `Document` model = BusinessDocument (02 §3) with Zod validation per `type`. `DocumentLink` model.
- Draft → compute (proxy to engine `/v2/tax/compute`, persist returned taxes/totals/warnings on the draft) → submit (DoA routing from policy: find rule by docType + grand total; required approver roles) → approve/reject (SoD: approver ≠ creator; record in audit) → issue (atomic numbering per entity/FY/series via `findOneAndUpdate({entityId, "numbering.docType":..., "numbering.fy":...}, {$inc: {"numbering.$.nextSeq":1}})`; FY rollover creates a new series entry automatically; render number by pattern tokens `{ENT}`, `{DOC}`, `{FY}` (e.g. `26-27`), `{SEQ:6}`) → `contentHash` = SHA-256 of canonical JSON (sorted keys, no volatile fields) → verify URL `PUBLIC_APP_URL/verify/<hash>`.
- Amendments create a new revision linked by `supersedes`; issued revisions are immutable; show diff via `GET /documents/:id/diff?against=<rev>`.
- Short-close, cancel (with reason; cancelled docs keep number).
- PI: `PI_IN` (record received PI; links to PO or precedes it; advance payments link to PI) and `PI_OUT` (our distribution entity creates PI for its customers; uses the same wizard with seller = our entity).
- Lifecycle aggregation per PO line for `GET /documents/:id` (computed by engine snapshot when available; fallback simple sums labelled `approximate:true`).
- `GET /documents/:id/render-model` (everything D needs for the PDF, 02 §5.3) with signed short-lived URLs for letterhead images.
- Public `GET /verify/:hash` (rate-limited) returning minimal non-sensitive fields.
**Tests:** DoA routing, SoD, numbering concurrency (20 parallel issues → 20 unique sequential numbers), FY rollover, amendment immutability, verify endpoint.

### P2-B5 — Files & ingestion orchestration (2 days)
- `POST /files`: multer memory storage with `limits.fileSize = MAX_UPLOAD_MB`; sniff magic bytes (`file-type`); allow pdf, png, jpeg, webp, csv, xlsx, json; reject others; SHA-256 dedupe per group; store in GridFS bucket `uploads`; never trust client mime.
- Extraction job (`jobs/handlers/extract.js`): status transitions on `extraction_drafts`; call engine `/v2/docs/parse`; if `needsLlm` and data policy allows (`AI_DATA_POLICY` + entity consent flag + demo sandbox) call gateway `/internal/llm/extract` (send text when available, images otherwise); then engine `/v2/docs/validate` with known document numbers for duplicate hints; store fields with confidence; auto-confirm only when policy `autoConfirmHighConfidence=true` AND every required field ≥ 0.95 AND no issues (default **off**).
- Confirm → create Document (provenance `EXTRACTED_REVIEWED`), Evidence locators (page + quote), links (supplier, PO suggestions confirmed by user), enqueue reconcile for affected cases, call gateway `/internal/rag/index` with document text (fire-and-forget, retry later).
- Keep and upgrade existing JSON/CSV structured import paths to v2 types (idempotent by checksum, preview before commit, no AI filling of critical fields).
- Bank CSV import with column mapping + UTR dedupe; GSTR-2B JSON import (official schema from GST portal download) → `GSTR2B_ENTRY` documents; IMS export import.
**Tests:** oversized/unsupported file rejected; duplicate file returns `duplicateOf`; gateway down → draft `needs_review` with method `text_layer`/manual and a clear message (never stuck in `extracting`); idempotent confirm.

### P2-B6 — Cases, reconciliation orchestration, decisions (2 days)
- Auto-create a `po` case when a PO is issued or first referenced by an ingested document; supplier-period cases on demand.
- Reconcile job: collect documents for the case (PO + everything linked/candidate by supplier & date window), policy, reviews → engine `/v2/reconcile/case` (flag `RECON_V2`; legacy path otherwise) → store immutable snapshot (id from engine) → upsert denormalised `findings` → project graph → bump case revision → audit.
- Decisions: validate `expectedRevision` & `snapshotId`; permission `finding.decide`; SoD; review kinds (`confirm_duplicate`, `allocate_payment` (must match one of engine's allocation solutions or a manual allocation that conserves cash — engine validates), `accept_variance`, `link_documents`); then re-reconcile.
- Jobs runner: Mongo-backed queue with lease (`lockedUntil`), retries with exponential backoff (max 5), dead-letter status, progress field; one runner per process; safe on Render restarts.
- Engine/gateway HTTP client (`lib/http.js`): timeouts, 3 retries with jitter on 502/503/504/ECONNRESET, circuit breaker (open 30 s after 5 consecutive failures), cold-start awareness (`UPSTREAM_UNAVAILABLE` with `retryAfterMs` to client).

### P2-B7 — Neo4j projection v2 & graph API (2 days)
- `graph/projector.js`: idempotent `MERGE` of nodes/relationships per 02 §8 from Documents/Links/Findings/Suppliers/Entities, batched with `UNWIND` (≤ 500 rows per tx), constraints `CREATE CONSTRAINT IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE` (same for Supplier, Entity, Item, Finding). Every query parameterised and filtered by `groupId`.
- `graph/queries.js`: case graph (layered by stage), neighbourhood (depth ≤ 2, ≤ 300 nodes), shortest evidence path (`shortestPath` ≤ 6 hops, relationship whitelist), supplier network.
- `graph/fromSnapshot.js`: same `GraphPayload` built from snapshot when Neo4j is unavailable (`source:"snapshot"`).
- Add `timeline` buckets (from engine payload or by document dates) for D's replay scrubber.
**Tests:** projection idempotent (run twice → same counts); cross-group isolation in Cypher; fallback when driver throws.

### P3-B8 — Dashboard & compliance APIs (1½ days)
`/dashboard/today` (aggregate open findings, holds, approvals waiting for this user, deadlines from engine `/v2/compliance/deadlines`, ITC at risk), `/compliance/gstr2b?period=` (match `GSTR2B_ENTRY` to `INVOICE_IN` by supplier GSTIN + normalised number + FY; statuses matched/missing-in-2B/missing-in-books/value-mismatch), `/compliance/msme`, `/compliance/rule37`, `/compliance/tds?fy=`. Cache per group for 60 s.

### P3-B9 — Audit hash chain & evidence packs (1 day)
`audit_log` append-only with per-group `seq` and `hash = SHA256(prevHash + canonical(entry))`; `GET /audit/verify` recomputes; all mutations (documents, decisions, policies, users, bank changes, file uploads, AI extraction confirmations) write entries. `GET /cases/:id/evidence-pack` → JSON (case, snapshot, findings, decisions, documents summary, audit excerpt, verification hashes) for D's PDF.

### P3-B10 — Research & model info proxy (½ day)
`GET /api/v2/research/evaluation` → engine `/v2/evaluation/report` (cached 1 h) and `GET /api/v2/research/models` → `/v2/models/status`. Public (no customer data inside).

### P2/P3-B11 — Demo seed v2 (1 day)
`services/seed/demoV2.js` (runs when `DEMO_MODE=1`): fictional group **"Vasundhara Industries Group"** — parent `Vasundhara Industries Ltd` (Maharashtra, code `VIL`), children `Vasundhara Pumps Pvt Ltd` (Pune, MH, code `VPPL`), `Vasundhara Engineering LLP` (Gujarat, code `VEL`), `Vasundhara Exports Pvt Ltd` (Karnataka, code `VXPL`, LUT on file). GSTINs generated checksum-valid and fictional (A's helper; document as fictional). Suppliers, items, HSN, policies, demo users (keep existing demo emails working; add `buyer@`, `stores@`, `quality@`, `treasury@`, `group.admin@`, `ca@` with `@satya.demo`), documents from A's `demo_v2.jsonl`, including the unchanged flagship PO-1001 case. Idempotent; never runs in production unless `DEMO_MODE=1`.

### P1–P4-B12 — Security baseline
`helmet` (CSP handled by client; API sends no HTML except status page), strict CORS from `ALLOWED_ORIGINS`, `express.json({limit:"1mb"})`, Zod validation on every body/query, Mongo operator injection guard (reject keys starting with `$` or containing `.` in user input), rate limits (auth 30/15 min per IP, writes, uploads 30/h per user), uniform error handler (no stack traces in production), request IDs, structured logs without secrets/PII (mask GSTIN partially in logs, never log bank numbers or tokens), password reset flow (email sending optional: if no mail provider configured, admin-reset only — say so in UI), session revocation via `tokenVersion` on user.

### Infra tasks (you own root files)
- **docker-compose.yml**: add resource limits (P0-B0); gateway env `GEMINI_API_KEYS` from `chatbot-backend/.env` (env_file), `DB_URI` for AI collections; healthchecks for all services; `depends_on: condition: service_healthy`.
- **render.yaml**: add `GATEWAY_API_URL` to server, `GEMINI_API_KEYS` (sync:false), `AI_DATA_POLICY`, `FEATURE_V2_*` (default "0" until launch), `DB_URI` (sync:false) to gateway; remove legacy vars; keep `region: singapore`, `plan: free`. Coordinate with human for secret entry.
- **Makefile**: `make up`, `make down`, `make test` (engine pytest → server → gateway → client unit), `make seed`, `make health`, `make e2e` (D's Playwright), `make train` (engine CLI with caps).
- **CI** `.github/workflows/ci.yml`: on push/PR to main — jobs: engine (python 3.11, pip install runtime+dev, pytest), server (node 20, services mongo:7 + neo4j:5 with small heap, `npm ci && npm test`), gateway (`npm ci && npm test` with LLM calls mocked), client (`npm ci && npm run lint && npm run build && npm test`). Cache npm/pip. No secrets required (LLM mocked).
- **README.md**: product summary, architecture diagram, local setup (Docker resource advice), env vars table (no values), demo accounts, scripts, deployment notes, links to `docs/plan` and `docs/team`.

## 4. Handoffs
- To A: demo dataset, decision exports for training (`scripts/export-labels.mjs`).
- To C: server tool endpoints the copilot uses (all `GET`s above are the tool surface); provide a compact `GET /api/v2/copilot/context?caseId=` endpoint returning `{case summary, ledger, top findings, key documents, links}` ≤ 30 kB to reduce tool calls.
- To D: OpenAPI-ish summary generated from Zod schemas at `GET /api/v2/meta/openapi.json` (use `zod-to-json-schema` or handwritten) + fixtures under `server/test/fixtures/v2/*.json` that D can copy into client mocks.
