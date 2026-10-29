# 03 — Agent A: Engine, ML & Data (`ml-fl-service/**`)

You own the Python service. You are the **only place where money, quantity, tax and probability are computed.** Read 00, 02 (§2, §3, §6 fully), and 01 (§3.4, §4, §5, §6) before starting.

Owner test command (must be green before every push):
```bash
docker compose up -d --build ml-fl-service   # only when Dockerfile/requirements changed
docker compose exec -T ml-fl-service python -m pytest -q tests        # fast suite (< 60 s)
```
Heavy jobs (dataset build, training, evaluation) run via `docker compose exec -T ml-fl-service python -m satya_engine.cli <command>` with thread caps (00 §5). Never run them on the host.

---

## 1. Current state (what exists)
- `app.py` FastAPI with legacy endpoints; `business_contracts.py` (Pydantic, exact decimals), `business_reconcile.py` (272 lines: quantity ledger, duplicate detection by normalised reference, conservative payment allocation, 3 balances, scenario/knowledge-time), `business_matching.py` + `business_training.py` (XGBoost pair model `satya-pair-xgb-v2` trained on constructed pairs; PR-AUC ≈ 0.97 on constructed data), `business_imports.py` (CSV mapping/validation), `business_demo.py` (5 demo cases incl. flagship PO-1001), tests in `tests/test_business*.py` (29 passing).
- Large **legacy** federated-learning code from an older project: `arth_fl/`, `data/` (download/partition/augment), `experiments/`, `explain/`, `graph/`, `jobs/`, `models/`, `vertical/`, `settings.py`, `requirements*.txt` other than `requirements-business.txt`. The Dockerfile only copies the `business_*.py` files.
- `render.yaml` deploys this folder as `satya-ipl-ml` (rootDir `ml-fl-service`) — **do not rename the folder**.

## 2. Target layout
```
ml-fl-service/
  Dockerfile                    # slim, non-root, copies satya_engine/ + app.py + assets/
  app.py                        # thin: create_app() from satya_engine.api
  requirements-business.txt     # runtime deps only (see §3)
  requirements-dev.txt          # pytest, hypothesis (dev only)
  satya_engine/
    __init__.py  version.py     # ENGINE_VERSION = "2.0.0"
    api.py                      # FastAPI routers v2 + legacy routes kept behind compat module
    compat_v1.py                # re-exports old business_* behaviour for legacy endpoints
    contracts_v2.py             # Pydantic models mirroring 02 §3 / §6
    money.py                    # Decimal helpers, rounding, Indian number words
    india/
      gstin.py  states.py  fy.py  hsn_master.py  tax.py  tds.py  einvoice_qr.py
    recon/
      ledger.py  detectors/*.py  allocate.py  recommend.py  graph.py  snapshot.py  scenario.py
    ml/
      features.py  blocking.py  pairs.py  calibrate.py  conformal.py  assign.py
      vendor_dedupe.py  anomaly.py  registry.py  explain.py
    docs/
      parse.py  validate.py  render.py
    data/
      bpi2019.py  hsn_build.py  generator.py  injectors.py  gem_orders.py (optional)  docile_eval.py (optional)
    eval/
      report.py  metrics.py
    cli.py                      # build-hsn | fetch-bpi | build-dataset | train | evaluate | export-sample
  assets/
    hsn_master.v<date>.json.gz  # committed, < 5 MB
    gst_state_codes.json
    irp_public_keys/            # official IRP public certificates (.cer/.pem) + index.json {kid, x5t, validFrom, validTo, irp}
    samples/                    # tiny committed fixtures (≤ 2 MB total)
  runs/satya-models/            # baked model artifacts (json/ubj), model cards
  data/raw/ data/processed/     # gitignored
  tests/
```

