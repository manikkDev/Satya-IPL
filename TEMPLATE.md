# TEMPLATE.md — Adapting this repo to a new hackathon

This repo is a reusable 4-service hackathon stack. The bundled app ("Arth Saathi", a financial-risk platform) is a **working reference implementation** — keep it as an example or replace piece by piece. This file maps every project-specific spot.

## TL;DR — new project checklist

1. Rename the root folder and set your project name in `package.json` files, `ml-fl-service/pyproject.toml`, README, and page titles.
2. Copy `.env.example` → `.env` in each service; set `JWT_SECRET` (same in `server` + `chatbot-backend`) and `NODE_INTERNAL_TOKEN` (same in all three backends). Add your LLM key (`GEMINI_API_KEY`/`GROQ_KEY`/`FEATHERLESS_*`).
3. `docker compose up -d --build` → `make health`.
4. Replace domain content per the tables below.

## What is generic vs. project-specific

| Layer | Generic (reuse as-is) | Project-specific (swap) |
|---|---|---|
| client | UI kit (`components/ui/*`), theme, auth context, protected routes, chat UI, landing page sections, `lib/api.ts` pattern | Landing copy/graphics (`components/*.jsx`, `public/`), portal pages (`app/analyst/*`, `app/citizen/*`, `app/graph`), `config/endpoints.js` |
| server | Express scaffold, JWT auth + roles + rate limits, Socket.IO rooms/webhooks, Mongo/Neo4j config, audit util | Models (`src/models/*`), routes (`consent`, `audit`, `graph`), `seedDemoUsers.js` emails/roles |
| chatbot-backend | LLM providers (Gemini/Groq/Featherless), chat+stream controllers, auth middleware, tool-layer pattern (`copilotTools.js`), upload pipeline, mermaid rendering, prompt-injection tests | System prompts (`src/prompts/*`), tool definitions (`copilotTools.js`), `mlClient.js` endpoints, `EXPERT_PROMPTS` map in `helpers/gemini.js` |
| ml-fl-service | FastAPI scaffold, settings, data pipeline pattern (download/features/partition/validate), Flower FL runner, DP accounting, inference+explanation pattern, test suite | Dataset modules (`data/*`), models (`models/*`), graph feature logic, `app.py` endpoints, `arth_fl` package (rename dir + `pyproject.toml` together) |

## Branding spots to change

- `client/src/app/layout.tsx` — `<title>`/metadata.
- `client/src/components/Navbar.jsx`, `Footer.jsx`, `HeroSection.jsx` etc. — logo + copy; logo files in `client/public/`.
- `client/src/lib/api.ts` — export filename `arth-saathi-data-export-*.json`.
- `docker-compose.yml` — `DB_URI` database name `arth_saathi`.
- `server/src/seedDemoUsers.js` — demo accounts `*@arthsaathi.demo` (disable via `SEED_DEMO_USERS=0`).
- `ml-fl-service/pyproject.toml` — `name = "arth-fl"`, `publisher`, `tool.flwr.app` config; `ml-fl-service/app.py` title.
- `ml-fl-service/arth_fl/` — Python package name (keep name consistent with pyproject or rename both).

## Common recipes

- **New page**: add `client/src/app/<route>/page.jsx`; protect with `<ProtectedRoute allowedRoles={[...]}>`; link it in `components/Navbar.jsx`.
- **New API on app server**: add route in `server/src/routes/` + mount in `routes/index.js`; add model in `src/models/`; audit writes via `utils/audit.js`.
- **New chatbot capability**: add a tool in `chatbot-backend/src/helpers/copilotTools.js` (deterministic, role-scoped) + extend `src/prompts/copilotPrompt.js`. Personas go in `EXPERT_PROMPTS` (`helpers/gemini.js`).
- **New ML endpoint**: add route in `ml-fl-service/app.py`; it is automatically reachable through the gateway — add a proxy handler in `chatbot-backend/src/routes/flRoutes.js` (rename as needed) with `authenticate`/`requireRole`.
- **Realtime**: emit via `app.get("io")` in `server`; client joins rooms over Socket.IO (see `fl:subscribe` pattern) or SSE (`/graph/stream`, `/fl/stream/:id`).

## Removed during template cleanup (recoverable from git history)

- Leftover routers from earlier projects: `medicine`, `youtube`, `threats`, `alerts`, `cases`, `actions`, `metrics`, `email`, `sms`, `social` + ~20 orphan helpers/controllers/prompts (crypto/stock/real-estate expert personas, threat-intel pipeline, email/SMS/social monitors).
- Client: redirect-stub pages (`alerts`, `cases`, `feeds`, `analyze`), `src/api/*` legacy proxy routes, `src/examples/`, unused components (`ThreatGraphViewer`, `CTASection`, `ChatbotPreview`, `EmptyState`, `LoadingSkeleton`, `HistorySelect`, `source-preview`, `rotating-background`, `gradient-bg`, `SpeechToText`, `scroll-area`).
- Dead npm deps removed from `client` and `chatbot-backend` manifests.

If you need any of that back for a new project: `git show <cleanup-commit>^:<path>`.

## Gotchas

- `client` builds with `output: 'standalone'` — serve production via `node .next/standalone/server.js`, not `next start`.
- `reactStrictMode` is intentionally `false` (double-invoked effects break SSE).
- `ml-fl-service` Docker image pins CPU-only PyTorch — do not swap to the default ARM wheel on Apple Silicon.
- `ARTH_DATA_HASH_KEY` must be a stable secret; changing it requires regenerating processed/partitioned data.
- The chatbot gateway degrades gracefully without `GEMINI_API_KEY` (copilot disabled, APIs still work).
- The FastAPI title, Mongo DB name, and demo emails still say "Arth Saathi" — rename when you rebrand.
