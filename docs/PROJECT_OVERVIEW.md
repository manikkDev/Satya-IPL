> **Superseded (29 Oct 2026):** this describes the hackathon prototype. The current team guide is in [`docs/team/`](team/).

# Satya — Project Overview (Team & Presentation Guide)

> **One-liner:** Satya reconstructs what a company ordered, received, was billed for, and actually paid — then explains every discrepancy with proof, instead of guessing.

> **Tagline:** *"Know what you actually owe, and why."*

This document explains the whole project in plain words: the problem, the solution, the tech stack, the ML model, the chatbot, and the questions judges will probably ask. No jargon — every technical term is explained in the glossary at the end.

---

## 1. The Problem

Imagine a mid-sized Indian equipment distributor. Every purchase goes through a messy paper trail spread across different systems:

- The **purchase order (PO)** lives in the procurement system — "we ordered 100 pumps."
- The **goods receipt note (GRN)** lives in the warehouse system — "only 60 pumps actually arrived."
- The **supplier invoice** lives in the accounts-payable (AP) system — "the supplier billed us for 60 pumps, ₹70,800."
- The **bank transfer** lives in the bank — "we sent two payments of ₹30,000 and ₹20,800, plus a third transfer of ₹15,000 with no invoice reference."

Now the real-world mess:

1. **Duplicate billing** — the same invoice gets posted twice in the AP system (a clerk re-entered it, or it was exported twice). The books now say you owe ₹1,41,600 instead of ₹70,800.
2. **Partial deliveries** — only 60 of 100 pumps arrived. Is that a problem? Not necessarily — the supplier may still be delivering. But a spreadsheet can't tell "normal partial delivery" from "supplier failed to deliver."
3. **Unreferenced payments** — a ₹15,000 bank transfer has no invoice number on it. It could settle invoice A or invoice B. A careless system "matches" it to whichever invoice has the same amount and silently corrupts both balances.
4. **Description mismatches** — the PO says `Centrifugal pump CP-100 1kW`, the invoice says `CP100 pump, 1 kW`. Same product, different text. A dumb string-match says they're unrelated; a smarter-but-sloppy system links a 5 kW motor to a 7.5 kW motor because the descriptions "look similar."
5. **No proof trail** — when someone asks "why does the system say we owe ₹20,000?", existing tools just show a number. Nobody can click through to the exact receipt, invoice line, or bank transfer that produced it.

**The result:** companies either overpay (duplicate charges, paying for undelivered goods), waste analyst hours manually reconciling spreadsheets, or lose auditability — "the computer said so" is not an answer an auditor accepts.

## 2. Our Solution

Satya is an **evidence-led reconciliation workspace**. It ingests exports from all those systems, reconstructs the full order→delivery→billing→payment story, and presents every number with the evidence behind it.

The core philosophy, in three rules:

1. **Never guess a number.** Every balance is computed with exact decimal arithmetic from stored source records. If evidence is missing or contradictory, Satya says "unknown" or shows a range — it does not invent an answer.
2. **Never destroy ambiguity.** If a payment could settle two invoices, both possibilities stay visible until a human or new evidence resolves it. Nothing is silently merged or deducted twice.
3. **Every claim is clickable.** Every figure links back to the exact source record, field, and (where applicable) graph path that produced it.

### What Satya is NOT

- Not a fraud detector — it flags a *suspected duplicate*, a human decides.
- Not an ERP/accounting suite — it investigates, it doesn't post to ledgers or move money.
- Not a chatbot that invents financial answers — see section 6.
- Not a legal/GST-compliance engine — tax values are treated as source declarations.

## 3. The Flagship Demo (what judges will see)

**Case: PO-1001, fictional supplier "Meridian Pump Supply"**

