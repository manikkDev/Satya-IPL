# Real-Data Company Build — working spec (BPI-2019 + semi-synthetic masters)

> Working document for the "simulate a real company" build requested by the team on 30 Oct 2026.
> Append progress notes at the bottom like `docs/plan/STATUS.md`. Do not commit yet — human reviews first.

## 1. Decision (research verdict)

**Backbone dataset: BPI Challenge 2019** — real procure-to-pay event log from a multinational
coatings/paints manufacturer (~60 subsidiaries). 251,734 purchase items, real POs, vendors
(anonymised IDs), goods receipts, invoices, payment clearings, real 2-way/3-way-match flows.
File already on disk: `ml-fl-service/data/raw/bpi2019-random.xml` (10,848 traces, XES format)
— parsed before by `ml-fl-service/data/bpi_lags.py`. Official source: 4TU DOI 10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1 (CC BY 4.0; also mirrored on Salzburg GitLab).

Rejected alternatives: SF Controller data (real but US-municipal, no GST/P2P chain), GeM
(scrape-only, thin detail), Kaggle PO sets (synthetic), DocILE (access-blocked), automobile
sector data (no public P2P dataset exists — do NOT fabricate "real").

**Sector stays: industrial engineering goods** — BPI is already industrial procurement.

## 2. Honesty rule (do not break)

BPI events are REAL; identities we attach are SYNTHETIC. Mark provenance honestly:
- `provenance: "CONSTRUCTED_DEMO"` stays on transformed records (or a new label e.g. note in seed docs: "transactions derived from BPI-2019 real log; identities synthetic").
- `/research` page + demo copy must say: "transaction patterns from a real company's
  procurement log (BPI Challenge 2019); company/vendor identities are fictional."

## 3. What we extract from the XES (step 1 — engine-side)

From each trace/item in `bpi2019-random.xml`:
- `case concept:name` → purchase document id; item attrs: `Item`, `Document Type`,
  `Item Category`, `Item Type`, `Spend area text`, `Sub spend area text`, `Vendor`,
  `GR-Based Inv`, `GR Indicator`, `Company`, `Purchasing Group` (+ event stream:
  Create Purchase Order Item → Create Goods Receipt → Create Invoice Receipt →
  Clear Invoice → payment).
- Build real per-PO timelines: PO date, GR events w/ qty+value, invoice events w/ amount+blocked flags, clearing events.
- Choose ONE subsidiary cluster (largest `Company` value group) = our demo group.
- Emit intermediate artifact: `ml-fl-service/assets/bpi_company.jsonl.gz`
  (documents[] + links[] + vendor registry + item registry) — deterministic, sha-pinned.

## 4. Identity layer (synthetic, but consistent)

- Group: e.g. "Meridian Coatings Group" → parent `MER-HQ` + 2–3 child entities mapped to
  BPI `Company` values (each: code, legalName, GSTIN*, PAN, CIN, stateCode, addresses,
  aatoBand, letterhead, bankAccounts).
- Vendors: BPI `Vendor` IDs → named MSME suppliers (real Indian supplier-style names,
  category from spend area: "raw materials"→chemical supplier, "packaging"→packaging MSME,
  "MRO"→engineering supplier). Each: gstins[], pan, udyam{number,category,verifiedAt},
  msme flag, bankAccounts[{masked, ifsc, accountHash, status}], paymentTermsDays,
  contacts[], tags.
- Items: BPI item descriptions → item master (code, description, specs, HSN, UOM,
  defaultGstRate from our real 21,933-code master + 1,123 rate rules).
- Users: proper roles per plan 01§8 — Sanjay (buyer), Priya (ap_manager), Meena (stores),
  QC user, treasury, Rakesh (entity_admin MD), CA Anil (auditor read-only). NOT generic
  "manager/analyst" — real names + role labels shown in UI.
- FX/currency: BPI is EUR → keep a currency note or restate as INR (mark conversion synthetic).

## 5. Server-side seed (step 2)

- `server/scripts/seed-bpi-company.mjs`: groups, entities, suppliers (with full masters),
  items, policies (DoA bands, tolerances, numbering), users w/ memberships+roles,
  documents (PO/GRN/INVOICE/PAYMENT from the artifact, `provenance: CONSTRUCTED_DEMO`),
  document_links (FULFILS/RECEIVES/BILLS/SETTLES), then trigger reconcile → cases/snapshots.
- Target: ~300–500 POs (bounded — Atlas free tier), 40–80 suppliers, all 4 BPI flow types.
- Keep flagship PO-1001 demo case intact (regression fixture).

## 6. Frontend surfaces to upgrade (step 3)

- Suppliers list: real columns (MSME badge, open value, overdue, issues) + Supplier 360 page
  (bank accounts w/ maker-checker status, addresses, GSTINs, open POs, deliveries, invoices,
  payments, duplicate-vendor alert, statement recon).
- Settings: Users & roles table (name, email, per-entity role chips w/ plain labels);
  Entities tab (GSTIN, addresses, bank, letterhead preview); Masters (items + HSN).
- Orders list must show the real volume (300+ POs → pagination/filter/search must work).
- PO PDF: align to `docs/SRIPO-0022.pdf` real layout (letterhead, PO meta grid, party
  blocks, item table, charges, tax summary, amount in words, terms, sign block, verify QR).

## 7. Machine safety (from plan 00§5)

- XES parse runs inside ml-fl-service container (2g/2cpu caps) or chunked streaming;
  never load the 100 MB DOM at once — iterparse.
