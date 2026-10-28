# SATYA AI — Technical Glossary, Design Rationale & Research Defense
**The Comprehensive Architectural Justification, Formal Terminology, and Academic Defense Guide**

> **Project Tagline:** *Know what you actually owe, and why.*  
> **Repository:** `https://github.com/manikkDev/Satya-IPL`  
> **Purpose:** Academic review preparation, technical thesis defense, competition judging presentations, and onboarding knowledge base  
> **Author:** Satya AI Engineering & Research Group  

---

## CHAPTER 1: Why We Chose This Project

### 1.1 The Multi-Perspective Project Justification

#### The 30-Second Elevator Pitch
> Accounts payable departments lose billions annually to duplicate billings, unverified price escalations, and unallocated payments because modern ERPs treat financial records as isolated database rows rather than linked chains of physical evidence. We built Satya AI to bridge the gap between physical supply chain operations and commercial liabilities. It calculates exactly what a business owes using sixty-decimal-precision deterministic arithmetic, uses machine learning for record linkage, and guarantees that no invoice is approved without verified warehouse delivery backing.

#### The Two-Minute Academic Rationale
> In enterprise data engineering, financial reconciliation represents a uniquely demanding challenge: it requires reconciling heterogeneous, unstructured, and multi-tenant external records while strictly preserving mathematical invariants and legal auditability. 
> 
> A common failure in contemporary software engineering is applying probabilistic generative AI to problems that require formal correctness. LLMs hallucinate numbers, fail at basic accounting arithmetic, and lack deterministic auditability. Conversely, traditional rule-based enterprise software is brittle—incapable of resolving ambiguous vendor descriptions or linking disconnected advance bank transfers.
> 
> Satya AI was selected as our research and engineering project to demonstrate how a **principled hybrid architecture** should be designed. We isolate probabilistic machine learning strictly to candidate recommendation and textual explanation, while anchoring all financial obligations, ledger states, and approval workflows in deterministic, sixty-decimal fixed-point logic and formal finite-state machines.

#### Detailed Technical & Mathematical Justification
From a computer science perspective, the enterprise procurement and reconciliation domain encompasses five classic, hard problems:
1. **The Record Linkage Problem:** Matching line items across sovereign organizations without shared foreign keys (NP-hard in the general bipartite matching formulation).
2. **The Numerical Stability Problem:** Avoiding accumulated floating-point rounding errors across multi-tier tax and percentage deductions.
3. **The Multi-Hop Provenance Problem:** Tracing a financial balance through directed acyclic graph traversals (`PO -> GRN -> Invoice -> Payment -> Audit Log`).
4. **The Distributed State Machine & Concurrency Problem:** Ensuring that simultaneous management decisions operating on stale revisions cannot cause double-settlement.
5. **The Grounded Natural Language Problem:** Allowing non-technical human operators to interrogate complex relational state without exposing the system to arithmetic hallucination or prompt injection.

#### Why Not Just Use Microsoft Excel or a Conventional Accounting System?
A frequent question from critics and judges is: *"Why can't finance teams simply use Excel spreadsheets or existing ERPs like SAP or QuickBooks?"*
- **The Excel Fallacy:** Spreadsheets lack role-based access control, enforce no formal segregation of duties, allow silent formula corruption, possess no immutable audit trail, cannot natively project graph topologies, and crash when processing hundreds of thousands of supply chain records.
- **The Traditional ERP Fallacy:** Legacy ERPs execute rigid database joins. If an invoice line item description differs by three characters from a purchase order, standard three-way matching fails, forcing finance staff to export data into spreadsheets—re-introducing human error and operational paralysis. Satya AI provides the flexibility of fuzzy matching alongside the immutability of an audited state machine.

---

## CHAPTER 2: Problem Statement, Scope & Research Contribution