## 3. Dependencies (runtime)
Keep: `fastapi`, `uvicorn`, `pydantic`, `numpy`, `scipy`, `scikit-learn`, `xgboost-cpu`. Add (verify each wheel exists for linux/amd64 Python 3.11 and record installed size in STATUS): `rapidfuzz` (string similarity, C++), `pypdfium2` (PDF render + text, no system deps), `zxing-cpp` (QR decode), `cryptography` (JWS RS256 verification), `python-multipart` (uploads), `orjson` (optional). Dev only: `pytest`, `hypothesis`. **Not allowed** in runtime: torch, tensorflow, transformers, sentence-transformers, spacy, paddle, opencv-full.

---

## 4. Tasks

### P1-A1 — Restructure and remove legacy (½ day)
1. Build an import graph: which legacy modules are imported by `app.py` or `business_*.py`? (expected: none). Record result in STATUS.
2. Move business code into `satya_engine/` (compat shims so old imports keep working until tests are migrated). Delete legacy FL folders/files listed in §1 **only after** confirming nothing imports them and the Docker image builds. Remove legacy env vars (`FLOWER_PYTHON`, `PROGRESS_WEBHOOK`) from your `.env.example`; ask B (handoff) to remove them from `render.yaml`.
3. Existing 29 tests must still pass (migrate to pytest discovery; keep unittest-style classes).
**Done when:** image builds, `/health` returns `engineVersion`, tests green, repo size of the folder drops.

### P1-A2 — Contracts v2 (½ day)
Implement `contracts_v2.py` exactly per 02 §3/§6 (Pydantic v2, `model_config = ConfigDict(extra="forbid")` on requests, decimal strings validated by regex `^-?\d{1,15}(\.\d{1,6})?$`, ISO dates with offset, enum certainty/actions). Provide `GET /v2/schema` returning JSON Schemas (B and C can generate types/validators from it).
**Tests:** rejects floats for money, missing timezone, unknown fields; round-trips flagship fixtures.

### P1-A3 — HSN master builder (1 day)
Goal: a versioned, auditable HSN/rate reference.
1. Source A (descriptions + codes): the official **HSN directory Excel** from the GST portal ("Search HSN Code → Download HSN Directory in Excel Format") [V]. The human may need to download it manually if automated download is blocked; `cli build-hsn --hsn-xlsx <path>` must accept a local file. Excel parsing: use `openpyxl` **only in the build step inside the container** (add to requirements-dev, not runtime) or ask the human to save as CSV.
2. Source B (rates): CBIC "GST Goods and Services Rates" schedules [V] reflecting the **56th GST Council changes effective 22 Sep 2025** [V]. Rates are defined by chapter/heading/sub-heading ranges in schedules → store as `rateRules: [{prefix, description, rate, cessRate?, schedule, sNo, effectiveFrom, effectiveTo?, notificationRef}]`; resolve a code's rate by **longest matching prefix** whose description the builder records. Where a schedule entry depends on a condition you cannot evaluate (e.g., "other than …"), mark `conditional: true` and the tax engine returns a warning "Rate depends on product details — confirm".
3. Output `assets/hsn_master.v<YYYYMMDD>.json.gz` = `{version, builtAt, sources:[{name,url,retrievedAt,sha256}], codes:[{code, description, chapter}], rateRules:[...]}`. Commit only if < 5 MB; else commit chapters 25–98 relevant subset + document.
4. `hsn_master.py`: `lookup(code, on_date) -> {rate, cessRate, effectiveFrom, notificationRef, conditional, matchedPrefix} | None`; `search(q)` (rapidfuzz on descriptions + exact prefix).
**Never type rates from memory.** If sources cannot be obtained, ship the engine with `rate: null` + warning and report the blocker to the human via STATUS.
**Tests:** prefix resolution, effective dates (a code with a rate change on 22 Sep 2025 returns old rate for 21 Sep and new for 22 Sep — construct the fixture from the actual notification data you loaded), unknown code → None.

