# Hackathon Full-Stack Template

A production-grade multi-service template for hackathons. Ships with a polished Next.js frontend, an Express application server (auth, DB, realtime), an Express AI/chatbot gateway (LLM copilot, tool calling, streaming), and a Python ML service — all wired together with Docker Compose.

The bundled implementation is a working example ("Arth Saathi" — a privacy-preserving financial-risk platform). Replace the domain content per project; the architecture is domain-agnostic. See **TEMPLATE.md** for the adaptation checklist.

## Architecture

```
client (Next.js :3000)
   │
   ├─► chatbot-backend (Express :5001) ──► ml-fl-service (FastAPI :8000)
   │        │                                    │
   │        └── JWT verify + audit proxy ────────┘
   │
   └─► server (Express :5002) ──► MongoDB (:27017) · Neo4j (:7474/:7687)
            └── Socket.IO (realtime progress/rooms)
```

| Service | Purpose | Port |
|---|---|---:|
| `client` | Next.js 15 + React 19 + Tailwind + shadcn-style UI kit | 3000 |
| `chatbot-backend` | AI copilot gateway: Gemini/Groq/Featherless chat, tool calling, file upload, TTS/STT, authenticated ML proxy | 5001 |
| `server` | App backend: JWT auth + roles, MongoDB models, consent/audit APIs, Neo4j graph API, Socket.IO | 5002 |
| `ml-fl-service` | Python FastAPI + Flower/PyTorch: model training, federated learning, inference, explainability | 8000 |
| MongoDB | Users, consent, audit, conversations | 27017 |
| Neo4j | Graph store (optional — remove if unneeded) | 7474/7687 |

## Quick start

```bash
docker compose up -d --build   # all six services
make health                    # verify 200s
```

Or run services directly:

```bash
cd server && npm ci && npm run dev                    # :5002
cd chatbot-backend && npm ci && npm run dev           # :5001
cd client && npm ci && npm run dev                    # :3000
cd ml-fl-service && python3.11 -m venv .venv && source .venv/bin/activate \
  && pip install -r requirements.txt && uvicorn app:app --reload --port 8000
```

## Environment

```bash
cp server/.env.example server/.env
cp chatbot-backend/.env.example chatbot-backend/.env
cp client/.env.example client/.env
cp ml-fl-service/.env.example ml-fl-service/.env
```

Rules: `JWT_SECRET` must match between `server` and `chatbot-backend`; `NODE_INTERNAL_TOKEN` must match across `server`, `chatbot-backend`, and `ml-fl-service`. Never commit `.env` files.

## What's included

- **Auth**: email/password + Google OAuth, JWT, roles (`citizen`/`analyst`/`admin`), invite codes, rate limiting, demo-user seeding.
- **Chatbot**: streaming chat, multi-provider LLM (Gemini/Groq/Featherless), deterministic tool layer with role-scoped data access, prompt-injection guards, mermaid/excalidraw diagram rendering, file upload parsing (PDF/DOCX/XLSX), STT/TTS.
- **Data layer**: MongoDB (users/consent/audit/conversations), Neo4j (graph queries + SSE stream), Supabase fallback for conversation persistence.
- **ML service**: data pipeline (download → features → partition → validate), baselines, federated training (FedAvg/FedProx/FedAdam + DP accounting + secure-agg simulation), calibrated inference + explanations, fairness reports, VFL/PSI demo.
- **UI**: landing page (hero/features/stats/sections), login/signup, protected role-based portals, chat interface with rich message rendering, dashboards, graph visualizers, consent center, audit log.
- **Ops**: Dockerfiles + Compose for every service, Make targets, health checks, GitHub Actions CI, per-service `.env.example`, test suites (`node --test`, `pytest`, live API contract tests).

## Verify

```bash
make test                        # Python suite (ml-fl-service)
cd chatbot-backend && npm test   # copilot policy + prompt-injection tests
cd server && npm test            # API contract tests (needs stack running)
cd client && npm run build       # strict production build
docker compose config --quiet
```

## Adapting this template

Read **TEMPLATE.md** — it maps every project-specific spot (branding, prompts, pages, models, seeds, DB names) you need to swap for a new hackathon.

Project docs and reference material from the original build live in `docs/`.