### 2.1 Formal Problem Statement
Let $\mathcal{P}$ denote a purchase order specifying ordered items with quantities $Q_p$ and unit prices $U_p$. Let $\mathcal{G}$ denote a set of receiving bay goods receipts specifying accepted quantities $Q_g$. Let $\mathcal{I}$ denote commercial invoices demanding payment for quantities $Q_i$ at unit prices $U_i$. Let $\mathcal{T}$ denote settled banking remittance transfers of amounts $A_t$.

The core problem of financial obligation intelligence is to compute a deterministic financial mapping:
$$\mathcal{F}(\mathcal{P}, \mathcal{G}, \mathcal{I}, \mathcal{T}) \to \langle \mathcal{L}, \mathcal{D}, \mathcal{A}, \mathcal{G}_{\text{graph}} \rangle$$
where:
- $\mathcal{L}$ is an authoritative 4-state financial ledger:
  $$\mathcal{L} = \{ \text{ordered}, \text{accepted}, \text{supportedOutstanding}, \text{disputedExposure}, \text{canonicalOutstanding} \}$$
- $\mathcal{D}$ is an evidence-linked set of discrepancy findings where each finding $d \in \mathcal{D}$ references explicit, immutable field locators in source records.
- $\mathcal{A}$ is a multi-signal anomaly set identifying duplicate references, over-billings, and incomplete transaction chains.
- $\mathcal{G}_{\text{graph}}$ is a directed transaction property graph representing multi-hop supply chain causality.

### 2.2 Project Scope & Boundaries
- **In-Scope:**
  - Deterministic Decimal reconciliation and balance calculation across PO, GRN, Invoice, and Payment records.
  - Multi-tenant data segregation with company-scoped authentication and authorization.
  - Machine-learning-assisted line-item matching via an 8-dimensional feature space.
  - Centralized Finite State Machine enforcing Segregation of Duties.
  - Document verification state tracking, file hashing, and evidence completeness checklist scoring.
  - Persistent, idempotent alerting and reminder management.
  - Audit report exports in structured JSON and injection-safe RFC-4180 CSV.
  - Token-grounded retrieval-augmented generation conversational interface.
- **Explicitly Out-of-Scope (To prevent overclaiming):**
  - Direct integration with core banking clearinghouses (e.g., SWIFT, Fedwire, NACHA, NEFT) for live funds disbursement.
  - Automated legal fraud adjudication (the system detects *anomalies*, not legal intent).
  - Native physical optical character recognition (OCR) of raw PDF pixels (the system ingests structured records and document content streams).

---

## CHAPTER 3: Complete Technical Glossary

### 3.1 Financial & Commercial Procurement Terminology

#### Accounts Payable (AP)
- **Simple Meaning:** The department or ledger balance representing money a business owes to its suppliers for goods or services purchased on credit.
- **Technical Definition:** A short-term liability account on a company's balance sheet reflecting commitments to settle commercial debts arising from procurement contracts.
- **Example in Satya AI:** The total outstanding liability calculated across active vendor cases.
- **Where It Appears:** `server/src/routes/businessRoutes.js` (`/dashboard/summary`), `client/src/app/dashboard/page.tsx`.
- **Common Misconception:** AP is not simply the sum of all invoices received; it is the sum of invoices validated as legally payable.

#### Purchase Order (PO)
- **Simple Meaning:** The official order document a buyer sends to a seller stating what they want to buy, the agreed price, and delivery date.
- **Technical Definition:** A legally binding commercial commitment issued by a procurement department authorizing a vendor to supply specified SKUs under defined terms.
- **Example in Satya AI:** Record `PO-1001` ordering 5 units of industrial pumps at ₹1,000/unit.
- **Where It Appears:** `ml-fl-service/business_reconcile.py`, `server/src/models/Business.js` (`BusinessCase.poId`).
- **Common Misconception:** A purchase order does not prove that goods were delivered or that money is currently owed.