### P1-A4 — India helpers (½ day)
- `gstin.py`: format regex, **mod-36 checksum** (weights 1,2 alternating, fold `floor(p/36)+p%36`, check char index `(36 - sum%36) % 36`) [V], state code extraction, embedded PAN, entity type hint (4th PAN char). `make_fictional_gstin(state, pan_stub)` for demo data (checksum-valid; demo only; documented as fictional).
- `states.py`: official GST state/UT codes table (from GST portal); UT-without-legislature flag for UTGST.
- `fy.py`: `fy_of(date)`, FY boundaries, PT-midnight helper not needed here.
- `money.py`: quantize, banker's vs half-up (use **ROUND_HALF_UP** for tax per line and invoice round-off to nearest rupee — make rounding mode a policy value), `amount_in_words_inr(Decimal)` using lakh/crore ("Rupees Seventy Thousand Eight Hundred Only"; paise handled).
- `tds.py`: rule tables keyed by FY: for FY ≤ 2025-26 cite IT Act 1961 s.194Q; for FY ≥ 2026-27 cite IT Act 2025 s.393 [V]; threshold ₹50 lakh per seller per FY, rate 0.1% on excess, buyer prior-year turnover > ₹10 crore [V]; output is informational (`tds393Applicable`, `estimatedTds`) — never authoritative tax advice.
**Tests:** checksum on known valid sample from GSTN docs; words for 70800.00, 1,18,000.50, 1,00,00,000.

### P1-A5 — Tax engine `/v2/tax/compute` (1 day)
Algorithm per line: `gross = qty × rate`; `discount = gross × discountPct/100`; `taxable = gross − discount` (quantize 2 dp HALF_UP); rate = override or HSN master on `docDate`; if supplyType in (`EXPWOP`,`SEZWOP`) and valid LUT for FY → rate applied 0 with `zeroRated:true` (warn if LUT missing/invalid FY); if reverseCharge → compute tax but mark `payableBy:"recipient"` and exclude from grand total payable to supplier; intra-state (seller state == placeOfSupply) → CGST = SGST = taxable × rate/2/100 (UTGST for UT w/o legislature) else IGST = taxable × rate/100; cess if present. Charges (freight/packing) taxed with their own rate if provided, else warning "rate for charge not provided". Totals; round-off to nearest rupee as separate line if policy; amount in words; `taxSummary` grouped by (hsn, rate). Flags: `ewayBillRequired` when consignment value (taxable + tax for goods lines) > ₹50,000 [V]; `einvoiceExpected` when supplier entity `aato` band ≥ threshold [CFG]; `hsnDigitsRequired` 4 or 6 by AATO band [CFG]; `tds393Applicable` informational.
Warnings: HSN not found, conditional rate, HSN digits insufficient, place of supply missing, GSTIN invalid checksum, state code of GSTIN ≠ address state.
**Tests (≥ 25):** intra vs inter-state, UT, discount rounding, round-off, LUT zero-rated, missing LUT, RCM, charges, multi-rate summary, 40% special rate fixture from master, words, property test: Σ line totals + round-off = grand total; CGST == SGST always.

