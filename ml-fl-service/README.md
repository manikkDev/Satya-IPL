# Satya engine

All financial reconciliation runs here using exact decimal arithmetic. The
`business_*.py` modules at the root are compatibility imports; implementation
lives in `satya_engine/`. Existing `/internal/*` routes are unchanged — every
`/v2/*` feature is behind `FEATURE_V2_RECON_V2=1` plus the internal service
token, default off.

## Owner verification

From the repository root, build the isolated development target once:

```sh
docker compose -f docker-compose.yml -f ml-fl-service/compose.owner.yml up -d --no-deps --build ml-fl-service
docker compose exec -T ml-fl-service python -m pytest -q tests
```

The override caps the engine at 2 GB and 2 CPUs. BLAS/OpenMP thread caps are 2.
Run only one heavy job at a time. Do not run training or dataset processing
using host Python. When only Python files change, copy the owned source/test
files into the test container rather than rebuilding dependencies.

The default Dockerfile target is production: test dependencies are installed
only in the `test` target, never the deployed image.

## Endpoints

Public:
- `GET /` — service status page
- `GET /health`, `GET /ready` — liveness/readiness

Legacy (`x-internal-token`, always on):
- `/internal/demo`, `/internal/evaluation`, `/internal/import-preview`, `/internal/reconcile`

v2 (`FEATURE_V2_RECON_V2=1` + token; returns `{error:{code,message,requestId}}`):
- `GET /v2/schema` — frozen contract JSON Schemas
- `POST /v2/validate/gstin` — structural + checksum validation
- `POST /v2/tax/compute` — GST split, LUT/RCM, verified-rates only (422 on missing/conditional)
- `POST /v2/reconcile/case` — event-sourced reconciliation, findings, GraphPayload
- `POST /v2/allocate/payment` — exact subset-sum, TDS-aware, uniqueness reporting
- `POST /v2/match/candidates` — blocked pair scoring → conformal prediction sets
- `POST /v2/docs/parse` — PDF text/QR/e-invoice JSON, no LLM inside the engine
- `POST /v2/docs/validate` — field validators + per-field confidence
- `POST /v2/compliance/deadlines` — MSME 45, Rule 37, e-invoice 30, PO schedule
- `POST /v2/anomaly/score` — robust-z on median/MAD cohorts
- `GET /v2/models/status` — model cards from `runs/satya-models/`
- `GET /v2/evaluation/report` — real metrics on generated labelled pairs
- `POST /v2/train` — retrain on generated + reviewer `labelledPairs` (gated by `ALLOW_TRAIN`/`ALLOW_ENGINE_TRAIN`)

## Models

Pair models live in `runs/satya-models/<task>/<version>/` (`model.ubj`,
`conformal.json`, `card.json`). Cards record data sources, splits, metrics and
limitations. All current models are trained on generator output
(`CONSTRUCTED_DEMO`) — not real-world validated. Missing artifacts fall back to
the deterministic heuristic scorer, never crash.

## Inputs humans must supply

- `assets/hsn_master.csv|xlsx` — official HSN+rate directory (see `HSN_SOURCES.md`)
- `assets/irp_public_keys/*.pem` — IRP certificates from `einvoice.gst.gov.in/publickeys`
- BPI Challenge 2019 export — for fitted lag distributions

## Budgets

- ≤ 2,000 documents per reconcile call; ≤ 10 MB uploads; ≤ 20 candidate items per allocation
- Idle RSS ~180 MB (target < 300 MB); startup < 15 s with lazy model loading