#### Goods Receipt / Goods Receipt Note (GRN)
- **Simple Meaning:** A document signed by the warehouse team confirming what physical items actually arrived at the loading dock.
- **Technical Definition:** An operational receiving record documenting physical count, inspection results, and accepted versus damaged quantities of delivered freight.
- **Example in Satya AI:** Record `GRN-01` verifying that while 60 pumps arrived, only 50 were accepted due to 10 damaged units.
- **Where It Appears:** `ml-fl-service/business_reconcile.py` (line-level `acceptedQuantity` checks).
- **Common Misconception:** A shipping label or delivery receipt signed by the truck driver does not confirm that the items passed internal quality inspection.

#### Three-Way Matching
- **Simple Meaning:** A verification process where an accounting team compares the purchase order, warehouse receipt, and vendor invoice before paying.
- **Technical Definition:** An internal control procedure verifying predicate congruency: $\text{Quantity}(\text{PO}) = \text{Quantity}(\text{GRN}) = \text{Quantity}(\text{Invoice})$ and $\text{UnitPrice}(\text{PO}) = \text{UnitPrice}(\text{Invoice})$.
- **Example in Satya AI:** The engine verifies that Invoice #901 charges ₹1,000/unit for exactly the 50 units confirmed on GRN #501 under PO #101.
- **Where It Appears:** `ml-fl-service/business_reconcile.py`.

#### Canonical Outstanding Liability
- **Simple Meaning:** The single, mathematically proven amount that a company actually owes right now based on confirmed evidence.
- **Technical Definition:** The legally enforceable commercial liability derived from delivery fulfillment minus settled payments, conditionally returned as `null` ("Needs Evidence") if blocking discrepancies exist.
- **Example in Satya AI:** `ledger.canonicalOutstanding = "30000.00"`.
- **Where It Appears:** `client/src/lib/business-api.ts` (`Ledger.canonicalOutstanding`).
- **Common Misconception:** It is not the total of all invoice balances. If an invoice is disputed, `canonicalOutstanding` drops to "Needs Evidence" to prevent accidental payout.

#### Segregation of Duties (SoD)
- **Simple Meaning:** A rule preventing one person from having total control over a financial transaction from start to finish.
- **Technical Definition:** An internal control policy enforcing disjoint authorization sets such that no individual possessing data entry/import authority can execute final settlement authorization.
- **Example in Satya AI:** The system blocks user `tester@satya.demo` from approving a case that they uploaded or initiated.
- **Where It Appears:** `server/src/utils/lifecycleAndAnomalyService.js` (`checkSegregationOfDuties`).

---

### 3.2 Systems Architecture & Engineering Terminology

#### Arbitrary-Precision Decimal Arithmetic
- **Simple Meaning:** Doing math on computers in exact decimals (like humans do on paper) instead of computer binary fractions that round incorrectly.
- **Technical Definition:** A software-emulated numerical representation storing numbers as sign, integer coefficient, and exponent, bypassing IEEE-754 binary floating-point limitations.
- **Example in Satya AI:** Python's `decimal.Decimal` configured with `getcontext().prec = 60`.
- **Where It Appears:** `ml-fl-service/business_reconcile.py`.
- **Common Misconception:** Using standard `float` or JavaScript `Number` is never acceptable in financial accounting software.

#### Finite State Machine (FSM)
- **Simple Meaning:** A system with a fixed set of states that can only move between them through approved, predefined paths.
- **Technical Definition:** A mathematical model of computation consisting of a finite set of states $S$, an initial state $s_0$, an input alphabet of actions $\Sigma$, and a deterministic transition function $\delta: S \times \Sigma \to S$.
- **Example in Satya AI:** A case cannot move from `importing` directly to `reconciled` without passing through reconciliation.
- **Where It Appears:** `server/src/utils/lifecycleAndAnomalyService.js` (`TRANSITIONS`).