### P2-A6 — Reconciliation engine v2 `/v2/reconcile/case` (3–4 days)
Design: **event-sourced line ledger**.
1. Normalise all documents into events ordered by `(observedAt, documentDate, id)` filtered by `knowledgeTime` (bitemporal: valid time = document date, knowledge time = observedAt; no future observations in replay — keep existing guarantee).
2. Per PO line maintain `{ordered, amendedOrdered, shortClosed, received, accepted, rejected, returned, invoicedQty, invoicedValue, creditedValue, paidValue, advanceAvailable, advanceAdjusted}` as Decimals. PO amendments apply from their effective date; invoices are checked against the revision valid at supply date.
3. Link resolution order: explicit references (CONFIRMED) → reviewer decisions (CONFIRMED) → normalised reference rules (PROBABLE) → ML candidates via `ml/` with conformal sets (PROBABLE/POSSIBLE/AMBIGUOUS) → none (INSUFFICIENT_EVIDENCE).
4. Detectors: one module per taxonomy code in 01 §4 (start with all QTY_*, PRICE_VARIANCE, PRICE_UNAUTHORISED_CHARGES, DUP_*, PAY_*, TAX_RATE/TYPE/ARITHMETIC/GSTIN_INVALID/NOT_IN_GSTR2B/RULE37/QR_MISMATCH/EWAYBILL_MISSING/LUT_MISSING, MSME_45DAY_RISK, DOC_*). Each detector: pure function `(state, policy) -> list[Finding]`, has `version`, unit tests with a minimal fixture, and produces `calculation` steps and `whatResolvesIt` text.
5. Money balances (keep the three-balance idea, renamed for humans): `recordedPayable` (what AP postings say), `evidenceSupportedPayable` (accepted qty × agreed price + tax − credits − advances adjusted − paid), `disputedExposure` (suspected duplicates/overbilling/unallocated), plus `itcAtRisk` and `msmeOverdue`. Ranges when ambiguous (min/max over candidate allocations).
6. Invariants (property tests with hypothesis): **cash conservation** (Σ allocations ≤ payment amount; no payment counted twice; repeated UTR observations add no cash), **quantity conservation** (accepted + rejected ≤ received; invoiced qty supported ≤ accepted), **order invariance** (shuffling input order gives identical snapshot), **idempotence** (same input → same `snapshotId`), **no future leakage**.
7. Recommendation per 01 §6 with scope amounts.
8. `GraphPayload` per 02 §5.6 including `stage` per node and `timeline` buckets for the replay scrubber; edge `explanation` in plain language ("Payment T01 pays ₹30,000 of invoice INV-041 — the bank reference quotes the invoice number").
9. Flagship regression (01 §4 numbers) + the 4 other legacy demo cases must keep their outcomes.
**Done when:** all detectors have tests; invariants pass 200 hypothesis examples each; p95 latency < 500 ms for a case with 200 documents in the container.

### P2-A7 — Payment allocation `/v2/allocate/payment` (1 day)
Exact integer paise arithmetic. Candidate pool: open invoices of the same supplier (and entity unless policy allows group payments) within a date window [CFG, default −120/+30 days]. Candidate amounts per invoice: outstanding, outstanding − TDS (if TDS applicable), outstanding − credit notes. Reduce pool by reference hints first. Search with **meet-in-the-middle subset-sum** over ≤ 24 candidates (2×2^12 states), tolerance for bank charges [CFG, default ₹0]. Return up to 20 solutions sorted by plausibility (fewest invoices, oldest first, date proximity). `unique` → PROBABLE; multiple → AMBIGUOUS with all solutions; none → INSUFFICIENT_EVIDENCE (partial payment possible). Never auto-apply; output is suggestion for the reviewer workbench.
**Tests:** T03 ₹15,000 in flagship → AMBIGUOUS; unique combo; TDS-net combo; > 24 candidates → pruned with explanation.

### P2-A8 — Document parsing `/v2/docs/parse` + `/v2/docs/validate` (2 days)
Pipeline (deterministic, free, local):
1. Detect mime. PDF → `pypdfium2`: page count (cap 20), text layer per page; render first ≤ 3 pages at ~150–200 DPI to PNG (cap long side 1600 px) for QR scan and for LLM fallback.
2. **Signed e-invoice QR**: decode QR codes with `zxing-cpp` on rendered pages/images. A signed QR is a JWT (header.payload.signature, RS256) issued by an IRP; payload `data` contains SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt, TotInvVal, ItemCnt, MainHsnCode, Irn, IrnDt [V]. Verify signature with the matching **IRP public key** from `assets/irp_public_keys/` (download the official certificates listed on `einvoice.gst.gov.in/publickeys` [V]; record validity windows; select by header `kid`/`x5t` or try keys valid on IrnDt). Output `qr.verified=true` only on successful cryptographic verification; otherwise `qr.found=true, verified=false, reason`.
3. CSV/Excel/JSON (e-invoice JSON schema, GSTR-2B JSON) → deterministic parsers (reuse/upgrade `business_imports.py`).
4. If a text layer exists and the type is recognised, return text for LLM structuring (`needsLlm=true`, no images needed) — cheaper than vision. If no text layer (scan/photo) → `needsLlm=true` with `pageImages`.
5. `/v2/docs/validate`: field validators — GSTIN checksum & state, date sanity (not future, within FY rules), HSN exists in master, line arithmetic (qty×rate−discount=taxable ±₹1), tax type vs place of supply, totals sum, QR cross-check (QR DocNo/DocDt/TotInvVal/SellerGstin must equal extracted values; mismatch → TAX_QR_MISMATCH issue), duplicate hint (same seller GSTIN + number + FY exists — B passes known numbers). Per-field confidence = combination of source agreement (QR-verified = 1.0; QR + LLM agree = 0.98; LLM only with quote found in text layer = 0.9; LLM only, no quote = 0.6) and validator pass/fail. Suggestions: supplier match (GSTIN exact → CONFIRMED, else name similarity), PO match (number normalisation + candidate scoring).
**Tests:** sample signed QR from the official GST QR procedure document [V] (header/payload decode; signature verification with the corresponding key if available — otherwise test with a locally generated RSA key pair and a fixture JWT); scanned image without text → needsLlm; arithmetic failure; QR mismatch.

