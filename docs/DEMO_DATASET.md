# Curated demo dataset

The demo group (`Group.legacyCompanyId = "satya-demo"`, users `manager@` / `analyst@` / `auditor@satya.demo`) holds one fictional company. Its purchasing history covers 35 purchase orders, and each order tells one situation that can be explained. The dataset replaces the old BPI-derived bulk demo of 455 cases and 2,070 findings.

- Source: `server/src/seed/`
  - `company.js` holds the master data.
  - `stories.js` holds the purchase orders.
  - `build.js` is a pure builder.
  - `validate.js` checks the invariants.
  - `curated.js` writes the data to the database.
- Tests: `server/test/seed.*.test.mjs`.

## Honesty note

Everything here is **constructed demo data** (`provenance: "CONSTRUCTED_DEMO"` on every document). None of it describes real companies, registrations, bank accounts or transfers.

The PANs, GSTINs, Udyam numbers, IRNs, e-way bill numbers and UTRs were made up to be **format-valid and internally consistent**, not to match any real registration:

- every GSTIN passes the GSTN checksum and embeds the party's PAN;
- the 4th PAN character matches the holder type;
- the state code agrees with the city and PIN code;
- IRNs are SHA-256 of supplier GSTIN + FY + document type + number, which is how the e-invoice portal (IRP) builds them.

Satya does not verify any of these against the GST portal, the Udyam portal or a bank. Supplier e-mail addresses use the reserved `.example` domain.

GST rates are the legally applicable rates after the 22 Sep 2025 rationalisation (Notification 9/2025-CT(Rate)):

- 5% for power-driven pumps primarily for water (HSN 8413 70 10);
- 18% for valves, bearings, transmission parts, seals and gaskets, motors, control panels, pipe fittings, fasteners and process-pump parts.

There are no 28% or 40% items and no services.

## The company

| | |
|---|---|
| Legal name | Satya Equipment Distribution Pvt Ltd (entity code `SATYAD`) |
| Address | Gat No. 214, Pune–Nashik Highway, Chakan MIDC Phase II, Pune, Maharashtra 410501 |
| GSTIN / PAN | `27AAKCS4821M1ZW` / `AAKCS4821M` (company, state 27) |
| CIN | `U46599MH2019PTC184322` |
| Bank | HDFC Bank, Chakan · `****7741` · `HDFC0001207` |
| LUT | `AD270326041178K`, FY 2026-27, valid 2026-04-01 → 2027-03-31 |
| AATO band | ₹5–10 crore (e-invoicing applicable) |
| Approvals | POs up to ₹10 lakh: AP manager. Above that: group admin |

**Users** (password from `DEMO_PASSWORD`, default `SatyaDemo@123`; existing passwords are never changed unless `DEMO_RESET_PASSWORDS=1`):

| Login | Name | Role |
|---|---|---|
| `manager@satya.demo` | Priya Kulkarni | AP manager (`ap_manager`): approves, decides findings, allocates payments |
| `analyst@satya.demo` | Sanjay Deshmukh | Operations analyst (`buyer` + `ap_clerk`): raises POs, records GRN/QC, uploads invoices |
| `auditor@satya.demo` | CA Anil Mehta | Auditor, read-only (`auditor`) |

## Suppliers

