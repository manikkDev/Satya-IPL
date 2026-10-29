# Satya — Technical Framework (what we built / are building, explained)

> Companion to `SATYA_FRAMEWORK_BUSINESS.md`. Written so every team member can explain the technology to judges in plain words. The full agent-level spec is in `docs/plan/`. Status tags: **[Live]** = in the deployed prototype today; **[v2]** = being built per the implementation plan.

---

## 1. Architecture in one picture
```
Browser (Next.js app on Vercel)
   │  REST (login token)                 │  live chat stream
   ▼                                     ▼
API server (Node/Express, Render)  ◄──► AI gateway (Node, Render) ── Google Gemini (key pool)
   │            │                              │
   │            └──► Calculation engine (Python/FastAPI, Render): tax, reconciliation, ML, document checks
   ▼
MongoDB (all business records = source of truth)      Neo4j (relationship graph, rebuildable)
```
- **Frontend (client)** — what users see. [Live] basic workspace; [v2] new design system, PO wizard, inbox, graph, copilot.
- **API server** — logins, permissions, documents, approvals, numbering, orchestration, graph building. [Live] single-company roles; [v2] parent/child companies, 11 roles, maker-checker.
- **Calculation engine** — the only place money, tax and probabilities are computed (exact decimal math). [Live] reconciliation + XGBoost matcher; [v2] tax engine, event ledger, conformal ML, document verification.
- **AI gateway** — the only place that talks to an LLM. [Live] grounded copilot with fallback; [v2] key pool, usage meter, agentic GraphRAG, document extraction.
- **Databases** — MongoDB stores everything; Neo4j stores the "who-links-to-whom" graph for fast relationship queries and visuals.

Why this split? Each part has one job, can be tested alone, and four developers (or AI agents) can work in parallel without stepping on each other.

## 2. The reconciliation engine (the "brain") — deterministic first
Not machine learning — **rules and exact arithmetic**, because you never want a probability deciding how much money you owe.
1. **Time-aware**: every record has *document date* and *when we learned it*. You can replay "what did we know on 12 Oct?" without future data leaking in.
2. **Line ledger** [v2]: for each PO line it tracks ordered → received → accepted/rejected → invoiced → credited → paid → advance adjusted, in exact decimals.
3. **Linking order**: exact references first (proof) → human decisions → normalised references (e.g. "INV-041" = "INV 041") → ML suggestions with calibrated confidence → otherwise "missing information".
4. **Detectors**: ~45 issue types (duplicates, partial delivery, rejected-but-billed, price variance, unlinked payment, wrong GST type/rate, not in GSTR-2B, MSME 45-day, Rule 37, e-way bill, LUT, intercompany …). Each produces: amount at risk, confidence class, evidence, step-by-step calculation, recommended action, and "what document would settle this".
5. **Safety guarantees (tested automatically)**: money is never counted twice (cash conservation), quantities can't exceed what arrived (quantity conservation), same inputs always give the same result (reproducible snapshot ID), input order doesn't matter.
6. **Three money views**: *What your books show* (₹90,800 in the demo), *What you really owe* (₹20,000), *Amount under question* (₹70,800).

## 3. Machine learning — where it helps and how we keep it honest
| Task | Algorithm | Why this one |
|---|---|---|
| Find candidate matches fast ("blocking") | Multi-pass keys + character n-gram TF-IDF nearest neighbours | Avoid comparing every record with every record |
| Decide if two records match (invoice↔PO line, payment↔invoice, duplicate invoices, item names) | **Gradient-boosted trees (XGBoost)** with ~25 engineered features (fuzzy text similarity, spec conflicts like 1 kW vs 2 kW, HSN agreement, amount/date gaps, reference similarity) and **monotone constraints** (e.g., a bigger amount gap can never increase the match score) | Accurate on tabular data, fast on small servers, explainable |
| Explain each score | Built-in SHAP contributions (XGBoost `pred_contribs`) | "Matched because the reference and amount agree; the date is 2 days off" |
| Make scores mean real probabilities | **Isotonic calibration** | A "90%" should be right ~90% of the time; measured by ECE |
| Decide when it's *unclear* | **Split conformal prediction** — returns a set of plausible candidates with a guaranteed coverage (e.g., 95%) | If the set has 2+ items → "Unclear — needs your decision". This is our principled answer to "don't fabricate conclusions" |
| Pick one-to-one links globally | Hungarian algorithm with a "no match" option | Prevents two invoices claiming the same delivery |
| Split/combined payments | **Exact subset-sum (meet-in-the-middle)** in paise, TDS-aware | Finds every invoice combination that adds up; multiple solutions → unclear |
| Duplicate suppliers in master data | **Fellegi–Sunter probabilistic record linkage** with EM (same method used by census bureaus, Splink) | Works without labelled data; gives match weights per field |
| Unusual prices/invoices | Robust z-score (median/MAD) + **Isolation Forest**; Benford's-law check per supplier as a soft signal only | Flags for review, never auto-holds |
| Learning from humans | Reviewer decisions become labels → retrain → recalibrate | Gets better per customer over time |
Kept small on purpose: no PyTorch/large models on the server (free hosting has 512 MB RAM). [Live] today: one XGBoost matcher (PR-AUC ≈ 0.97 on constructed test pairs, auto-approval disabled). [v2]: per-task models + calibration + conformal sets + vendor dedupe + anomaly + evaluation report.