### P3-A9 — Datasets (2–3 days) — real first, synthetic last
| Dataset | Real? | Use | Access & licence notes |
|---|---|---|---|
| **BPI Challenge 2019** (4TU.ResearchData; IEEE Task Force on Process Mining) | **Real** event log from a multinational coatings & paints company; purchase-order handling for ~60 subsidiaries; PO line items with 3-way/2-way/consignment flows, GR/IR events, values [V] | Learn real timing distributions (PO→GR→IR→clear lags), partial delivery/invoice frequencies, value changes, vendor/item anonymised names; build a **process-state reconstruction benchmark** (e.g., items where invoiced value > GR value; invoice before GR when GR-based IV is required; payment blocks) and evaluate the engine's detectors on real sequences | Download from `data.4tu.nl` (DOI page). **Check the licence shown on the dataset page and record it in the model card** before use; cite van Dongen (2019). HEAD first; stream; process in chunks; keep only derived aggregates + small samples in git |
| **BPI 2019 OCEL** version | Real (transformed) | Object-centric view (PO, item, invoice objects) — optional, easier linkage | 4TU [V] |
| **GST portal HSN directory + CBIC rate schedules** | **Real, official** | Item catalogue realism + tax engine reference | Public government data |
| **GeM orders (public order listings)** | **Real Indian procurement orders** (order id, date, amount, vendor, MSME flag visible on public pages) [V] | Indian amount distributions, MSME share, vendor-name variation patterns for supplier dedupe | Optional. Respect each site's terms/robots; no aggressive scraping; prefer manual export of a few hundred rows by the human; no personal data |
| **DocILE** (ICDAR 2023) | **Real** business documents (6.7k annotated invoices/orders) + synthetic [V] | Evaluate document extraction accuracy (field-level F1) of our parse+LLM pipeline | Research access via request form (human action); do **not** redistribute; evaluation only, never commit documents |
| **Calibrated scenario generator** (ours) | Semi-synthetic | The only way to get **linked PO+GRN+QC+invoice+payment+GST bundles with ground-truth discrepancy labels** — no public dataset provides this | Generated deterministically from seeds; distributions fitted on BPI 2019; items from HSN chapters 73/84/85/40/90; error injection per taxonomy with documented rates; every record tagged `provenance: CONSTRUCTED_DEMO` |

Generator spec (`data/generator.py`, `data/injectors.py`): parameters `--groups 1 --entities 3 --suppliers 60 --pos 2000 --seed 42`. For each PO: 1–8 lines, multi-batch schedules; deliveries sampled from BPI-fitted lag distributions; QC acceptance rates; invoices per batch or consolidated; payments with terms (advance %, credit days), split/combined payments, TDS when applicable, MSME suppliers (share from GeM sample or configurable default), GSTR-2B presence probability. Injectors (each with rate param and label): near-duplicate invoice (ref formatting, ±1 day, OCR-like digit swaps), exact duplicate, cross-entity duplicate, advance not adjusted, rejected qty invoiced, price variance (small harmless vs large), unauthorised freight, wrong tax type, wrong rate, unallocated payment, combined payment ambiguity, missing GRN, bank account change, duplicate vendor (name variants: "Pvt Ltd"/"Private Limited", initials, transliteration), currency mismatch. Output: JSONL of BusinessDocuments + `labels.jsonl` (true links, true findings). Commit only `assets/samples/` (≤ 2 MB). Also export the **demo dataset** used by B's seeder (3 entities, ~25 suppliers, ~150 POs, the 5 legacy cases unchanged) as `assets/samples/demo_v2.jsonl`.