| Supplier | Holder (PAN 4th) | GSTIN | Location (state) | MSME | Terms | E-invoice |
|---|---|---|---|---|---|---|
| Shakti Industrial Suppliers Pvt Ltd | company (C) | `27AAHCS6742Q1ZJ` | MIDC Bhosari, Pune 411026 (27) | small · `UDYAM-MH-26-0012345` | 45 days | yes |
| Kaveri Pumps & Motors Ltd | company (C) | `29AACCK4412P1Z7` | Peenya Industrial Area, Bengaluru 560058 (29) | medium · `UDYAM-KR-03-0009821` | 30 days | yes |
| Rathod Engineering Works Pvt Ltd | company (C) | `27AAJCR8821M1ZQ` | MIDC Chinchwad 411019 (27) | micro · `UDYAM-MH-26-0077112` | 45 days | no |
| Deccan Valve Industries | partnership firm (F) | `27AAKFD3320R1Z3` | Additional MIDC, Satara 415004 (27) | small · `UDYAM-MH-31-0044559` | 30 days | no |
| Maratha Bearings & Drives LLP | LLP (F) | `27AAPFM9012K1ZU` | MIDC Waluj, Chh. Sambhajinagar 431136 (27) | small · `UDYAM-MH-04-0033117` | 30 days | no |
| Meridian Pump Supply (flagship, prop. Rajesh Joshi) | proprietor (P) | `27BXJPJ7316C1ZK` | Shivaji Udyamnagar, Kolhapur 416008 (27) | micro · `UDYAM-MH-18-0061204` | 45 days | no |
| Saurashtra Castings & Flanges Pvt Ltd | company (C) | `24AAFCS2209H1ZO` | GIDC Lodhika (Metoda), Rajkot 360021 (24) | small · `UDYAM-GJ-20-0018874` | 45 days | yes |
| Kongu Pumps & Spares Pvt Ltd | company (C) | `33AADCK7758N1ZY` | SIDCO Kurichi, Coimbatore 641021 (33) | small · `UDYAM-TN-12-0027730` | 45 days | yes |
| Aravali Electricals & Controls Pvt Ltd | company (C) | `06AAGCA5531D1Z4` | Sector 24, Faridabad 121005 (06) | small · `UDYAM-HR-03-0015569` | 45 days | yes |
| Indrayani Fasteners & Hardware (prop. Sunita Pawar) | proprietor (P) | `27CQPPP4408F1ZK` | Kharabwadi, Chakan 410501 (27) | micro · `UDYAM-MH-26-0103388` | 30 days | no |
| Godavari Electric Motors Ltd | company (C) | `27AABCG1187E1ZT` | MIDC Satpur, Nashik 422007 (27) | not MSME | 60 days | yes |

Each supplier has:

- one active, maker-checker-approved bank account (masked, with an HMAC hash; the last four digits are unique per supplier);
- one contact;
- one address;
- tags `msme-<category>` and `intra-state` or `inter-state`.

Micro and small suppliers are never on terms above 45 days. Payments to them land within `min(terms, 45)` days unless a story is about lateness.

The 26 items (`PMP-*`, `VLV-*`, `BRG-*`, `MTR-*`, `PNL-*`, `FLG-*`, …) carry 8-digit HSN codes. Each item lists the suppliers it is bought from.

## Purchase orders and their stories

Numbers follow the entity series `SATYAD/PO/26-27/NNNNNN`. GRN, QC, RTN and PV (payment voucher) documents use the same pattern, numbered contiguously by date. The numbers below come from a seed run on 14 Nov 2026. They are stable for any run date inside FY 2026-27.

Supplier invoice numbers follow each supplier's own style (`SIS/26-27/0067`, `KPML/2627/01877`, `KPS2627-0290`, `IFH-0541`, …). They are at most 16 characters, as Rule 46 requires, and increase with date.

The "Expected findings" column lists what the engine *should* raise once the pending engine and server fixes below land.