**Evaluation we will publish on `/research`** [v2]: precision/recall/PR-AUC per task, calibration error before/after, conformal coverage & average set size, abstention rate, ablation (rules only vs +ML vs +conformal), document-extraction field accuracy, latency — plus limitations.

## 4. Data — real first, synthetic last
| Data | Real? | Used for |
|---|---|---|
| **BPI Challenge 2019** (IEEE Task Force on Process Mining; 4TU) | Real event log of purchase-order handling at a multinational paints/coatings company, ~60 subsidiaries | Real timing patterns (order → goods receipt → invoice), partial deliveries, 3-way vs 2-way flows; a benchmark for our detectors |
| **GST HSN directory + CBIC rate schedules** | Real, official | Tax engine and item catalogue |
| **GeM public order listings** | Real Indian government procurement orders | Indian amount ranges, MSME share, supplier name variations |
| **DocILE** (ICDAR 2023) | Real annotated invoices/orders (research access) | Testing document extraction accuracy |
| **Satya calibrated generator** | Semi-synthetic, clearly labelled | Linked PO + delivery + QC + invoice + payment + GST bundles with known injected errors — needed because no public dataset links all of these with ground-truth labels |

## 5. Reading documents — better than old OCR
OCR (optical character recognition) just turns pixels into text and makes mistakes on tables and numbers. Our pipeline goes from most reliable to least:
1. **Verified e-invoice QR** [v2] — every GST e-invoice carries a QR code **digitally signed by the government's IRP**. We decode it and verify the signature with the IRP's published public keys. If valid, supplier GSTIN, invoice number, date, value, HSN and IRN are **cryptographically proven** — no AI needed.
2. **PDF text layer** — most PDFs already contain real text; we read it directly (no OCR errors) and let the AI structure it.
3. **AI vision (Gemini)** — only for scans/photos. Research shows modern vision-language models read invoices better than OCR-then-parse pipelines (Berghaus et al. 2025; LLM extractor 94% vs Docling 63% in another 2025 study).
4. **Validation** — GSTIN checksum, state codes, HSN exists, line maths, tax totals, QR vs printed values. Every field gets a confidence and the exact quote it came from; uncertain fields go to a human review screen.
Future private option: self-host a small open model (PaddleOCR-VL, 0.9B parameters) for customers who don't want cloud AI.

## 6. The chatbot ("Ask Satya") — evidence-first agentic GraphRAG
**RAG** = Retrieval-Augmented Generation: the AI first fetches relevant facts, then writes an answer from them. Standard RAG searches text chunks — not enough for finance. Ours:
1. **Understand** the question (intent + which PO/invoice/supplier) — small fast Gemini model with a strict JSON format; rule-based fallback.
2. **Resolve** the records ("GRN40" → GRN/40). If two records fit, it **asks you** instead of guessing.
3. **Retrieve with tools** (the "agentic" part): calls our own APIs — case summary, line lifecycle, findings, payments, deadlines, **graph paths in Neo4j** ("GraphRAG"), and hybrid search over document text (keyword BM25 + vector embeddings, fused with Reciprocal Rank Fusion) — always with the user's own permissions.
4. **Check sufficiency** (inspired by Corrective RAG): if facts are missing, it says what document is missing rather than inventing.
5. **Write** with **number placeholders**: the AI writes "You really owe {{F3}}" and our code fills in ₹20,000.00 from the calculation. A validator rejects any sentence with a number not from the records or a claim like "I paid it" → retry → if still bad, a deterministic template answer.
6. **Cite**: every answer has clickable citations to the exact document field.
Research basis: HybridRAG (ACM ICAIF 2024: vector + knowledge-graph retrieval beats either alone on financial documents), Microsoft GraphRAG, CRAG, RAGAS for evaluation. **Evaluation**: 120+ golden questions with expected facts; target 100% numeric accuracy on answered questions and correct clarifications on ambiguous ones.

