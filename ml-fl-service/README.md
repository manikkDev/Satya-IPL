# Satya engine

All financial reconciliation runs here using exact decimal arithmetic. The
`business_*.py` modules at the root are compatibility imports; implementation
lives in `satya_engine/`. Existing `/internal/*` routes are unchanged.

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

- `GET /`: service status page.
- `GET /health`, `GET /ready`: liveness, engine/model version and readiness.
- `/internal/demo`, `/internal/evaluation`: service-token authenticated reads.
- `/internal/import-preview`, `/internal/reconcile`: service-token authenticated
  computations.

The matching model uses constructed data, not real-world accuracy evidence.
Missing artifacts do not disable deterministic reconciliation.
