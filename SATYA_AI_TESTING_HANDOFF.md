# SATYA AI — FEATURE IMPLEMENTATION & TESTING HANDOFF HANDBOOK

> **Product:** Satya AI — *“Know what you actually owe, and why.”*  
> **Repository:** [https://github.com/manikkDev/Satya-IPL](https://github.com/manikkDev/Satya-IPL)  
> **Primary Target Branch:** `srl500/satya-ai-feature-implementation`  
> *(If your remote names the branch `feature/satya-ai-enhancements`, verify tracking against commit `1193d36` or latest)*  
> **Target Audience:** Verification Engineer / QA Teammate on a dedicated testing machine  
> **Testing Status:** Implementation Complete | All Local Execution Deferred to Teammate  

---

## 1. QUICK IMPLEMENTATION SUMMARY

This handbook is your operational guide to starting, verifying, and regression-testing Satya AI on a machine with adequate Docker and multi-service resources.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               GIT HANDOFF DETAILS                                │
│  Branch Name:      srl500/satya-ai-feature-implementation                        │
│  Base Branch:      main (origin/main)                                            │
│  Latest Commits:   1193d36 docs: add comprehensive product summary and handbook  │
│                    4ca7aec docs: add comprehensive research and engineering docs │
│                    8b7fbcb feat: complete remaining gaps across six core areas   │
│                    fb7a32a feat: implement 12 Satya AI product enhancements      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### What Changed in the Implementation:
- **`server/src/utils/lifecycleAndAnomalyService.js` (NEW):** Centralized Finite State Machine (FSM), strict Maker-Checker / Separation of Duties (SoD) gatekeeper, Median Absolute Deviation (MAD) anomaly scorer, and evidence checklist validator.
- **`server/src/utils/businessService.js`:** Enriched detailed audit logs, case context embedding, CSV/JSON report exports, and priority attention scoring.
- **`server/src/routes/businessRoutes.js`:** Mounted 8 new endpoints: `/dashboard/attention`, `/dashboard/summary`, `/alerts`, `/alerts/:id/acknowledge`, `/alerts/:id/dismiss`, `/cases/:id/documents`, `/documents/:id/verify`, `/cases/:id/reminders`, `/cases/:id/report`.
- **`server/src/models/Business.js`:** Added Mongoose sub-schemas for `AssignableUser`, `CaseDocument`, `CaseReminder`, `FinancialAnomaly`, and `EvidenceCompleteness`.
- **`server/test/business.test.mjs`:** Added integration test blocks covering FSM transitions, SoD blocking, self-approval prevention, duplicate handling, and CSV provenance.
- **`client/src/lib/business-api.ts`:** Added strongly typed client bindings for all 12 feature areas.
- **`client/src/app/` (UI):** Updated `/dashboard`, `/cases/[id]`, and `/audit` to render priority tables, document verification tabs, anomaly tags, and enriched audit context.

---

## 2. THE 12 APPROVED FEATURES — VERIFICATION MATRIX

| # | Feature Area | What Was Added vs. Pre-Existing | Where to Test | How to Test | Expected Result | Implementation Status |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Smart Obligation Tracking** | Pre-existing 60-decimal engine enriched with multi-case dashboard aggregation. | `/dashboard`<br>`GET /dashboard/summary` | Open `/dashboard` with seeded cases; observe primary metric cards. | Supported balance reflects delivered goods less settled payments; does not equal gross invoice. | **Newly Enriched (Implemented)** |
| **2** | **Evidence-Linked Reconciliation** | Pre-existing locator architecture linked to case UI and report exports. | `/cases/[id]` (Tab 1 & 5) | Click any finding chip (e.g. `QUANTITY_MISMATCH`). | Evidence drawer opens displaying exact document ID, row, column, and raw ingested value. | **Existing (Regression Test)** |
| **3** | **Discrepancy Explanation Engine** | Automated classification of quantity, price, duplicate, and unlinked payment issues. | `/cases/[id]` (Summary Tab) | Inspect the *Supporting Record Checks* findings accordion. | Findings clearly state discrepancy title, certainty, severity, and recommended action. | **Existing (Regression Test)** |
| **4** | **Transaction Lifecycle State Machine** | Centralized FSM transition matrix and Maker-Checker enforcement. | `test/business.test.mjs`<br>`/cases/[id]` | Try approving a case with the same user who imported it; try invalid transition from `reconciled`. | Self-approval returns `403 Forbidden`; invalid transition returns `409 Conflict`. | **Newly Added (Implemented)** |
| **5** | **Duplicate & Anomaly Detection** | Median Absolute Deviation (MAD) anomaly scorer and fuzzy duplicate candidate quarantine. | `/cases/[id]` (Tab 5)<br>`test/business.test.mjs` | Ingest duplicate invoice payload (see line 80 of `business.test.mjs`). | Duplicate flagged; duplicate amount added to `disputedExposure`; original canonical AP preserved. | **Newly Added (Implemented)** |
| **6** | **Risk & Priority Dashboard** | Multi-signal priority scoring algorithm on open investigations. | `/dashboard`<br>`GET /dashboard/attention` | View *Needs Attention* table on `/dashboard`. | Cases ranked descending by priority score; each item lists specific rules (e.g. Blocking findings). | **Newly Added (Implemented)** |
| **7** | **Connected Transaction Graph** | Neo4j Cypher projection with graceful frontend fallback. | `/cases/[id]` (Tab 3)<br>`/chat` graph toggle | Open *Record Connections* tab; toggle graph in chat answer. | Renders interactive force layout (PO, GRN, INV, PAY nodes connected by DELIVERS, SETTLES). | **Existing (Regression Test)** |
| **8** | **Exception Resolution Workflow** | Case assignment, exception status tagging, and mandatory 10-char rationale. | `/cases/[id]` header & actions | Select user from assignment dropdown; submit decision with <10 characters. | Submitting <10 chars blocked by client/server; assignment updates case context. | **Newly Added (Implemented)** |
| **9** | **Document Management & Verification** | SHA-256 document hashing, verification toggles, and evidence checklist. | `/cases/[id]` (Tab 6)<br>`POST /documents/:id/verify` | Navigate to *Documents* tab; click *Verify* or *Reject* on a document. | Manager stamp recorded with timestamp; document verification status updates. | **Newly Added (Implemented)** |
| **10** | **Financial Insights Dashboard** | Cross-case supplier balance summaries and multi-currency warning banner. | `/dashboard`<br>`GET /dashboard/summary` | Ingest cases with distinct currencies (INR and USD). | Prominent *Mixed Currency Warning* banner appears; balances grouped by currency. | **Newly Added (Implemented)** |
| **11** | **Smart Alerts & Reminders** | High-priority alert banner, dismiss/acknowledge endpoints, and case reminders. | `/dashboard` alert row<br>`/cases/[id]` Reminders | Create a reminder on `/cases/[id]`; click *Acknowledge* on dashboard alert. | Banner dismisses/updates; reminder persists and displays in case context. | **Newly Added (Implemented)** |
| **12** | **Audit Trail & Evidence Reports** | Enriched audit trail with case context and one-click JSON/CSV report download. | `/audit`<br>`/cases/[id]/report?format=csv` | Click *Export CSV* or *Export JSON* button on case header. | Downloads structured, tamper-evident audit report containing ledger snapshot and findings. | **Newly Added (Implemented)** |

---

## 3. MINIMAL SETUP & STARTUP GUIDE

### Prerequisites on Teammate Laptop:
- **Node.js:** v18.x or v20.x LTS
- **Python:** 3.10+ (with `pip` and virtual environment support)
- **Docker Desktop:** Running (for MongoDB and Neo4j)

---

### Path A: Lightweight Testing (Unit & Focused Backend Tests)
*Use this path if you want to verify algorithms and logic quickly without starting every frontend/graph container.*

```bash
# 1. Clone or pull the branch
git checkout srl500/satya-ai-feature-implementation
git pull origin srl500/satya-ai-feature-implementation

# 2. Start only MongoDB via Docker (or use a local MongoDB instance)
docker run -d --name satya-mongo -p 27017:27017 mongo:7

# 3. Configure Server Environment
cd server
cp .env.example .env
# Ensure DB_URI=mongodb://localhost:27017/satya and DEMO_PASSWORD=SatyaDemo@123 in .env

# 4. Install dependencies
npm install

# 5. Run the focused tests
npm test
```

---

### Path B: Full Stack Integration Testing (Docker Compose)
*Use this path to verify the entire system end-to-end, including UI, Neo4j graph, ML service, and AI chat.*

```bash
# 1. Ensure Docker Desktop is active
docker compose version

# 2. Prepare Environment Files from Templates
cp server/.env.example server/.env
cp ml-fl-service/.env.example ml-fl-service/.env
cp chatbot-backend/.env.example chatbot-backend/.env

# Note: In server/.env and chatbot-backend/.env, ensure:
# JWT_SECRET=test-secret-key-1234567890-satya-demo
# DEMO_PASSWORD=SatyaDemo@123

# 3. Launch the Stack
docker compose up -d

# 4. Verify Service Health
docker compose ps
# Confirm all 6 services are healthy:
# - mongo (27017)
# - neo4j (7474, 7687)
# - ml-fl-service (8000)
# - server (5002)
# - chatbot-backend (5001)
# - client (3000)

# 5. Access the Web Application
# Open browser to: http://localhost:3000
# Demo Logins:
# - Manager:  manager@satya.demo  / SatyaDemo@123
# - Analyst:  test-analyst@satya.demo / SatyaDemo@123
# - Auditor:  auditor@satya.demo  / SatyaDemo@123
```

---

## 4. EXACT TEST COMMANDS & DIAGNOSTICS

Execute all commands from the `server/` directory:

```bash
cd server
```

### 1. Run Complete Backend Test Suite
```bash
npm test
```
*Executes `node --test test/business.test.mjs` against the running server on port 5002.*

### 2. Run Focused State Machine & Maker-Checker Tests
```bash
node --test --test-name-pattern="state machine" test/business.test.mjs
```
*Validates: (a) decision on importing case rejected, (b) decision on reconciled case rejected, (c) self-approval blocked, (d) state transition history recorded.*

### 3. Run Focused CSV Ingestion & Idempotency Tests
```bash
node --test --test-name-pattern="CSV preview" test/business.test.mjs
```
*Validates row/column provenance tracking and idempotent repeated file uploads.*

### 4. Run Focused RBAC & Company Isolation Tests
```bash
node --test --test-name-pattern="other company" test/business.test.mjs
```
*Confirms cross-tenant data leakage is strictly prevented.*

### Diagnostics & Log Inspection:
- If a test times out waiting for reconciliation:
  ```bash
  docker compose logs -f ml-fl-service
  ```
- If MongoDB connection fails:
  ```bash
  docker compose logs server | grep Mongo
  ```

---

## 5. PRIORITIZED REGRESSION TEST CHECKLIST

Mark each item during your verification session:

### A. Financial Correctness
- [ ] **[REQUIRED] Partial Delivery:** Verify that delivering 80 out of 100 pumps sets `supportedOutstanding` to ₹80,000 and `openDelivery` to 20 units.
- [ ] **[REQUIRED] Disputed Overbilling:** Verify that billing for 100 units when 80 arrived flags `QUANTITY_MISMATCH` with `disputedExposure` = ₹20,000.
- [ ] **[REQUIRED] Duplicate Invoice:** Ingest identical invoice numbers or amounts; verify system flags `DUPLICATE_CANDIDATE` and quarantines balance.
- [ ] **[REQUIRED] Unallocated Payments:** Ingest bank wire without matching invoice reference; verify payment is tracked under `unallocatedPayments` without double-crediting.
- [ ] **[REQUIRED] Precision Arithmetic:** Confirm that no fractional rounding artifacts (e.g. `.00000004`) appear anywhere in displayed or exported ledgers.

### B. Workflow & State Machine Correctness
- [ ] **[REQUIRED] Permitted Transition:** `open` → `in_review` → `under_investigation` → `reconciled`.
- [ ] **[REQUIRED] Forbidden Transition:** Attempting to transition `reconciled` → `open` directly throws HTTP 409 Conflict.
- [ ] **[REQUIRED] Self-Approval Prevention (SoD):** User who imported/created a case is rejected with HTTP 403 when submitting `APPROVE`.
- [ ] **[REQUIRED] Manager Sign-Off:** Independent manager (`ap_manager`) can successfully approve an escalated case.
- [ ] **[REQUIRED] Decision Justification:** Submitting any decision with a reason under 10 characters is blocked by client and server.

### C. Security, Isolation & Multi-Tenancy
- [ ] **[REQUIRED] Tenant Isolation:** Login as `isolated@satya.demo`; confirm that querying `pumps-1001` returns HTTP 404.
- [ ] **[REQUIRED] Auditor Role Restriction:** Login as `auditor@satya.demo`; confirm all POST/PUT reconciliation and decision endpoints return HTTP 403.
- [ ] **[REQUIRED] CSV Formula Injection:** Upload a CSV containing `=CMD|' /C calc'!A0`; verify string is escaped with prepended apostrophe.

### D. Reliability & Graceful Degradation
- [ ] **[CONDITIONAL] Neo4j Down:** Stop Neo4j container (`docker stop satya-ipl-neo4j-1`); verify `/cases/[id]` renders fallback graph from MongoDB snapshot without crashing.
- [ ] **[REQUIRED] Concurrency Conflict:** Send two concurrent decisions with identical `expectedRevision`; verify second request fails with HTTP 409 Conflict.

---

## 6. ISSUE-REPORTING TEMPLATE FOR TEAMMATE

If any test fails or produces unexpected behavior, copy and fill out this template:

```markdown
### Satya AI Bug Report
- **Feature Name:** (e.g., Feature 4: Lifecycle State Machine)
- **Host Environment:** (OS, Docker Desktop version, Node version)
- **Git Branch & Commit:** (e.g., srl500/satya-ai-feature-implementation @ 1193d36)
- **Setup Path Used:** (Path A Lightweight or Path B Docker Compose)
- **Command / UI Steps Executed:**
  1. Login as test-analyst@satya.demo
  2. Navigate to /cases/pumps-1001
  3. Attempted to execute action APPROVE
- **Expected Result:** (e.g., HTTP 403 Forbidden with Segregation of Duties message)
- **Actual Result:** (e.g., HTTP 500 or Action succeeded)
- **Error Log Output:**
  ```
  [Paste sanitized log snippet here - redact any private credentials]
  ```
- **Severity:** (Blocker / High / Medium / Low)
```

---

## 7. FINAL TESTING COMPLETION CHECKLIST

Complete and send this checklist back to the implementation team upon finishing:

- [ ] Checked out branch `srl500/satya-ai-feature-implementation` and verified clean working tree.
- [ ] Configured local `.env` files safely from `.env.example` templates without committing them.
- [ ] Successfully launched testing dependencies (Docker Compose or local Mongo/Python).
- [ ] Ran focused state machine tests (`node --test --test-name-pattern="state machine"`).
- [ ] Ran full backend integration test suite (`npm test`).
- [ ] Verified UI on `http://localhost:3000` (Dashboard, Investigations, Purchase Orders, Audit).
- [ ] Tested 100 pumps financial discrepancy scenario (Verified ₹80,000 supported vs ₹20,000 disputed).
- [ ] Tested Maker-Checker self-approval blocking on case decisions.
- [ ] Tested cross-company tenant isolation (`isolated@satya.demo`).
- [ ] Tested export reports (Downloaded and verified CSV and JSON files).
- [ ] Confirmed that no sensitive `.env` files or credentials were committed to Git.
- [ ] Shared completed testing report with the team.
