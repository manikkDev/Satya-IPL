# Satya v2 — Implementation Plan (START HERE)

> This folder is the single source of truth for rebuilding Satya from a hackathon prototype into a publishable product.
> It is written for AI coding agents with a ~250k-token context window. **Read this file fully, then read ONLY the files your role needs** (table in §3). Do not load the whole repository into context.

Last research pass: 29 Oct 2026. Every external fact used here was verified against a primary or reputable source during that pass; sources are listed in `08_RESEARCH_REFERENCES.md`. If you need a fact that is not in this plan, verify it from a primary source (government portal, official docs, paper) before coding it. **Never invent tax rules, thresholds, rates, dataset contents, API model names or library APIs.**

---

## 1. What Satya v2 is (one paragraph)

Satya is an **evidence-led procure-to-pay (P2P) investigation and control platform for Indian manufacturing groups and their MSME suppliers**, starting with the **industrial engineering goods** sector (pumps, motors, valves, bearings, electricals, MRO and capital equipment). It lets a company group (parent + child entities, each with its own GSTIN) **create compliant purchase documents** (PO, PI, amendments) with correct GST, **ingest every downstream document** (supplier PI, tax invoice / e-invoice, e-way bill, delivery challan, GRN, quality inspection, credit/debit notes, bank payments with UTR, remittance advice, TDS, GSTR-2B/IMS data), **reconstructs the true state of every order line** (ordered → received → accepted → invoiced → paid → GST credit claimed), **separates harmless variances from costly errors**, attaches a **traceable evidence trail and calibrated confidence** to every finding, **refuses to guess when evidence is ambiguous**, prescribes the next step (**Approve / Request Clarification / Escalate / Place on Hold**), and lets non-technical users ask questions in plain language through a grounded copilot and an interactive money-trail graph.

The original hackathon problem statement (must remain fully satisfied — it is our acceptance baseline):
1. Match interdependent records even when keys, descriptions, quantities, or dates differ slightly.
2. Detect duplicate charges, partial deliveries, omitted records, and currency or amount mismatches.
3. Present traceable confidence levels and explicit evidence trails behind every flagged discrepancy.
4. Prescribe next operational steps (Approve, Request Clarification, Escalate, Place on Hold).
5. Categorise ambiguous entries rather than generating fabricated conclusions.
6. Demo: a PO is partially fulfilled, the supplier generates duplicate invoices, payments split across transfers → reconstruct totals, compute true balances, flag ambiguities.

## 2. Files in this plan

| File | Purpose | Who must read it |
|---|---|---|
| `00_START_HERE.md` | Rules, ownership, coordination, safety, git flow | **Everyone** |
| `01_DOMAIN_AND_PRODUCT.md` | Sector choice, how the Indian P2P chain works, document-by-document, tax/compliance rules, the **error taxonomy** the product must detect, personas, roles | **Everyone** (skim §1–2, read your relevant sections fully) |
| `02_ARCHITECTURE_AND_CONTRACTS.md` | Services, data model, **frozen API contracts** between agents, env vars, deployment constraints | **Everyone** (contracts are binding) |
| `03_AGENT_A_ENGINE_ML_DATA.md` | Reconciliation engine v2, tax engine, ML (matching, conformal ambiguity, anomaly), datasets, doc parsing (deterministic part), evaluation | Agent A |
| `04_AGENT_B_PLATFORM_API.md` | Node API, data model, multi-entity/RBAC, PO/PI/document lifecycle, numbering, approvals, Neo4j projection, file storage, jobs, audit, infra files | Agent B |
| `05_AGENT_C_AI_COPILOT.md` | Gemini key pool + usage meter, AI gateway, grounded agentic GraphRAG copilot, document extraction with LLM, evaluation | Agent C |
| `06_AGENT_D_FRONTEND_UX.md` | Design system, information architecture, every screen, money-trail graph, PO wizard + PDF export, copilot UI, landing/pricing/research/legal pages | Agent D |
| `07_QUALITY_SECURITY_RELEASE.md` | Test strategy, acceptance tests, security, DPDP/legal pages content requirements, phases & milestones, integration order, demo script | **Everyone** (read your phase checklist) |
| `08_RESEARCH_REFERENCES.md` | Papers (IEEE/ACM/VLDB/arXiv), datasets, government sources, competitor notes | Everyone when citing; Agent D for `/research` page |

The team-facing explanation (non-technical + technical) lives in `docs/team/`. Agents do not need it.

The old `docs/SATYA_IMPLEMENTATION_PLAN.md` and `docs/PROJECT_OVERVIEW.md` describe the hackathon prototype. They are **superseded** by this folder; read them only for historical context on existing behaviour.

## 3. The four agents and strict file ownership

Four agents work **in parallel on `main`**. Conflicts are prevented by **directory ownership**: you may only create/modify/delete files inside your owned paths. Everything else is read-only for you.