| Story | PO | Supplier | What happened | Expected findings | Case status |
|---|---|---|---|---|---|
| S01 | 000003 | Shakti | Clean 3-way match: two pump sizes received, inspected, billed and paid in full | none, clean | resolved · owner 000001 |
| S02 | 000023 | Kaveri | Partial delivery: 12 of 20 and 6 of 10 submersibles received and billed; balance lot pending | `DELIVERY_SHORTFALL` | open · owner 000002 |
| S03 | 000017 | Rathod | Duplicate invoice: REW/26-27/0201 arrived by e-mail and again via the supplier portal (original paid) | `DUPLICATE_INVOICE_SUSPECT`, `DUP_EXACT_INVOICE`, `INVOICE_QTY_EXCEEDS_RECEIVED`, `QTY_INVOICED_EXCEEDS_ACCEPTED` | in_review · owner 000003 |
| S04 | 000019 | Deccan | Over-billed: invoice for 10 NRVs, 8 received (2 refused at the gate); undisputed ₹52,864 paid, ₹13,216 held | `INVOICE_QTY_EXCEEDS_RECEIVED`, `QTY_INVOICED_EXCEEDS_ACCEPTED`, `DELIVERY_SHORTFALL` | on_hold · owner 000004 |
| S05 | 000028 | Maratha | QC rejection: 4 of 50 bearings failed the run test and were returned; replacements awaited, not invoiced | `DELIVERY_SHORTFALL`, `DOC_MISSING_INVOICE` | open · owner 000005 |
| S06 | 000033 | Shakti | Invoice without receipt: 15 pumps billed, nothing has reached the gate | `RECEIPT_EVIDENCE_MISSING`, `INVOICE_QTY_EXCEEDS_RECEIVED`, `DELIVERY_SHORTFALL` | in_review · owner 000006 |
| S07 | 000014 | Kaveri | Paid in full, plus a ₹12,000 bank debit to Kaveri with no invoice reference | `PAY_UNALLOCATED` | in_review · owner 000007 |
| S08 | 000027 | Rathod | Delivery slipped: first batch due 25 days ago, nothing received (liquidated-damages clause) | `DELIVERY_SHORTFALL` | open · owner 000008 |
| S09 | 000012 | Deccan | Short-closed at 16 of 25 butterfly valves with supplier consent; PO line adjusted to 16; 16 billed and paid | none, clean | resolved · owner 000009 |
| S10 | 000006 | Maratha | Clean multi-line: pulleys, bushes and housings | none, clean | resolved · owner 000010 |
| S11 | 000034 | Shakti | First lot only: 3 of 10 pumps in, 7 in transit, not invoiced | `DELIVERY_SHORTFALL`, `DOC_MISSING_INVOICE` | open · owner 000011 |
| **S12** | **000029 (PO-1001)** | **Meridian** | **Flagship (details below)** | `DUPLICATE_INVOICE_SUSPECT`, `INVOICE_QTY_EXCEEDS_RECEIVED`, `QTY_INVOICED_EXCEEDS_ACCEPTED`, `DELIVERY_SHORTFALL` (once the batch is due), `PAY_SPLIT`, `PAY_UNALLOCATED` | open |
| S13 | 000031 (PO-1002) | Meridian | 15 kits received and billed (MPS/26-27/042, ₹17,700), not yet due; a candidate for T03 | none, clean | open |
| S14 | 000022 | Godavari | Price variance: motors billed at ₹44,200 vs PO ₹42,500 (+4%, over the 2% tolerance) | `PRICE_VARIANCE` | in_review |
| S15 | 000009 | Godavari | Split payment: one ₹4,63,150 invoice settled by two RTGS transfers | `PAY_SPLIT` | resolved |
| S16 | 000025 | Aravali | Partial delivery billed in full: 4 of 6 VFD panels received, invoiced for 6; 4 paid | `INVOICE_QTY_EXCEEDS_RECEIVED`, `QTY_INVOICED_EXCEEDS_ACCEPTED`, `DELIVERY_SHORTFALL` | in_review |
| S17 | 000020 | Saurashtra | QC rejection with credit note: 12 flanges rejected and returned; credit note received; AP paid net but never applied it | `INVOICE_QTY_EXCEEDS_RECEIVED`, `QTY_INVOICED_EXCEEDS_ACCEPTED`, `DELIVERY_SHORTFALL`, `DOC_CREDIT_NOTE_PENDING` | in_review |
| S18 | 000032 | Indrayani | GSTIN mismatch: invoice prints the supplier GSTIN with two digits transposed (fails checksum) | `TAX_GSTIN_INVALID` | in_review |
| S19 | 000026 | Shakti | Tax-type error: IGST charged on an intra-state (Pune → Chakan) supply | `TAX_TYPE_MISMATCH` | in_review |
| S20 | 000016 | Kongu | E-way bill missing: ₹2,67,960 inter-state consignment with no e-way bill number | `TAX_EWAYBILL_MISSING` | open |
| S21 | 000021 | Rathod | MSME overdue: micro supplier's invoice unpaid 63 days (past 45) | none, clean (MSME watch shows it overdue) | open |
| S22 | 000024 | Indrayani | MSME overdue: micro supplier on 30-day terms, unpaid 58 days | none, clean (MSME watch) | open |
| S23 | 000030 | Deccan | MSME due soon: small supplier on 30-day terms, due in 4 days | none, clean (MSME watch) | open |
| S24 | 000004 | Kongu | Clean inter-state submersibles, IGST 5%, RTGS | none, clean | resolved |
| S25 | 000007 | Saurashtra | Clean inter-state flanges and elbows, IGST 18% | none, clean | resolved |
| S26 | 000005 | Aravali | Clean inter-state DOL panels | none, clean | resolved |
| S27 | 000011 | Indrayani | Clean local fasteners, paid by cheque | none, clean | resolved |
| S28 | 000001 | Godavari | Clean, large non-MSME supplier on 60-day terms | none, clean | resolved |
| S29 | 000008 | Kaveri | Clean inter-state flameproof motors | none, clean | resolved |
| S30 | 000013 | Deccan | Clean multi-line valves | none, clean | resolved |
| S31 | 000010 (PO-0987) | Meridian | Clean earlier Meridian order (mechanical seals), paid in 34 days | none, clean | resolved |
| S32 | 000018 | Maratha | Clean spherical roller bearings, paid by IMPS | none, clean | resolved |
| S33 | 000002 | Kaveri | Clean inter-state large submersibles | none, clean | resolved |
| S34 | 000035 | Shakti | Just issued 4 days ago, delivery due in 10 days | none, clean | open |
| S35 | 000015 | Indrayani | Clean small order, paid by IMPS the same week | none, clean | resolved |