### P3-A10 — Matching v2 (3 days)
1. **Blocking** (`blocking.py`): multi-pass candidate generation — same supplier GSTIN/PAN; normalised document number (strip non-alphanumerics, unify O/0 and I/1 only as a *feature*, not as equality); amount within tolerance bands; date windows; char 3-gram TF-IDF (`sklearn` `TfidfVectorizer(analyzer="char_wb", ngram_range=(3,4))`) + `NearestNeighbors(metric="cosine")` for descriptions. Report recall of blocking on labelled data (target ≥ 0.99).
2. **Features** (`features.py`): rapidfuzz ratio/partial/token_set, Jaro–Winkler, normalised-ref edit distance, char-n-gram cosine, **spec extraction** (numbers+units: kW, HP, mm, inch, bar, A, V, phase; conflicting specs → hard negative feature), HSN agreement (4/6/8 digit), UOM compatibility, qty ratio, |Δamount|, relative Δamount, Δdays vs BPI-fitted lag percentiles, same entity, GSTIN equality, reference-present flags, TDS-adjusted amount match. Optional: Gemini embedding cosine supplied by B/C in the request (`embeddingSim`) — model must work without it.
3. **Models** (`pairs.py`): one XGBoost binary classifier per task (`invoice_po_line`, `grn_po_line`, `invoice_invoice_dup`, `payment_invoice`, `supplier_supplier`, `item_item`) with **monotone constraints** where domain says so (e.g., higher |Δamount| never increases match probability), `max_depth ≤ 6`, `n_estimators ≤ 400`, `nthread=2`. Explanations from XGBoost `pred_contribs=True` (SHAP values, built-in, no `shap` dependency) → top 3 human-readable reasons.
4. **Calibration** (`calibrate.py`): isotonic regression on a held-out calibration split; report ECE (15 bins) before/after.
5. **Conformal ambiguity** (`conformal.py`): split conformal prediction (Angelopoulos & Bates) per task (Mondrian by task): nonconformity `1 − p(match)`; calibrate quantile `q̂` at level `1−α` (default α = 0.05) on held-out *true* pairs; prediction set for an anchor = all candidates with `1 − p ≤ q̂`. Set size 0 → INSUFFICIENT_EVIDENCE/no match; 1 → PROBABLE if p ≥ 0.9 else POSSIBLE; ≥ 2 → **AMBIGUOUS** (return all members). Report empirical coverage (target ≈ 1−α), average set size, abstention rate. This is our principled answer to "categorise ambiguous entries rather than fabricate".
6. **Assignment** (`assign.py`): for one-to-one tasks, `scipy.optimize.linear_sum_assignment` on cost `−log p` with dummy "no match" columns at cost `−log(1−p_threshold)`; only assignments inside the conformal set and unique are proposed.
7. **Vendor dedupe** (`vendor_dedupe.py`): Fellegi–Sunter model with EM (implement ~150 lines numpy, inspired by Splink/fastLink): comparison vectors on PAN (exact), GSTIN (exact/same PAN), name (Jaro–Winkler bands after legal-suffix normalisation), bank account hash (exact), address pincode, phone/email domain; output match weights + probability; clusters via union-find over PROBABLE pairs; never merge automatically.
8. **Registry** (`registry.py`): artifacts in `runs/satya-models/<task>/<version>/` with `model.ubj`, `calibrator.json`, `conformal.json`, `card.json` (data sources, splits, metrics, limitations, trainedAt, seed, featureList). `GET /v2/models/status` serves cards. Engine loads lazily; if missing → heuristic scorer labelled `heuristic` (existing behaviour) — never crash.
**Splits:** group-by-supplier split (no supplier in both train and test) **and** temporal split; report both. Hard-negative mining (same supplier, similar amount, different invoice).
**Memory/time:** training on 200k pairs must stay < 1.5 GB RSS and < 10 min in the container; if not, subsample and document.