| Fact | Value |
|---|---|
| Ordered | 100 pumps @ ₹1,000 + 18% tax = ₹1,18,000 |
| Received (2 GRNs) | 40 + 20 = **60 pumps** |
| Invoice INV-M-041 | 60 pumps, gross **₹70,800** |
| Second AP posting "INV M 041" | same invoice represented again — **suspected duplicate** |
| Bank T01 + T02 | ₹30,000 + ₹20,800 = **₹50,800 verified settled** |
| Bank T03 | ₹15,000, no reference — **unallocated** |
| Receipt-supported outstanding | **₹20,000** |
| Raw recorded AP (naive view) | **₹90,800** — inflated by the duplicate |

The wow moment: a spreadsheet says "₹90,800 open." Satya says "₹20,000 is what the evidence supports, ₹70,800 is a suspected duplicate awaiting confirmation, and ₹15,000 is parked because it could plausibly settle either of two invoices — here's the range of possible outcomes (₹5,000–₹20,000) and the one document (a remittance advice) that resolves it."

A reviewer (AP manager role) can then **confirm the duplicate**, **allocate T03** once remittance evidence arrives, or **preview a what-if** ("what if the remaining 40 pumps arrive?" → delivery completes, but no new invoice is invented).

Four other seeded cases show: a fully reconciled order, an inspection rejection (4-way matching), a currency conflict (PO in USD, invoice in EUR — no made-up conversion), and a warehouse coverage gap (missing evidence ≠ proof of non-delivery).

## 4. How It Works — Architecture

Four services plus two databases, all running in Docker Compose:

```
┌─────────────┐
│   client    │  Next.js frontend — dashboard, case workspace, inbox,
│  :3000      │  records, audit, evaluation page, chat UI
└──────┬──────┘
       │
┌──────▼──────┐        ┌──────────────┐
│   server    │───────▶│   MongoDB    │  Source of truth: records,
│  Express    │        │              │  cases, snapshots, jobs,
│  :5002      │        └──────────────┘  decisions, audit log,
└──────┬──────┘                           conversations
       │               ┌──────────────┐
       │──────────────▶│    Neo4j     │  Evidence graph (rebuildable
       │               │ :7474/:7687  │  projection of snapshots)
       │               └──────────────┘
       │               ┌──────────────┐
       └──────────────▶│ ml-fl-service│  FastAPI "reconciliation engine" —
                       │   Python     │  does ALL the math (Decimal),
                       │   :8000      │  findings, allocations, ML scoring
                       └──────────────┘
┌─────────────┐
│ chatbot-    │  Express gateway for the copilot — calls the server's
│ backend     │  authorized APIs with the user's own login token
│ :5001       │
└─────────────┘
```

**Who does what (important for technical questions):**

- **Python engine is the only place math happens.** Balances, allocations, findings — all computed there with `Decimal` (exact arithmetic, never floating point). The Node server never re-computes a slightly different balance; it stores and serves the engine's result.
- **MongoDB is the source of truth.** Every record, every reconciliation result ("snapshot"), every reviewer decision is persisted there.
- **Neo4j is a derived picture.** The graph — order → receipt → invoice → payment with edge types like `CONFIRMED_MATCH`, `CANDIDATE_SETTLEMENT`, `SUSPECTED_DUPLICATE_OF` — is rebuilt from committed snapshots. If Neo4j is down, the app still works and serves the graph stored in the snapshot.
- **Snapshots are immutable and reproducible.** Same input records + same rules/model version → same snapshot ID (a hash of the inputs). You can always show *why* a number was produced and replay "what did we know as of last Tuesday."

**Roles:** `ops_analyst` (imports, investigates), `ap_manager` (can approve/hold/escalate), `auditor` (read-only), `admin`. Everything is scoped to a company — one company's user can never see another's data.

## 5. The Reconciliation Engine (the actual "brains")

This is the part most people will misunderstand, so get it straight: **the reconciliation itself is not machine learning. It is deterministic accounting logic.** That's deliberate — you don't want a probabilistic model deciding how much money you owe.

What the engine does for each case:

1. **Filters records by "knowledge time"** — only evidence observed before the chosen cutoff counts, which powers the time-travel replay feature.
2. **Builds the quantity ledger** — ordered vs. received vs. accepted, handling unit conversions (box→each) only when an approved pack size exists; otherwise it flags "unknown conversion" instead of guessing.
3. **Detects suspected duplicates** — same supplier + same normalized invoice reference + same currency appearing twice = flagged for review, never auto-merged. (`INV-M-041` vs `INV M 041` normalizes to the same key.)
4. **Allocates payments conservatively** — a settled, non-reversed bank transfer only counts as cash against an invoice when there's a verified reference (or a reviewer's manual allocation). Anything left over stays **unapplied** with its candidate invoices listed. A matching amount alone is never treated as proof.
5. **Verifies invoice arithmetic** — does line totals + declared tax equal the header total? If not, that's a finding, not a silent fix.
6. **Computes three different balances** — and keeps them separate:
   - *Recorded AP*: what the raw postings say is open (₹90,800 — inflated by the duplicate).
   - *Supported outstanding*: what receipt/acceptance evidence actually supports (₹20,000).
   - *Canonical outstanding*: the reconstructed obligation — shown as **null/unknown** when a duplicate or currency conflict is unresolved. This is a key design point: Satya would rather show "we don't know yet" than a confident wrong number.
7. **Generates findings** — typed, evidence-linked issues like `SUSPECTED_DUPLICATE_CHARGE`, `EXPECTED_PARTIAL_FULFILLMENT`, `AMBIGUOUS_PAYMENT_ALLOCATION`, `BILLED_ABOVE_RECEIVED`, `CURRENCY_CONFLICT`, each with a recommended action.
8. **Emits the graph** — nodes and typed edges distinguishing *observed facts*, *candidate suggestions*, and *reviewer-confirmed* links.
9. **Produces scenario ranges** — for an ambiguous payment, the outstanding could be ₹5,000 or ₹20,000 depending on which invoice it settles. Both bounds are shown with the assumption named.