#### Optimistic Concurrency Control
- **Simple Meaning:** Allowing multiple people to read records, but checking that nobody changed the record in the background before saving a decision.
- **Technical Definition:** A database concurrency mechanism where records maintain a monotonically increasing revision counter; updates specify `WHERE revision = expectedRevision` to detect write-write conflicts without table locking.
- **Example in Satya AI:** `BusinessCase.findOneAndUpdate({ id, revision: expectedRevision }, { $inc: { revision: 1 } })`.
- **Where It Appears:** `server/src/routes/businessRoutes.js`.

---

### 3.3 Artificial Intelligence & Data Science Terminology

#### Record Linkage / Entity Resolution
- **Simple Meaning:** Determining whether two records written in slightly different ways are referring to the same real-world item.
- **Technical Definition:** The algorithmic identification of records in different data stores that represent the same physical commercial entity despite schema and textual variation.
- **Example in Satya AI:** Determining that invoice line `"1 kW Submersible Pump"` matches PO line `"Pump 1000W Model S"`.
- **Where It Appears:** `ml-fl-service/business_matching.py`.

#### Extreme Gradient Boosting (XGBoost)
- **Simple Meaning:** A powerful machine learning technique that combines many simple decision trees to make accurate predictions.
- **Technical Definition:** A scalable distributed gradient boosting framework optimizing a regularized objective function combining convex loss and tree-complexity penalties.
- **Example in Satya AI:** An `XGBClassifier` evaluating an 8-dimensional feature vector to output a matching probability between invoice and PO lines.
- **Where It Appears:** `ml-fl-service/business_matching.py`.

#### Retrieval-Augmented Generation (RAG)
- **Simple Meaning:** Giving an AI assistant a specific packet of real facts to look at before it writes an answer, preventing it from making things up.
- **Technical Definition:** An architecture that augments language model prompts with context retrieved from an authoritative document store prior to sequence generation.
- **Example in Satya AI:** The chat backend extracts facts into JSON and injects them into the system prompt.
- **Where It Appears:** `chatbot-backend/src/helpers/businessNarrator.js`.

#### Token-Grounding Placeholder Substitution
- **Simple Meaning:** Forcing the AI to write placeholder codes instead of numbers, and having the computer insert the real numbers afterward.
- **Technical Definition:** A determinism preservation pattern where LLM outputs are constrained to abstract semantic keys (e.g., `[[fact:KEY]]`), with lexical substitution executed server-side from an authoritative fact table.
- **Where It Appears:** `chatbot-backend/src/helpers/businessQuestions.js` (`renderGroundedNarration`).

---

## CHAPTER 4: Technology Stack Decision Matrix

| Technology | Role in Satya AI | Why Selected Over Alternatives | Primary Trade-Offs & Disadvantages | When To Reconsider |
| :--- | :--- | :--- | :--- | :--- |
| **Python 3.11 & FastAPI** | Core Financial Reconciliation Engine | Native `decimal.Decimal` arbitrary-precision module; mature data science ecosystem (NumPy, XGBoost). High-throughput async ASGI framework. | Separate runtime from Node.js backend; requires inter-process HTTP boundary. | If performance demands native C++/Rust engine compiled as a Node native addon. |
| **Node.js 20 & Express** | Gateway, Authentication & State Engine | Excellent non-blocking I/O for API routing; unified JavaScript ecosystem with Next.js frontend; mature Mongoose ODM. | Single-threaded event loop requires offloading CPU-bound tasks (math/ML) to Python. | If the entire backend is rewritten in Go or Rust for microservice consolidation. |
| **MongoDB 7.0** | Primary Document & State Store | Dynamic JSON document schema accommodates heterogeneous procurement records; native `Decimal128` support; strong optimistic concurrency. | Relational integrity and multi-document ACID transactions require careful application-level coordination compared to PostgreSQL. | If enterprise clients mandate strict SQL / ANSI-compliant relational databases. |
| **Neo4j 5.26** | Transaction Knowledge Graph | Native property graph model allows index-free adjacency traversal across multi-hop commercial chains (`PO -> GRN -> INV -> PAY`). | Operational overhead of maintaining a secondary database cluster; potential memory intensity on large graphs. | If relationship depth rarely exceeds 2 hops (in which case relational recursive CTEs suffice). |
| **Next.js 14 & React** | Enterprise Web Frontend | Server-side rendering (SSR), type-safe React component ecosystem, seamless TailwindCSS integration, modern UI ergonomics. | Node.js build overhead; larger client bundle size compared to lightweight frameworks like Svelte or Solid. | If the interface must be embedded as an ultra-lightweight widget in legacy web portals. |
| **XGBoost** | Line-Item Matching Classifier | High accuracy on tabular feature vectors; fast inference; transparent feature importance scoring; robust against unnormalized scales. | Requires supervised training data; does not learn end-to-end representations like deep learning transformers. | If invoice descriptions frequently require multi-lingual cross-attention language models. |