### Gemini key pool & usage meter [v2]
- 68 free Gemini API keys are stored only in server environment variables (never in code). The gateway rotates keys automatically: a key that hits a per-minute limit "cools down", a key that hits its daily limit is parked until the daily reset (midnight US Pacific = 12:30 PM IST in US summer time / 1:30 PM IST in winter), invalid keys are quarantined, and it falls back to other models and finally to **evidence-only mode** — the app never crashes.
- A small **"AI capacity"** indicator under the chat box shows estimated requests left today and the reset time.
- Honest limits: Google counts limits **per Google Cloud project, not per key**, and its terms don't allow working around limits — so the pool is for reliability; real customer data will use a paid key (free-tier data may be used by Google to improve its products).

## 7. Neo4j graph & the money-trail visual
- Every document, supplier, company, item and finding is a **node**; links like *receives*, *bills*, *settles*, *duplicate of* are **relationships** with confidence and amount.
- Used for: fast "how is this payment connected to that PO?" queries (shortest path), supplier networks, copilot GraphRAG, and the visual.
- **Visual [v2]**: left-to-right lanes (Order → Dispatch → Receipt → Quality → Invoice → Payment → GST), line thickness = money, solid = confirmed, dashed = possible, purple "?" = unclear, red = suspected duplicate; click anything for a plain-language explanation; time slider replays the story; a list view for accessibility. If Neo4j is down, the same picture is drawn from the saved snapshot.

## 8. PO / PI generation [v2]
Step-by-step wizard (buyer → supplier → items with HSN → terms → tax preview → approvals → issue). GST computed by the engine (CGST+SGST vs IGST by place of supply, date-effective HSN rates, zero-rated exports only with a valid LUT, round-off, amount in words in lakh/crore). Numbering per company & FY (`VPPL/PO/26-27/000123`). PDF: letterhead, party blocks, item table with HSN, HSN-wise tax summary, terms, stamp & signature images, page numbers, and a **verification QR** (hash of the document) anyone can scan to confirm it's genuine. Amendments keep full history.

## 9. Security & privacy
Login tokens; 11 roles per company; **maker-checker** (the person who creates can't approve; bank-account changes need two people); strict company isolation (other companies' IDs return "not found"); bank numbers masked + hashed; uploads size/type-checked; **tamper-evident audit log** (each entry hashes the previous one, like a mini blockchain without the hype); prompt-injection defences (document text is treated as data, never as instructions); AI data policy; DPDP-aligned privacy policy, terms, DPA, AI transparency and grievance pages.

## 10. Deployment & reliability
Frontend on Vercel; API, AI gateway and engine on Render (free tier: 512 MB RAM, sleeps when idle → the app shows "waking up servers" and retries); MongoDB Atlas; Neo4j Aura. Every service has health checks; feature flags let us switch new features on safely; automated tests run on every push (engine, server, gateway, frontend, end-to-end).

## 11. Technical Q&A bank
- **Why not let the LLM do the reconciliation?** LLMs are great with language, bad with guaranteed arithmetic. We use deterministic rules for money and use AI for reading and explaining.
- **Why XGBoost and not deep learning?** Tabular features, small data, CPU-only free servers, need for explanations and monotone constraints — boosted trees are the state of practice here; deep matchers (e.g., Ditto, VLDB 2021) are a future option with more labelled data.
- **What is conformal prediction in one line?** It turns model scores into a set of answers that contains the right one with a chosen probability (e.g., 95%), so "more than one answer in the set" honestly means "unclear".
- **How do you prevent hallucinated numbers in chat?** Placeholders filled from tool results + validator + fallback templates; tested with adversarial cases.
- **How do you verify an e-invoice?** Decode the signed QR (a JWT), verify the RS256 signature with the IRP public key valid on that date, compare QR fields with the printed invoice.
- **What happens if Gemini is down or out of quota?** Key rotation → model fallback → evidence-only answers. Document reading falls back to text layer + manual review.
- **How do you handle multiple companies in a group?** Each entity has its own GSTIN, numbering and approvals; users get roles per entity; group admins see everything; intercompany checks compare both sides.
- **How big can it scale?** Stateless engine, background job queue, indexed MongoDB, graph rebuildable; paid tiers scale horizontally.