Then the server turns findings into **four possible actions** (manager role required): **Approve** (only when blocking findings are resolved), **Request Clarification**, **Escalate**, **Place on Hold** — all recorded as internal workflow decisions with a reason, actor, and a stale-version guard (you can't approve based on outdated evidence). No action ever moves real money.

## 6. The Machine Learning Model — Explained Simply

### What it's for

Exactly one job: **matching an invoice line to the purchase-order line it refers to**, when the text references don't match cleanly. The PO says `Centrifugal pump CP-100 1kW`; the invoice says `CP100 pump, 1 kW` — a human knows they're the same item; the model scores how likely that is.

Crucially: **a high score is a suggestion for a human, never an approval.** `automaticApproval: False` is baked into the model artifact itself.

### The algorithm: XGBoost (gradient-boosted decision trees)

- **What it is:** hundreds of small decision trees, each correcting the previous trees' mistakes. Think of it as a committee of simple yes/no checklists that vote together.
- **Why this and not a neural network:** our input is a small table of numeric features (see below), not images/text directly. On tabular data, gradient boosting typically beats deep learning, trains in seconds on CPU, needs no GPU, and is easy to explain — you can show exactly which features drove a score.
- **Baseline for honesty:** we also train plain **logistic regression** (the simplest possible classifier — basically a weighted sum) and report both, so we can prove XGBoost actually earns its complexity.

### The features the model sees

8 features per candidate pair (`business_matching.py`):

| Feature | Plain meaning |
|---|---|
| `description_similarity` | How similar the two text descriptions are (character-level, 0–1) |
| `token_overlap` | Fraction of shared words (Jaccard similarity) |
| `sku_agreement` | Do the product codes match after normalization? |
| `reference_agreement` / `reference_conflict` | Does the invoice cite the same PO number? Does it cite a *different* one? |
| `specification_agreement` | Do the numbers in the description (kW, voltage, size) agree? A 1 kW and a 5 kW pump get penalized. |
| `price_similarity` / `quantity_similarity` | How close are unit price and quantity ratios? |

Key detail: `specification_agreement` exists specifically so "pump 1 kW" and "pump 5 kW" don't get matched just because they sound alike — a real risk with generic text-similarity models.

### Training data — the honest part

We could not find a public dataset containing the full PO→GRN→invoice→bank-transfer bundle for one company. So we **generate realistic synthetic episodes**: 1,600 purchase episodes → 9,600 candidate pairs, including deliberately tricky *hard negatives* (same supplier and amount but different order; similar descriptions with different specs; missing references).

The splits are **episode-disjoint** — every variant of one purchase episode lands in the same split, so the model can't "memorize" an episode seen in training:

| Split | Share | Purpose |
|---|---|---|
| Train | 60% | Fit the trees |
| Validation | 15% | Pick the best hyperparameters (tree depth 3 vs 5) |
| Calibration | 10% | Fit the probability calibration (below) |
| Test | 15% | Final honest score, never touched during tuning |

### Calibration — making "90%" actually mean 90%

A raw XGBoost score is not a trustworthy probability. We apply **sigmoid (Platt) calibration**: fit a small logistic regression on the model's raw output using the held-out calibration split, turning the score into a probability that's checked against reality. The evaluation report includes a reliability table (10 bins: predicted vs. observed rate) plus **Brier score**, **PR-AUC**, **ROC-AUC**, precision/recall, and a "high-confidence" section (precision and coverage at p ≥ 0.98).

### Fallbacks — the demo never depends on the model

If no trained artifact exists (e.g., fresh clone where `make train` hasn't run), the engine falls back to a **transparent weighted heuristic** (0.4×description + 0.25×overlap + 0.2×SKU + 0.15×specs) and honestly labels scores as `heuristic` rather than a probability. The artifact also carries a SHA-256 checksum — a corrupted or mismatched model file can't silently produce garbage.

**Metrics are reported with honest labels:** "calibrated on constructed pairs, episode-disjoint holdout — not real-world validation." We never claim production accuracy.

## 7. The Chatbot / Copilot — Explained Simply

### What it actually is (and isn't)

The Satya copilot is a **deterministic evidence assistant**, not a free-chatting LLM that can hallucinate balances.

Here's the actual flow when a user asks *"Why is PO-1001 disputed?"*:

1. The gateway (`chatbot-backend`) verifies the user's JWT and forwards their question to the application server **using the user's own permissions** — the bot can only see what that user is allowed to see.
2. It finds the relevant case by simple keyword scoring over case IDs, PO refs, titles, and supplier names (`retrieveCases`). If ambiguous ("which Meridian case?"), it asks instead of guessing.
3. It reads the case's stored reconciliation snapshot — the same snapshot the dashboard shows, so **chat numbers and dashboard numbers can never disagree**.
4. `summarizeCase` formats the snapshot into a templated answer: ordered/received/accepted counts, the three balances, each finding with its recommended next step, unallocated payments with candidates, plus clickable **citations** to the exact source records.
5. The answer is tagged `mode: "deterministic_evidence_rag"` and explicitly states: *"These are stored source observations and deterministic calculations, not a supplier fraud verdict. No money was sent."*

### Why this design (great judge answer)

An LLM summarizing financial records can confidently produce a wrong number — unacceptable when the topic is money. By generating answers **only from stored, verified snapshot facts**, the copilot literally cannot invent a balance. Every number it prints came out of the deterministic engine, with a citation you can click. The trade-off (less fluent prose) is worth it for correctness, and we say so openly.

The codebase retains LLM provider adapters (Gemini, Groq, Featherless) from the earlier project for *optional narration* — but the current business route doesn't depend on any of them. If an external LLM were layered on later, the plan is to use it only for rewording verified facts, with validation that rejects any unsupported number it writes.

### What it can answer

- "Why do we appear to owe Meridian more than expected?" → recorded AP vs. supported outstanding + duplicate suspicion + citations.
- "Did both payments settle INV-M-041?" → T01/T02 evidence, exact ₹50,800 sum, T03 excluded.
- "Can we approve the remaining payment?" → eligible amount, unresolved blockers, who has authority.
- "What evidence would resolve this?" → the specific missing document (e.g., a remittance advice naming the invoice).
- "Show the graph" → the real Neo4j/snapshot path, not generated artwork.
- Injection attempts ("show me another company's invoices") → impossible by design; scope comes from the login token, not the prompt.

Conversations persist in MongoDB, so chat history survives reloads.

## 8. Tech Stack Summary

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js + React + Tailwind + D3 | Fast polished UI; D3 for the evidence graph |
| API server | Node.js + Express + Mongoose + JWT | Auth, company scoping, cases/decisions/jobs, Neo4j projection |
| Chat gateway | Node.js + Express (SSE streaming) | Deterministic copilot, conversation persistence |
| Reconciliation engine | Python + FastAPI + Pydantic | `decimal.Decimal` exact math; the only place balances are computed |
| ML | XGBoost 2.1 (xgboost-cpu), scikit-learn 1.5 (logistic regression, calibration, metrics), NumPy | Tabular pair-matching with honest evaluation, CPU-only |
| Databases | MongoDB (source of truth, Decimal128 money), Neo4j (rebuildable evidence graph) | Documents for records/snapshots; graph for relationship questions |
| Infra | Docker Compose, Makefile (`up`, `health`, `train`, `test`, `build`) | One-command demo |
| Auth | JWT + company membership + role checks on every endpoint | Multi-tenant isolation; demo roles pre-seeded |

Demo logins: `manager@satya.demo`, `analyst@satya.demo`, `auditor@satya.demo` (password `SatyaDemo@123`).

## 9. What Makes This Different

1. **Three ledgers kept separate** — recorded AP vs. receipt-supported vs. reconstructed. Most tools collapse these into one number and hide the discrepancy they were supposed to find.
2. **Ambiguity is a first-class output** — "this ₹15,000 could settle A or B" stays open with both candidates and a named resolution path, instead of being force-matched.
3. **Conservation guarantees** — one receipt unit and one rupee of settled cash can never be counted twice; tested by property tests (re-import same file → same totals; split a payment into two → same outstanding).
4. **Evidence clock / replay** — "what did we know on Oct 6th, before that late GRN arrived?" — the basis for auditing past decisions.
5. **What-if preview** — simulate a new receipt or remittance and see before/after balances *without* mutating real state.
6. **Honest ML** — a genuinely trained and calibrated model, but scoped to suggestions, with measured (not claimed) results on labeled synthetic data and a working fallback.
7. **Graph that's real** — edges distinguish observed facts, candidate suggestions, and reviewer-confirmed links; the copilot references actual graph paths.

## 10. Honest Limitations (say these before the judges do)

- Training/eval data is **constructed (synthetic)**, not real company records — model metrics measure synthetic-data performance only.
- No real ERP/bank/email integrations — imports are structured JSON bundles; no live payments are made or implied.
- Invoice numbers/references are matched on normalized text rules; we don't yet do OCR of scanned PDFs (Docling integration is a roadmap item).
- Semantic embeddings (MiniLM) and global many-to-many optimization solvers (OR-Tools) are designed but not required for the current build — lexical + learned features cover the demo.
- Public datasets (BPI Challenge 2019 for real procurement process traces, FATURA for invoice-document extraction) are the roadmap for grounding the simulator in real distributions.
- This is a hackathon prototype — not a legally validated accounting system; GST values are treated as declared source data.

## 11. Glossary — Every Technical Term in Plain English

| Term | Plain meaning |
|---|---|
| **PO (Purchase Order)** | The buyer's official "we agree to buy X" document. |
| **GRN (Goods Receipt Note)** | The warehouse's record of what physically arrived. |
| **AP (Accounts Payable)** | The money a company owes its suppliers. |
| **Invoice** | The supplier's bill — "pay us ₹70,800." |
| **Reconciliation** | Checking that orders, receipts, invoices and payments all tell the same story. |
| **Three-way match** | Compare PO + receipt + invoice before paying. **Four-way** adds inspection acceptance. |
| **Decimal arithmetic** | Exact math on money (₹70,800.00 stays exactly that). Normal computer floats produce tiny errors like 0.1+0.2=0.30000000000000004 — unacceptable in accounting. |
| **Snapshot** | A frozen, reproducible reconciliation result — same inputs always produce the same snapshot. |
| **Ledger** | The running account of what's owed/settled. Satya keeps three views of it separate. |
| **Duplicate posting** | The same invoice entered twice — inflates what you "owe" without being a second real bill. |
| **Remittance advice** | The note that says which invoice a bank transfer was meant to pay. Without it, a payment's purpose is ambiguous. |
| **UTR** | Unique Transaction Reference — the bank's tracking ID for a transfer (like a UPI ref number). |
| **XGBoost** | A machine-learning algorithm made of many small decision trees that vote together. Great at tabular yes/no questions like "are these two lines the same item?" |
| **Logistic regression** | The simplest ML classifier — a weighted sum of features squashed into a 0–1 score. Our honesty baseline. |
| **Calibration** | Adjusting a model's output so "90% confident" is actually right ~90% of the time. We use sigmoid (Platt) calibration on a held-out split. |
| **Episode-disjoint split** | Keeping all variants of one purchase story in the same train/test bucket, so the model can't cheat by memorizing. |
| **Hard negatives** | Training examples that *look* like matches but aren't (same amount, different order) — they teach the model not to be fooled. |
| **PR-AUC / ROC-AUC** | Standard scores for "how good is the classifier at ranking true matches above false ones" (1.0 = perfect). |
| **Brier score** | Measures how accurate predicted probabilities are (lower = better). |
| **Heuristic** | A hand-written scoring rule ("0.4×similarity + …") used as a fallback when the trained model file isn't available. |
| **Provenance** | Where a piece of data came from — which file, which field, when it was imported. |
| **MongoDB** | Document database — our permanent store for records, results, decisions. |
| **Neo4j** | Graph database — stores relationships (order→receipt→invoice→payment) so you can ask "what's connected to what." |
| **JWT** | Login token — proves who you are to every API call. |
| **Company scoping / multi-tenancy** | Every query is filtered to the logged-in company; users can never see another company's data. |
| **RAG** | "Retrieval-augmented generation" — answering from retrieved facts instead of the model's memory. Ours is *deterministic* RAG: the answer is assembled from stored facts by code, not generated by an AI. |
| **SSE** | Server-sent events — how the chat answer streams to the browser. |
| **Idempotent** | Doing the same thing twice gives the same result — re-importing the same file can't create a second liability. |
| **What-if / scenario preview** | A simulation on top of real data that never changes the real data. |
| **Audit log** | Append-only history of who did what and why. |

## 12. Questions Judges Will Probably Ask — and Short Answers

**"Is the chatbot an LLM? Can it hallucinate numbers?"**
No — the copilot assembles answers from stored snapshot facts using deterministic templates. Every rupee figure comes from the reconciliation engine's output, with citations. There is no LLM in the answer path for business data, by design.

**"So where's the AI/ML?"**
Two places: (1) an XGBoost classifier suggests which invoice line matches which PO line when references are messy — trained on 9,600 pairs from 1,600 generated episodes, calibrated, and honestly evaluated; (2) the deterministic engine plus graph does the reasoning no model should do — exact arithmetic, conservation, ambiguity preservation. We deliberately kept ML out of the money math.

**"Why XGBoost and not a transformer/deep learning?"**
Our input is a small feature table, not raw documents. On tabular classification, gradient boosting matches or beats deep nets, trains on CPU in seconds, and is interpretable — we can show the exact features behind every score. We benchmarked against logistic regression to prove it earns its keep.

**"How do you know your model works if the data is synthetic?"**
Honestly — we don't claim real-world accuracy. The evaluation is labeled "constructed, episode-disjoint holdout." Real procurement process data (BPI Challenge 2019) and invoice extraction benchmarks (FATURA) are the roadmap for grounding. The fallback heuristic keeps the product fully functional without any model.

**"A payment matches two invoices by amount — what do you do?"**
Nothing automatic. It stays unallocated, both candidates are shown, possible balance range (₹5,000–₹20,000) is displayed, and the system names the evidence needed (a remittance advice). Amount coincidence is never proof.

**"Can it detect fraud?"**
It flags *suspected duplicate charges* and *unsupported billing* with evidence — intent is a human judgment. Saying "suspected duplicate" instead of "fraud" is deliberate and correct.

**"How is this different from SAP/Oracle three-way matching?"**
Those systems match — we show *why*. Our differentiators: three separate ledger views, preserved ambiguity with scenario ranges, a clickable evidence graph distinguishing observed/candidate/confirmed edges, knowledge-time replay, and a grounded copilot. Also, we're honest that established vendors do matching — our UX around uncertainty is the novel part.

**"What stops one company seeing another's data?"**
Every API query is filtered by the company from the verified JWT — the chatbot forwards the user's own token, so the bot literally cannot access what the user can't. Tested with a second isolated company.

**"What about security/injection — can a malicious invoice note trick the bot?"**
No prompt can trigger a mutation — actions go through role-checked REST endpoints with a reason and a stale-version check. The copilot has no database access at all; it only calls the same authorized APIs the UI uses.

**"Why MongoDB *and* Neo4j? Isn't one enough?"**
MongoDB holds the truth (records, snapshots, decisions). Neo4j answers relationship questions that are painful in documents — "show me everything connected to this payment." The graph is a rebuildable projection; if it dies, the app still works from Mongo.

**"What happens if the model file is missing or corrupt?"**
Artifact checksum validation fails, the engine falls back to the transparent heuristic, marks confidence as `heuristic` not probability, and reconciliation is unaffected.

**"Can it actually approve a payment / send money?"**
No — "Approve" is an internal workflow record for eligible amounts. There are deliberately no bank, email, or ERP side effects.

**"Does it handle real-world mess — currency mismatches, missing docs, late arrivals?"**
Yes: currency conflict → flag, no invented FX rate. Missing receipt with stale warehouse export → "coverage gap," not "supplier didn't deliver." A GRN uploaded late → appears in new snapshots but doesn't rewrite history — replay shows what was known when.

**"How does the numbers math stay exact?"**
Python `Decimal` everywhere (Mongo stores Decimal128, APIs carry strings). No float ever touches a balance — verified by property tests like "split a payment in two, outstanding must not change."

**"What would you build next?"**
Public dataset grounding (BPI 2019), PDF/OCR ingestion (Docling), semantic item embeddings (MiniLM) as an additional retrieval feature, OR-Tools global allocation for bigger many-to-many cases, and optional LLM narration with strict fact validation.

## 13. Suggested Presentation Flow (~7 min)

1. **Hook (30s):** "Your books say you owe ₹90,800. The truth is ₹20,000 — and a duplicate entry, an unallocated payment, and a partial delivery explain the gap. Satya proves it."
2. **Problem (60s):** fragmented systems, duplicate postings, unreferenced payments, unverifiable totals.
3. **Live demo (3 min):** open PO-1001 → 100 ordered / 60 received → ₹70,800 invoice → duplicate AP posting → ₹50,800 settled → T03 ambiguity → reviewer confirms duplicate → snapshot updates → copilot answer with citations → evidence graph.
4. **How it works (90s):** architecture diagram; "Python does all math; MongoDB is truth; Neo4j draws the picture; the bot only reads verified facts."
5. **The ML (60s):** one slide — XGBoost, 8 features, honest synthetic evaluation, suggestion-only, heuristic fallback.
6. **Close (30s):** limitations in one breath, then the vision: "ERP tools match documents. Satya shows you the evidence — and tells you what it doesn't know."