"Owner 0000NN" marks the owner's original `enrich-demo-orders.mjs` stories (now in `scripts/legacy/`). They have been re-dated into FY 2026-27, with corrected GSTINs and PINs and delivery schedules after the PO date. Other corrections:

- **Single-rate invoices.** Mixed 5%/18% lines were made single-rate, so the HSN rate check stays meaningful.
- **Short-close quantity.** The short-closed line's quantity really is 16.
- **S07 unreferenced payment.** It is ₹12,000, so it is not confused with the flagship's ₹15,000 T03.

### Flagship PO-1001 (S12)

- **Order:** SATYAD/PO/26-27/000029, external ref `PO-1001`. 100 × CP-100 process-pump impeller kit (HSN 8413 91 90, parts of a non-water pump, 18%) at ₹1,000. PO total ₹1,18,000, intra-state CGST/SGST. Balance lot due 20 Nov.
- **Receipts:** GRN 000027 (40 kits) and GRN 000031 (20 kits). QC 000026 accepts all 60.
- **Invoice:** MPS/26-27/041 for 60 kits, ₹60,000 + CGST ₹5,400 + SGST ₹5,400 = **₹70,800**.
- **Settled:** T01 NEFT ₹30,000 and T02 NEFT ₹20,800, both referencing 041. Total settled **₹50,800**.
- **Second AP posting:** the same invoice was re-keyed from the AP export as `MPS-26-27-041`, same date and ₹70,800. Recorded payables are therefore ₹1,41,600 − ₹50,800 = **₹90,800** posting-based open.
- **Receipt-supported outstanding:** ₹70,800 − ₹50,800 = **₹20,000**.
- **T03:** NEFT ₹15,000 with no invoice reference. It is a subject of the PO-1001 case and **₹15,000 stays unallocated**. Candidates: the 041 balance, or MPS/26-27/042 on PO-1002 (₹17,700).

Because the second posting re-keys the number, the exact-duplicate rules do not fire. Satya surfaces it through over-billing instead (120 billed vs 60 received or accepted).

## Data invariants (`validate.js`)

The validator runs before anything is written (`--dry-run` included), after writing (on what is stored) and in `node --test`. Any deviation must be declared by the story's expected codes. It checks:

- **Entity and supplier identity:** GSTIN format, checksum, PAN embedding, state, PAN holder character; PIN ↔ state; Udyam format and state; IFSC; CIN; no `(Unit N)` names; MSME terms ≤ 45 days.
- **Items:** 8-digit HSN; 5% only for 8413 70, otherwise 18%.
- **Engine contract:** every document, line, party, payment, GST block, terms and link is checked against `contracts_v2.py` (`extra="forbid"`).
- **Dates:** no future dates; FY tag matches the date.
- **Numbers:** unique; entity series carry the FY tag; supplier numbers ≤ 16 characters.
- **Chronology:** PO ≤ GRN ≤ QC ≤ invoice ≤ payment; credit note after its invoice; schedule after the PO.
- **Line math:** taxable = qty × rate; CGST = SGST = half rate, intra-state only; IGST inter-state only; CGST + SGST + IGST = tax; line and document totals add up. All in integer paise.
- **Quantities:** received ≤ ordered; accepted + rejected = inspected; returned ≤ rejected; billed ≤ delivered unless declared; invoice rate, HSN and UOM equal the PO's unless declared; PO status agrees with receipts.
- **Payments:** UTR format per mode (NEFT 16, RTGS 22, IMPS 12 characters) and uniqueness; RTGS ≥ ₹2 lakh, IMPS ≤ ₹5 lakh; allocations ≤ invoice open amount, in date order and net of applied credit notes; per-line paid ≤ net billed; SETTLES link for every allocation; bank account is on the supplier master.
- **MSME timing:** micro and small invoices paid within `min(terms, 45)` days unless the story is about lateness.
- **E-way bills:** `gst.ewayBillNo` (12 digits) on every invoice over ₹50,000 except S20.
- **Links and cases:** every link's endpoints exist and are of the right kind within the same case; one PO case per PO; unreferenced payments are case subjects.