---

## CHAPTER 5: Algorithm Selection & Comparative Analysis

### 5.1 Line-Item Linkage: XGBoost vs. Fuzzy String Matching vs. LLMs
- **Fuzzy String Matching (Levenshtein / Jaccard Only):** While fast ($O(mn)$), string distance alone ignores price and quantity. If an invoice lists `"100kW Pump"` at ₹5,000 and another lists `"100kW Pump"` at ₹50,000, Levenshtein distance considers them identical.
- **LLM Embeddings (Cosine Similarity):** Embedding models (e.g., OpenAI `text-embedding-3-small`) capture semantic meaning but are insensitive to crucial numeric variations (e.g., `Part #101` vs `Part #102`).
- **Satya AI's XGBoost Approach:** Combines lexical distance, token overlap, numeric digit agreement, unit price ratios, and quantity ratios into a balanced, trained classifier. It achieves superior classification precision without delegating financial authority to a black box.

---

## CHAPTER 6: Why Satya AI Uses a Hybrid Architecture

```
                    +-----------------------------+
                    | Incoming Source Transaction |
                    +-----------------------------+
                                   │
                                   ▼
              +-----------------------------------------+
              |   Deterministic Normalization & Math   |
              |   (Exact Decimal / Regex Clean / Hash)  |
              +-----------------------------------------+
                     │                           │
           [High Confidence Match]     [Ambiguous / Low Match]
                     │                           │
                     ▼                           ▼
        +-------------------------+ +-------------------------+
        | Commit to Deterministic | | Evaluate XGBoost Linkage|
        |         Ledger          | |   Feature Vector Space  |
        +-------------------------+ +-------------------------+
                     │                           │
                     │                     [Candidates]
                     │                           │
                     ▼                           ▼
              +-----------------------------------------+
              |     Centralized State Machine & SoD     |
              |       (Manager Decision Console)        |
              +-----------------------------------------+
                                   │
                                   ▼
              +-----------------------------------------+
              |   Token-Constrained Grounded Chatbot    |
              |    (Human Investigation Assistance)     |
              +-----------------------------------------+
```

### The Inherent Incompatibility of Pure LLM Accounting
Consider an enterprise scenario where an LLM is asked: *"Can we approve Invoice INV-802 for payment?"*
- An LLM reads the invoice and notes that the vendor name and total match the purchase order. It writes: *"Yes, the amounts match, you can release ₹50,000."*
- What the LLM missed: In the warehouse database, a receiving slip notes that all 50 units were returned due to water damage. The LLM had no formal ledger balancing mechanism, ignored the lack of receiving evidence, and authorized a ₹50,000 cash leak.
- **Satya AI's Defense:** The decision route is guarded by compiled code:
```javascript
if (action === "APPROVE" && (!snapshot.result.invoices.length || snapshot.result.ledger.canonicalOutstanding === null || snapshot.result.findings.some(f => f.severity !== "info"))) {
  throw fail(409, "A reconciled commercial invoice and resolved blocking evidence are required for whole-case approval");
}
```
No prompt, no LLM output, and no conversational query can ever bypass this hard programmatic gate.

