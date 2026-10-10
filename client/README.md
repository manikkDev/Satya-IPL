# Arth Saathi web client

Next.js 15 frontend for the Arth Saathi privacy-preserving financial-risk platform.

## Portals

- `/citizen` — citizen risk profile scaffold.
- `/citizen/consent` — purpose-level consent and data-rights scaffold.
- `/analyst` — institution-scoped analyst dashboard scaffold.
- `/analyst/fl` — federated-learning control and convergence scaffold.
- `/analyst/graph` — pseudonymised risk-graph scaffold.
- `/analyst/fairness` — responsible-AI metrics scaffold.

## Environment

Copy `.env.example` to `.env`. Browser variables must contain only public service URLs; never place API keys or client secrets in `NEXT_PUBLIC_*` variables.

## Development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm run build
```

The inherited template still has legacy lint/type findings outside the Phase 0 route and API additions. The production build is the current frontend acceptance check.