## How to run

Every run first validates the dataset, then:

1. Ensures the three demo accounts and their memberships exist; no login is needed.
2. Wipes **only** the demo group's business data: documents, links, cases, findings, decisions, snapshots, jobs, suppliers, items, audit rows, extraction drafts, files and GridFS bytes, the demo company's chat conversations, extra entities and policies.
3. Writes the curated company.
4. Enqueues one `reconcile` job per case.
5. Re-validates what was stored. It exits non-zero on any failure.

Other groups, user passwords and the legacy v1 collections are not touched.

```bash
# local (repo checkout, Mongo on localhost)
cd server
DB_URI=mongodb://localhost:27017 APP_DB_NAME=satya node src/seed/curated.js --dry-run   # validate + show what would be wiped
DB_URI=mongodb://localhost:27017 APP_DB_NAME=satya node src/seed/curated.js             # seed; the running server's job runner reconciles
ENGINE_API_URL=http://localhost:8000 NODE_INTERNAL_TOKEN=… \
DB_URI=mongodb://localhost:27017 APP_DB_NAME=satya node src/seed/curated.js --reconcile-now  # also reconcile in-process

# local docker compose (server container already has DB/engine env)
docker compose exec server node src/seed/curated.js --reconcile-now

# production on Render (API service is a Docker image, WORKDIR /app) — Shell tab or a one-off job
cd /app && node src/seed/curated.js --dry-run
cd /app && node src/seed/curated.js --reconcile-now

# re-check what is stored at any time
node src/seed/validate.js --db

# optional: delete junk tenants left by contract/e2e runs ("Trial Industries", "Bank Flow Ltd",
# "Parent Industries" whose members are all @example.test). They are listed first; add --dry-run to only list.
node src/seed/curated.js --purge-test-groups
```

Flags and environment:

- **Connection:** `DB_URI` or `MONGO_URI`, plus `APP_DB_NAME` (default `satya`).
- **Passwords:** `DEMO_PASSWORD` for newly created accounts. `DEMO_RESET_PASSWORDS=1` re-sets existing ones.
- **`--reconcile-now`:** needs `ENGINE_API_URL` and `NODE_INTERNAL_TOKEN`. Without it, the server's job runner (`src/jobs/runner.js`) picks up the queued jobs within seconds.

On boot with `DEMO_MODE=1`, `src/seedDemoUsers.js` only ensures the demo and contract-test accounts. It never writes v2 business data. The legacy v1 `/internal/demo` fixtures load in the background with a single attempt and an 8-second timeout.

## Known engine and server gaps (as of this dataset)

A reconcile run against the current engine, with `--reconcile-now` on a copy database, raised every expected finding for 34 of 35 stories. It also raised extra findings that come from engine and server gaps, not from the data:

| Gap | Effect on the demo | Owner |
|---|---|---|
| HSN rate master mislabels most Schedule II (18%) rows as 5% | Every 18% invoice gets `TAX_RATE_MISMATCH` | engine (`assets/hsn_master.json.gz` parser) |
| E-way check reads a top-level `ewayBillNo`, which the contract forbids | Every invoice over ₹50,000 gets `TAX_EWAYBILL_MISSING`, not just S20 | engine and server (standardise on `gst.ewayBillNo`) |
| `collectCaseInputs` pulls every document of the PO's supplier | Findings from one PO appear in that supplier's other cases; `recordedPayable` is inflated | server (`services/reconcile.js`) |
| `DUP_PAYMENT` fires on any invoice with two SETTLES links | Legitimate splits (S12, S15) also show "duplicate payment" | engine |
| Ledger counts a QC line's `qty` (inspected) as accepted and ignores `acceptedQty` | S17 lacks `QTY_INVOICED_EXCEEDS_ACCEPTED` (120 inspected, 108 accepted) | engine (`recon/ledger.py`) |
| `DELIVERY_SHORTFALL` ignores the line's `scheduleDate` | S34, issued 4 days ago and not yet due, is called a shortfall | engine |
| Orders list counts only SETTLES links that point at the PO | Paid % shows 0 for every order (payments settle invoices) | server (`routes/v2/compat.js`) |
| Supplier API `view` omits `addresses` | Supplier pages show no address from the API | server (`routes/v2/suppliers.js`) |