### P3-A11 — Anomaly (1 day)
- Price: per (item or HSN-6, supplier optional) robust baseline median & MAD over history; robust z = 0.6745 × (x − median)/MAD; flag |z| > 3.5 (Iglewicz–Hoaglin) as `PRICE_ANOMALY` POSSIBLE (never hold automatically).
- Invoice-level: `IsolationForest(n_estimators=200, contamination="auto", n_jobs=2)` on [amount log, lines, Δdays PO→invoice, price z max, round-amount flag, weekend flag] — score + top contributing features (permutation-based approximation).
- Portfolio signal: Benford first-digit conformity per supplier using MAD thresholds (Nigrini) — shown only as an analytics indicator on supplier pages, explicitly "not evidence of wrongdoing".

### P3-A12 — Learning from reviewers (1 day)
`/v2/train` (internal, disabled when `ENV=production` unless `ALLOW_TRAIN=1`): accepts labelled pairs exported by B from `decisions` (confirm duplicate, allocation, link/unlink) + generator data; retrains, recalibrates, re-runs conformal calibration, writes a new versioned artifact and card; B decides activation. Uncertainty sampling helper returns the 20 most informative open pairs for the review queue.

### P3-A13 — Evaluation report `/v2/evaluation/report` (1 day)
Sections: datasets (with real/semi-synthetic labels and licences), BPI 2019 process benchmark results (counts of each detected pattern; sanity checks against known BPI characteristics), matching metrics per task (PR-AUC, ROC-AUC, F1@threshold, ECE before/after calibration, conformal coverage & set size, abstention), ablation (rules only → +ML → +conformal: false-auto-links vs analyst workload), allocation solver stats, document extraction accuracy (on DocILE subset if obtained, else on generated PDFs) per field, latency. Every number generated by code from saved runs; the report includes `limitations` (constructed labels ≠ real-company accuracy). D renders it on `/research`.

### P3-A14 — Compliance deadline engine `/v2/compliance/deadlines` (1 day)
MSME: due = acceptance date (QC/GRN date, or deemed acceptance) + min(agreed days, 45) for micro/small; 15 days if no written agreement flag [V]; interest estimate 3× bank rate compounded monthly (bank rate from policy config, with source) [V]; 43B(h) exposure = unpaid MSME amounts beyond due at FY end. Rule 37: invoice date + 180 days, unpaid value+tax with ITC claimed → reversal risk [V]. E-invoice 30-day: for our outgoing invoices when entity AATO ≥ ₹10 crore [V]. PO delivery schedule overdue. Output sorted by urgency with plain-language explanation and legal reference text.

### P4-A15 — Hardening
Memory profile: idle RSS < 300 MB, peak during reconcile < 450 MB (Render 512 MB). Startup < 15 s (lazy model load). Structured JSON logs with requestId. Input size caps (≤ 2,000 documents per reconcile call; ≤ 10 MB uploads). 100% of endpoints covered by at least one test. Update your `.env.example` and a short `ml-fl-service/README.md` (commands, endpoints, model cards).

## 5. Handoffs you will receive / give
- B needs: `/v2/tax/compute`, `/v2/reconcile/case`, `/v2/docs/*`, `/v2/compliance/deadlines`, demo dataset `assets/samples/demo_v2.jsonl` (by end of P2).
- C needs: `/v2/schema` (to build the extraction JSON schema), `/v2/models/status` for copilot answers about model quality.
- D needs: `/v2/evaluation/report` shape (via B proxy `GET /api/v2/research/evaluation`) — publish a fixture JSON early in `assets/samples/evaluation_report.example.json`.