| Agent | Name | Owns (write access) | Never touches |
|---|---|---|---|
| **A** | Engine, ML & Data | `ml-fl-service/**` | everything else |
| **B** | Platform API, Domain & Infra | `server/**`, `docker-compose*.yml`, `render.yaml`, `Makefile`, root `README.md`, root `.gitignore`, `.github/**`, `scripts/**` (create) | `client/**`, `chatbot-backend/**`, `ml-fl-service/**` |
| **C** | AI Gateway & Copilot | `chatbot-backend/**` | everything else |
| **D** | Frontend & UX | `client/**` | everything else |

Shared, append-only coordination files (any agent may append, never rewrite others' entries):
- `docs/plan/handoffs/A.md`, `B.md`, `C.md`, `D.md` — a request **to** that agent from another agent ("D → B: need field `x` on `GET /api/v2/orders/:id`"). The owner replies inline under the request with `DONE <commit>` or `DECLINED <reason>`.
- `docs/plan/STATUS.md` — each agent appends a dated line after each milestone: `2026-10-30 A: P1-3 tax engine done (commit abc123), tests 41/41`.
- `docs/plan/CONTRACT_CHANGES.md` — the **only** way to change a frozen contract in `02_ARCHITECTURE_AND_CONTRACTS.md`. Append a proposal; the producing agent implements it backward-compatibly (add fields, never rename/remove in the same milestone); consumers adopt it after it lands. The contract file itself is edited only by Agent B after a change is agreed (B is the contract custodian).

`docs/plan/*.md` (the plan itself) is read-only for all agents. Only the human team edits it.

### Why this split
- A = everything numeric and statistical (one place for money math — no duplicated tax/balance logic in JS).
- B = persistence, identity, permissions, document lifecycle, graph projection, deployment — the integration hub.
- C = everything that talks to an LLM (one place for keys, quotas, prompts, safety, cost).
- D = everything the user sees.

## 4. Non-negotiable product rules (all agents)

1. **No invented numbers.** Money, quantity and tax values come only from source documents or from the Python engine's deterministic calculation. LLM output never produces a number that is shown to a user unless it is filled from a tool result (placeholder mechanism, see 05).
2. **Exact arithmetic.** Money is a decimal string with up to 2 decimals for INR display, stored as string with up to 6 decimals internally; computed with Python `Decimal` (engine) only. Quantities are decimal strings. No JS floats for money anywhere — the client formats strings, never adds them. If the client must show a live preview total, it asks the API (debounced) which asks the engine.
3. **Ambiguity is a first-class result.** Every link/finding carries `certainty ∈ {CONFIRMED, PROBABLE, POSSIBLE, AMBIGUOUS, INSUFFICIENT_EVIDENCE}` and, when ambiguous, the list of candidates. The system never silently picks one candidate.
4. **Evidence or it didn't happen.** Every finding, balance and chatbot sentence with a fact links to evidence IDs that resolve to a source document + field (+ page/row/cell).
5. **Humans decide money.** ML/LLM can suggest; only an authorised human role can Approve, confirm a duplicate, or allocate an ambiguous payment. Maker ≠ checker.
6. **No false verification claims.** Satya may say "IRN signature verified against IRP public key" only when it actually verified the signed QR JWS. A GSTIN that passes the checksum is "well-formed", not "active". Satya does not file returns and does not give tax/legal advice.
7. **Company isolation.** Every query is scoped by `groupId` (+ `entityId` where relevant). Cross-group access must be impossible by construction (middleware + query helpers + tests).
8. **Free-tier AI is demo-only for real data.** Gemini free-tier inputs may be used by Google to improve products (Gemini pricing page). Default config: real uploaded customer documents are processed by AI only when `AI_DATA_POLICY=paid_or_consented`; demo/sandbox data may use free tier. This must be reflected in the privacy policy and the upload UI.
9. **Plain language first.** Every screen must be understandable by a non-accountant business owner. Technical terms are always accompanied by a one-line explanation (tooltip or inline). See 06 §2 for the vocabulary map.
10. **Graceful degradation, never crash.** If Neo4j is down → graph served from snapshot. If the engine is cold-starting on Render → UI shows "waking up" with progress, retries with backoff. If all AI keys are exhausted → copilot answers in deterministic "evidence-only mode" and says so.

## 5. Machine-safety rules (the team's MacBook froze before — follow these exactly)

1. **One heavy job at a time per agent.** Heavy = Docker image build, `next build`, model training, dataset processing, full test suites with Docker. Never run two heavy jobs concurrently from the same agent.
2. **Agent D is the only agent that runs the Next.js dev server or `next build`** on the host. Other agents test against APIs.
3. **ML/data jobs run inside the `ml-fl-service` container with limits**, never on the host Python. Compose sets `mem_limit: 2g`, `cpus: 2` for the engine (Agent B adds this; Agent A requests via handoff if more is needed). Training code sets `n_jobs=2`, `OMP_NUM_THREADS=2`, `OPENBLAS_NUM_THREADS=2`, `MKL_NUM_THREADS=2`.
4. **Datasets are processed streaming / chunked.** Check file size with an HTTP `HEAD` before downloading. Never load more than ~500 MB into memory; use `pandas.read_csv(chunksize=...)` or `pyarrow`/`polars` lazy scanning. Raw datasets live in `ml-fl-service/data/raw/` (gitignored) and are never committed.
5. **No PyTorch/TensorFlow/transformers in the deployed engine.** Render free instances have 512 MB RAM. Allowed ML deps: numpy, scipy, scikit-learn, xgboost-cpu, rapidfuzz, pypdfium2, zxing-cpp, cryptography, pydantic, fastapi. Any new dependency must be justified in the agent's STATUS entry with its installed size.
6. **Docker Desktop resources**: the human sets Docker Desktop to at most ~60% of RAM and 4 CPUs. Agents never run `docker system prune -a` or delete volumes without the human's explicit approval.
7. **Timeouts**: every command that could hang gets a timeout; every HTTP call in code gets a timeout (engine 30 s, LLM 45 s, Neo4j 10 s).

## 6. Git workflow (everyone pushes to `main`)

1. Before starting a task: `git pull --rebase origin main`.
2. Commit small and often; **only files you own** (`git add <your paths>` — never `git add .`, never `git add -A`).
3. Commit message format: `<type>(<scope>): <summary>` where scope ∈ `engine|api|ai|web|infra|docs` and type ∈ `feat|fix|refactor|test|chore|perf|docs`. Body explains *why*. Example: `feat(engine): add conformal ambiguity sets for payment↔invoice links`.
4. Before push: run your owner test command (see your agent file). Push only if green. Then `git pull --rebase origin main && git push origin main`. If rebase conflicts appear in a file you do not own, **stop and report** in your handoff file — never resolve by editing another agent's file.
5. Never `git push --force`, never rewrite history, never delete branches/tags, never commit secrets, `.env` files, datasets, model binaries > 5 MB, or `node_modules`.
6. A rollback tag exists: `v0.9-pitch-baseline` (deployed hackathon prototype). Milestone tags are created by the human only.
7. **Deployment caution:** Render (`autoDeploy: true` on `main`) and Vercel deploy on every push to `main`. Until the team says otherwise, new features must be **additive and behind feature flags** (`FEATURE_V2_*` env vars default off in production) so a half-finished feature never breaks the live demo. Agent B introduces the flag helpers; Agent D reads flags from `NEXT_PUBLIC_FEATURE_*`.

## 7. Working method for each agent (definition of done per task)

For every task in your agent file:
1. Read the task, its contract references in 02, and the relevant domain section in 01.
2. Inspect only the existing files you need (use search; do not open the whole repo).
3. Write/adjust tests first where the task lists acceptance criteria.
4. Implement. Keep functions small; follow existing conventions in your directory.
5. Run your owner test command; fix until green.
6. Commit (§6), append to `STATUS.md`.
7. If you are blocked by another agent's missing endpoint, **build against the contract with a local mock/fixture** and continue; do not wait idle. Record the dependency in that agent's handoff file.

## 8. Context-window discipline (250k tokens)

- Your own agent file + 00 + 02 + the referenced sections of 01 ≈ 90–120k tokens. Do not load 03–06 of other agents unless you need a specific section (use search for the heading).
- Never paste large generated data, lockfiles or datasets into context. Summarise.
- When your context gets long, write a short progress note to `STATUS.md` so a fresh session can resume from it.

## 9. Phases at a glance (details in 07)

| Phase | Goal | Exit criterion |
|---|---|---|
| **P0 — Pitch safety (30 Oct)** | Nothing breaks the live demo during Shark Tank | Prod frozen or flagged; only additive changes; key pool + usage meter behind flag |
| **P1 — Foundations** | Contracts, data model v2, design system, key pool, HSN/tax master, dataset pipeline skeleton | All services expose v2 health + contract stubs; UI shell + tokens; tests green |
| **P2 — Core product flows** | PO/PI wizard + tax + PDF; document ingestion; reconciliation v2; graph v2; copilot v2 | End-to-end: create PO → upload invoice/GRN/payment → investigation with evidence → ask copilot |
| **P3 — Intelligence & compliance** | ML v2 (matching, conformal ambiguity, anomaly), GSTR-2B/IMS recon, MSME 45-day, Rule 37, intercompany | Evaluation report published on `/research`; compliance dashboard live |
| **P4 — Product polish & launch** | Onboarding, pricing, legal pages, accessibility, performance, e2e tests, deploy | Release checklist in 07 fully green |