- Output artifact ≤ ~40 MB gz; raw stays gitignored; artifact committed only if < 5 MB
  else regenerated by script.

## 8. Acceptance

- `/app/orders` shows 300+ real-derived POs w/ working filters.
- Supplier 360 shows bank/address/GSTIN/Udyam/terms.
- ≥1 case reconciles real BPI discrepancies → findings w/ evidence.
- PO PDF matches SRIPO-style layout sections.
- Roles visible in Settings → Users (non-generic names/titles).

## Progress log

- 2026-10-30: Decision recorded (this file). BPI-2019 chosen; extraction next.
- 2026-10-30: `satya_engine/data/bpi_extract.py` DONE — two-pass iterparse over
  `data/raw/bpi2019-random.xml`, dominant cluster `companyID_0000`. Emitted
  `ml-fl-service/assets/bpi_company.jsonl.gz` (68 KB gz, in-repo artifact):
  361 real POs, 4,857 GRN events, 443 INVOICE_IN, 51 PAYMENT_OUT, 124 cancel
  events, 5,351 links (RECEIVES/BILLS/SETTLES, basis=reference, CONFIRMED),
  80 vendors w/ topSpend. Run: `docker compose exec -T ml-fl-service python -m satya_engine.data.bpi_extract`.
  NEXT: (a) `server/scripts/seed-bpi-company.mjs` — group "Meridian Coatings Group",
  2–3 entities mapped to cluster, named suppliers w/ GSTIN/PAN/Udyam/bank/terms,
  items w/ real HSN, users w/ real role names, documents+links (CONSTRUCTED_DEMO),
  then reconcile jobs → cases; (b) UI: supplier 360 + settings users/entities +
  orders pagination at scale; (c) PO PDF vs SRIPO-0022.pdf. UNCOMMITTED — human reviews first.
- 2026-10-30: SEEDED. `scripts/seed-bpi-company.mjs` ran → group "Satya Equipment
  Distribution" (grp_01m63mw9ezb75ac11tdadz6wfn, entity ent_01m63mw9f2awyshw2ag1exgaa2):
  +361 POs (444 total), 4,857 GRNs, 443 INVOICE_IN, 51 PAYMENT_OUT, 55 named MSME
  suppliers w/ GSTIN/PAN/Udyam/bankAccounts/addresses/terms (68 total), items w/
  real HSN, links basis=reference CONFIRMED, 418 cases. Verified live:
  `GET /api/v2/documents?type=PO` on :5002 returns 444. (Note: server = host:5002,
  chatbot = :5001.) `scripts/seed-bpi-discrepancies.mjs` ran → 8 injected docs
  (duplicate_invariant BILLS/PROBABLE, unallocated payments no-UTR, over-billing
  +15%) tagged `bpi.injected` on first 15 BPI POs.
  OPEN ISSUE: POST /api/v2/cases/:id/reconcile returns 202 but snapshots stay null,
  findings stay at 8 (flagship case only). Reconcile appears async — need to check
  whether the worker runs (server logs / engine round-trip) or whether BPI doc
  shapes miss fields detectors require. NEXT AFTER: UI supplier-360, Settings
  users/roles + entities tabs, orders list pagination at 444, PO PDF vs SRIPO.
  To view real data: run client WITHOUT NEXT_PUBLIC_USE_MOCKS, MAIN_API=:5002.
- 2026-10-30: RECONCILE FIXED. Engine 422s were BusinessDocument extra="forbid"
  violations — removed `bpi` fields (doc + lines), channel "import"→"csv",
  `status:"blocked"`→"posted", `utr:""` removed, link basis "fuzzy"→"model" +
  `confidence:"0.82"`. All 19 jobs now complete, 0 dead → 905 findings across
  BPI cases. Debug helper: /tmp/replay.mjs (runs inside server container,
  replays collectCaseInputs payload + prints engine 422 detail).
  client/.env: MAIN_API_URL→:5002 (was :5001 = chatbot, wrong). Dev restarted
  without mocks — verified live: orders list serves real docs, suppliers master
  (68 vendors w/ GSTIN/PAN/Udyam/bank/addresses) renders ERP-style, case titles
  fixed to "PO number — Supplier name". New suppliers list = DataTable + full
  Supplier 360 (registration/bank/address/terms cards). NEXT: Settings users/
  roles + entities tabs; orders pagination at 444; model retrain (bounded);
  copilot verify w/ live data; PO PDF vs SRIPO.
- 2026-10-30 (cont.): SHAPE + DATA QUALITY FIXES. v2.case() mapped flat API →
  page shape + null-snapshot guard (investigations/[id]). Suppliers list rebuilt
  as ERP DataTable + Supplier 360 (registration/bank/address/terms); types
  extended. Case titles → "PO no — supplier". GSTIN saga: synthetic GSTINs were
  invalid on THREE levels — 13→15 chars, PAN 9→10 chars (AAAAA9999A), checksum
  = engine's left-to-right algo (satya_engine/india/gstin.py). All 55 suppliers
  + 5,720 docs seller.gstin + entity (27AAECS4821Q1ZU) + buyer.gstin updated.
  VERIFIED: TAX_GSTIN_INVALID cleared — only real findings remain (e.g.
  DOC_MISSING_INVOICE). Requeued reconcile ×55. NOTE: snapshots persist to
  `businesssnapshots` (fresh) vs `snapshots` (stale legacy). Remaining:
  settings users/roles + entities tabs, orders pagination at 444, model
  retrain bounded, copilot verify, PO PDF vs SRIPO.