---

## CHAPTER 7: Important Design Decisions & Trade-Offs

1. **Deterministic Arithmetic vs. Microsecond Latency:** We chose Python's 60-decimal precision module over native IEEE-754 floating point. While native floats execute in nanoseconds on hardware ALUs, `Decimal` arithmetic takes microseconds. In financial reconciliation, **correctness to the exact paisa is non-negotiable**, making the sub-millisecond CPU overhead completely justified.
2. **Strict In-App Alerts vs. Unconfigured SMTP/Push:** We chose persistent, database-backed alerts with deterministic deduplication keys over external email notifications. In development and competition environments, configuring external SMTP or Twilio APIs introduces external failure modes. The in-app alerting subsystem guarantees 100% testable, audit-traceable functionality without external network dependencies.
3. **Additive Schema Design vs. Destructive Migrations:** When extending models (`BusinessCase`, `SourceDocument`), all newly introduced fields (`assigneeId`, `exceptionStatus`, `verificationStatus`) default to `null` or open states. This ensures 100% backward compatibility with pre-existing MongoDB records without requiring destructive database migrations.

---

## CHAPTER 8: Research Defense & Difficult Reviewer Questions

### Q1: "Why did you build Satya AI when platforms like SAP and Oracle already have accounts payable modules?"
- **Short Spoken Answer:** Traditional ERPs perform rigid database joins that break whenever invoice descriptions or partial shipments diverge from the purchase order, forcing finance teams to fall back on error-prone spreadsheets. Satya AI provides an evidence-linked graph that resolves fuzzy discrepancies while mathematically guaranteeing deterministic financial correctness.
- **Deep Technical Explanation:** Traditional three-way matching assumes a 1:1:1 relational relationship between PO line, GRN line, and invoice line. In actual supply chains, the relationship is $M:N:P$ with partial deliveries, split payments, and credit note adjustments. Satya AI replaces static joins with an XGBoost-powered entity resolution engine, projected into a property graph in Neo4j, enabling multi-hop pathfinding across complex fulfillment histories.
- **Likely Follow-up:** *"How do you prove your matching doesn't introduce false matches?"*
- **Defense Warning:** Never claim 100% matching accuracy. Emphasize that Satya AI treats ML outputs strictly as *proposals* requiring human review before balances are altered.

### Q2: "How do you guarantee that your AI chatbot doesn't hallucinate financial balances?"
- **Short Spoken Answer:** Our language model never touches raw numbers. We use a patent-ready token-grounding architecture where the LLM outputs abstract placeholder tags, and our compiled backend substitutes the mathematically verified numbers before the answer reaches the user.
- **Deep Technical Explanation:** During context generation, the server computes an authoritative dictionary of facts (`CURRENT_CONTEXT.facts`). The LLM is constrained via strict JSON schema enforcement to output tags like `[[fact:ledger.supportedOutstanding]]`. The server intercepts the completion and replaces the tag with exact values from the immutable reconciliation snapshot. If an LLM attempts to output an unverified number, the template validation strips it.
- **Likely Follow-up:** *"What if the model hallucinates a factual claim not related to numbers?"*
- **Defense:** The system prompt explicitly enforces that history is conversational context, not financial truth, and cite IDs are strictly checked against `CURRENT_CONTEXT.evidenceIds`.

### Q3: "What prevents a company employee from colluding with a vendor to approve fraudulent invoices?"
- **Short Spoken Answer:** Satya AI mathematically enforces Segregation of Duties at the API kernel level: the user who imported or created the purchase order or invoice batch is strictly blocked from ever approving it.
- **Deep Technical Explanation:** In `lifecycleAndAnomalyService.js`, the `checkSegregationOfDuties()` function extracts the authenticated user ID from the verified JWT server context and checks it against `BusinessImport.actorId` and `BusinessCase.createdBy`. If the IDs match, the transaction is rejected with an HTTP 403 Forbidden, and a security alert is appended to the immutable audit log.

