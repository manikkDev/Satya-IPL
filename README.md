# Satya — Evidence-led business operations

Satya investigates fragmented supplier purchases for an Indian equipment distributor. It reconstructs what was ordered, received, billed and paid, preserves ambiguities, and explains the next operational step.

This is an incremental hackathon prototype, not a production ERP, GST-compliance engine or autonomous payment system. The detailed roadmap is [docs/SATYA_IMPLEMENTATION_PLAN.md](docs/SATYA_IMPLEMENTATION_PLAN.md).

## Active stack

| Service | Responsibility | Local port |
|---|---|---|
| client | Next.js business workspace, evidence drawer, replay, scenario preview, copilot | 3000 |
| server | Company-scoped JWT/membership, MongoDB records/snapshots/jobs/decisions, Neo4j projection | 5002 |
| chatbot-backend | Authorized business retrieval, snapshot-backed answers, Neo4j graph, persisted conversations | 5001 |
| ml-fl-service | FastAPI reconciliation, exact Decimal math, reviewed links, calibrated XGBoost suggestions | 8000 |
| MongoDB | Authoritative records and history, new `satya` database | 27017 |
| Neo4j | Rebuildable case/snapshot-scoped evidence graph | 7474 / 7687 |

Old bank/citizen pages are archived in `client/legacy/`; their URLs redirect to the business workspace. The old banking, consent, FL and generic chatbot routers are not mounted. Old ML training modules are not imported by the new runtime. `TEMPLATE.md` is a historical template reference, not the current setup guide.

## Run

Docker Desktop must be running. Existing private `.env` files are preserved; do not overwrite them. For a fresh clone only, copy each service's `.env.example` to an absent `.env` and replace placeholders with local secrets.

`JWT_SECRET` must be configured for the application server; `NODE_INTERNAL_TOKEN` must match in server, gateway and engine. No external LLM key is needed for the current evidence narrator. The gateway forwards the user's authority to the server rather than querying databases directly.

```bash
docker compose up -d --build
make health
```

Open `http://localhost:3000/login`. Compose binds published ports to localhost and uses a new local `satya` MongoDB database. It does not delete the old database or volumes.

The local Compose demo enables `DEMO_MODE=1`. Default fictional accounts:

- `manager@satya.demo` — AP manager
- `analyst@satya.demo` — operations analyst
- `auditor@satya.demo` — read-only auditor

Default local demo password: `SatyaDemo@123`. Set `DEMO_PASSWORD` before first seeding for a custom password. Existing accounts are never silently overwritten. Disable demo mode/seeding and provision real memberships before deployment. The isolated/test companies are for access-control tests, not actual customers.

`docker-compose.hybrid.yml` is opt-in; it is no longer automatically merged into a full Docker startup. Do not run a host frontend and the Compose frontend on port 3000 simultaneously.

## Reproducible matching model

```bash
make train
```

This generates `ml-fl-service/runs/satya-linkage/model.json`, `evaluation.json` and split metadata, then restarts the engine to reload them. Artifacts are gitignored and must be regenerated on a fresh machine. With no valid artifact, deterministic reconciliation and explicitly labeled heuristic suggestions still work.

The classifier compares observed line/reference/specification features, is selected against a validation split, and uses a separate calibration split. The initial generator contains 1,600 base episodes / 9,600 constructed pairs with episode-disjoint splits, including ambiguous repeat orders. Results are visible at `/evaluation`; they are not real-company accuracy or proof of production calibration. Scores are suggestions, never automatic financial approval. Public BPI/FATURA integration and pretrained semantic encoders are subsequent phases.

## Demonstration

1. Open `PO-1001`: 100 ordered, 60 received, original invoice INR 70,800.
2. Two referenced settlements sum to INR 50,800; receipt-supported original outstanding is INR 20,000.
3. A second AP posting remains disputed. Posting-based open balance is INR 90,800 under the supplied settlement observations; this is not a separately imported general ledger.
4. INR 15,000 remains unallocated until remittance/reviewer evidence identifies the invoice. It is never deducted twice.
5. Inspect sources and the actual Neo4j graph. Ask the copilot and follow snapshot-specific citations.
6. An AP manager can confirm duplicate representation, payment allocation or an invoice-to-PO link, with a reason and stale-version guard.
7. Preview remaining delivery: it completes fulfillment but does not manufacture a new invoice or payment.

Additional constructed fixtures demonstrate inspection rejection, currency conflict, fully reconciled equipment and incomplete warehouse coverage. All companies, records, UTR references and tax assumptions are fictional; no GST portal/signature verification or live banking is performed.

## Verification

With the stack running and local Node dependencies installed:

```bash
make test
make build
docker compose config --quiet
```

Python tests cover conservation, source-repeat/UTR handling, reversals, exact balances, minor price tolerance, missing-key review, replay and unknowns. Server tests exercise the live MongoDB/Neo4j stack, idempotent imports, company isolation, roles, decisions and scenario immutability. Gateway tests verify grounded answers, citations, graph retrieval and access controls.

The frontend still uses `output: 'standalone'`. The Docker image copies static assets and launches the standalone server correctly; `next start` is not the production launcher for this setup.

## Current boundaries

- Structured JSON source bundles are implemented; mapped CSV, document OCR and extraction review are next layers.
- Supplier identity is explicit/assumed in demo exports; reviewed vendor-master/alias resolution is not yet a general entity-resolution service.
- Current money currencies are INR/USD/EUR with two-decimal settlement precision. Mixed-unit orders require separate case scope. Tax amounts are declarations, not legal validation.
- Price tolerance is a versioned prototype policy, not a statutory rule. Approval is an internal workflow instruction, never a money-transfer call.
- Replay applies current rules/models to observations known by the selected cutoff; it is a retrospective reconstruction, not a claim that today's model existed then.
- Chat currently retrieves authorized facts and generates deterministic explanations. Vector retrieval, optional LLM narration, richer analytics and conversational history browsing remain incremental work.
- General optimization over many-to-many remittance amounts, company-wide balance bounds and a full accounting ledger remain roadmap items.
- Local MongoDB is standalone. Immutable case inputs/snapshots, compare-and-swap and worker leases are used; no distributed transaction guarantee is claimed. Imports are serialized per company in the single API process; multi-instance import locking is a deployment extension.
- Existing optional/legacy frontend libraries and development dependencies still have audit advisories requiring further reviewed upgrades. No lint/type/security checks were bypassed and no forced breaking audit upgrades were run. Treat this as a local prototype, not a security-certified deployment.