### Q4: "How does Satya AI handle currency mixing when aggregating corporate spend?"
- **Short Spoken Answer:** Satya AI never silently converts or mixes currencies. When cases with differing currencies are aggregated, the system outputs explicit mixed-currency warnings, keeping individual case ledgers sovereign and authoritative.
- **Deep Technical Explanation:** The aggregation pipeline in `/dashboard/summary` tracks all currencies observed across snapshots in a `currenciesSeen` set. If $|\text{currenciesSeen}| > 1$, `totals.currency` is flagged as `"MIXED"`, and an authoritative warning header is returned: *"Totals combine multiple currencies. Individual case balances are authoritative."*

---

## CHAPTER 9: Presentation & Live Demonstration Blueprint

### Recommended 3-Minute Competition Demonstration

```
+-----------------------------------------------------------------------------+
| MINUTE 1: THE CRISIS                                                        |
| - Show legacy spreadsheet with partial delivery and duplicate invoice.     |
| - Demonstrate how legacy accounting overpays by ₹50,000.                    |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| MINUTE 2: THE SATYA RESOLUTION                                              |
| - Upload CSV bundle to Satya AI.                                            |
| - Show 60-decimal reconciliation: Supported vs Disputed balance.             |
| - Open Evidence Drawer: Show exact CSV row and column locator.              |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| MINUTE 3: THE GOVERNANCE PROOF                                              |
| - Attempt self-approval: System triggers Segregation-of-Duties block (403). |
| - Open Chatbot: Ask "Why is this on hold?" -> Show token-grounded response. |
| - One-Click Export: Download audit-ready, formula-injection-safe CSV.       |
+-----------------------------------------------------------------------------+
```

---

## CHAPTER 10: Common Misconceptions & Pitfalls

| What Someone Might Incorrectly Think | The Reality in Satya AI | How To Defend |
| :--- | :--- | :--- |
| *"Satya AI uses AI to calculate account balances."* | **False.** All calculations are performed by deterministic, compiled 60-decimal fixed-point Python math. | State clearly: *"AI is never used for math. Math is deterministic; AI is used only for fuzzy entity resolution and natural language narration."* |
| *"The system automatically rejects fraudulent invoices."* | **False.** The system flags statistical and rule-based anomalies for human manager adjudication. | State clearly: *"Fraud requires legal intent. Satya AI provides objective discrepancy evidence so human managers can make legally sound decisions."* |
| *"A confirmed match means the invoice is paid."* | **False.** Confirming a match only links two records in the graph; payment release requires full three-way matching and manager approval. | State clearly: *"Linkage establishes evidence relationships; settlement requires passing all state machine guard conditions."* |
| *"CSV exports can just be raw database dumps."* | **False.** Raw database dumps can trigger formula injection attacks in Microsoft Excel. | State clearly: *"Satya AI sanitizes all exported cells according to RFC-4180 and prepends formula characters with apostrophes."* |

---

## CHAPTER 11: Quick Revision Sheets

### 1. Executive One-Pager
- **Core Problem:** Silent overpayment and operational paralysis caused by disconnected commercial trade documents.
- **The Solution:** Deterministic Decimal reconciliation + XGBoost record linkage + Neo4j graph topology + Token-grounded RAG copilot.
- **Key Metrics:** 60 digits of decimal precision; 8-dimensional feature linkage space; 100% enforced Segregation of Duties.

### 2. The 5 Immutable Rules of Satya AI
1. **Never guess a number.** If evidence is incomplete, output `"Needs Evidence"`.
2. **Never use floating-point math for money.**
3. **The creator can never approve.**
4. **Never let an LLM write a raw financial figure.** Use token grounding.
5. **Sanitize every export against spreadsheet formula execution.**
