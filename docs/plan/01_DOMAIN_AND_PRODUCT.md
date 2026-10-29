# 01 — Domain & Product: how the Indian procure-to-pay chain works, where money leaks, what Satya must do

This file is the business brain of the plan. Code that contradicts it is a bug. Facts marked **[V]** were verified from a primary/official source in the research pass (see 08 for links). Facts marked **[CFG]** must be configurable per company because they differ by contract or change over time — never hard-code them.

---

## 1. Sector choice and why

### 1.1 Decision
**Phase 1 sector: Industrial engineering goods procurement in Indian manufacturing groups** — buyers are manufacturing companies (often a parent with several plants/child companies, each with its own GSTIN), suppliers are mostly MSMEs selling pumps, motors, valves, bearings, pipes & fittings, electrical panels, cables, tools, spares (MRO = maintenance, repair & operations) and capital equipment. Our demo group also has a distribution arm that *sells* equipment, so it both raises and receives POs/PIs/invoices.

### 1.2 Why this sector (evidence for judges and investors)
| Fact | Value | Source |
|---|---|---|
| Manufacturing share of India's GVA (constant prices, base 2022-23) | 15.69% (2024-25 FRE), 16.10% (2025-26 PE) | Lok Sabha answer, MoSPI data [V] |
| MSME share of GDP | 30.1% (2022-23) | PIB [V] |
| MSME share of manufacturing output | 35.4% | PIB [V] |
| MSME share of exports | 45.73% (2023-24) | PIB [V] |
| Delayed payments owed to MSMEs | ₹7.34 lakh crore (Mar 2024), down from ₹10.7 lakh crore peak (2022); >4.6% of GVA | GAME–FISME–C2FO "Delayed Payments 3.0" [V] |
| Pending on MSME Samadhaan (government-buyer disputes only) | ~₹21,108 crore across ~90,000 applications | Economic Times citing portal [V] |
| Duplicate/erroneous disbursements in AP | 0.8% (top performers) to 2% (bottom performers) of annual disbursements | APQC Open Standards Benchmarking via CFO.com [V] |

Interpretation we use in the pitch (be precise, do not overstate): delayed and disputed payments are a **working-capital** problem of macro size; a large share of disputes start as **document mismatches** (short delivery, rejected quantity still invoiced, duplicate invoice, unadjusted advance, price variance, GST mismatch). We do **not** claim that all ₹7.34 lakh crore is caused by reconciliation errors — we claim that faster, evidence-backed reconciliation shortens dispute cycles and prevents leakage, and we measure it in pilots.

Engineering goods is ideal because orders are **multi-line, multi-batch** (partial deliveries are normal), involve **quality inspection** (accepted ≠ received), **advances against PI** are common for custom equipment, item descriptions vary wildly between buyer and supplier ("CP-100 1kW pump" vs "Centrifugal Pump 1 KW Model CP100"), and most goods are GST-taxable with e-way bills — every hard case in the problem statement appears naturally.

### 1.3 Expansion path (do not build now; keep the data model generic)
Pharma & medical devices (batch/expiry, cold chain) → Construction & infrastructure (RA bills, retention money, BOQ) → FMCG distribution (schemes, claims) → Government suppliers (GeM). Model everything as `documentType + lines + links + policies` so new sectors are configuration + new rules, not a rewrite.

---

## 2. Who's who: the parties

| Party | Role in the chain | In Satya |
|---|---|---|
| **Group / Parent company** | Owns several legal entities; often negotiates rate contracts centrally | `Group` |
| **Entity / Child company / Plant** | A separate legal entity or GST registration (distinct person under GST even if same PAN in another state) | `Entity` (has GSTIN, state, addresses, CIN, PAN) |
| **Department / cost centre** | Raises the need (maintenance, production, projects) | `costCentre` on PR/PO |
| **Supplier / Vendor** | Sells goods; may be micro/small/medium (Udyam registered) | `Supplier` master (GSTIN(s), PAN, Udyam no. + category, bank accounts, MSME flag) |
| **Transporter** | Moves goods; issues LR (lorry receipt); part of e-way bill | Captured on dispatch documents |
| **Bank** | Executes NEFT/RTGS/IMPS; produces UTR | Payment records from bank statement/ERP export |
| **GST system (GSTN/IRP/E-way bill portal)** | Registers e-invoices (IRN + signed QR), e-way bills, collects returns (GSTR-1, GSTR-2B, IMS, GSTR-3B) | Imported as evidence; never "filed" by Satya |
| **Income-tax system** | TDS on purchase of goods (s.194Q of IT Act 1961 → s.393 of IT Act 2025 from 1 Apr 2026) | TDS records/ledger |
| **Auditor / CA** | Verifies books, balance confirmations | Read-only `auditor` role |

## 3. The document chain, step by step (buyer = our customer)

Read this as a story of one order. Each step lists the document, who sends it to whom, what it proves, and what can go wrong.

### Step 0 — Masters (before any order)
- **Supplier master**: legal name, trade name, GSTIN per state, PAN, Udyam registration number and category (micro/small/medium), bank account(s) with IFSC, payment terms, MSME status. *Leaks:* duplicate vendors (same PAN/GSTIN/bank under two codes), fraudulent bank-account change.
- **Item master**: item code, description, technical specs (power, size, pressure rating), **HSN code**, UOM (unit of quantity), GST rate effective dates. *Leaks:* same item under different codes → price comparison impossible; wrong HSN → wrong GST.
- **Rate contracts / blanket POs**: agreed prices for a period, sometimes negotiated by the parent for all plants.

### Step 1 — Purchase Requisition (PR) — internal
Department → Procurement. "We need 100 pumps by 15 Nov." Has budget/cost centre. *Leaks:* split PRs to stay under approval limits.

### Step 2 — RFQ and Quotation
Procurement → Suppliers (RFQ); Suppliers → Procurement (Quotation with price, taxes, delivery period, payment terms, validity). Comparative statement chooses the supplier.

### Step 3 — Proforma Invoice (PI) — **issued by the supplier (seller)**
Supplier → Buyer. A PI is a **commercial quote/advance-request document, not a tax invoice**: it is not a GST supply document and cannot be used to claim input tax credit. Used when the supplier wants an **advance** (common for custom engineering goods) or for the buyer's internal approval/import LC. *Leaks:* advance paid against PI is **not adjusted** when the final tax invoice arrives (buyer pays full invoice again) — a classic duplicate-payment cause; PI amount ≠ final invoice amount.
> In Satya: buyer **records an incoming PI**; our distribution arm can also **create an outgoing PI** for its customers (seller side).

### Step 4 — Purchase Order (PO) — **issued by the buyer**
Buyer → Supplier. The legal offer: item lines (description, specs, HSN, qty, UOM, rate, discount), delivery schedule (often **multiple batches**: 40 by 5 Nov, 60 by 20 Nov), delivery terms (Ex-works / FOR destination), freight/packing/insurance, payment terms (e.g., 30% advance against PI, 70% within 30 days of acceptance), inspection terms, warranty, penalty/LD clause, taxes, billing & shipping GSTIN/addresses, PO number and date. Approved per **Delegation of Authority (DoA)** matrix (e.g., < ₹1 lakh manager, < ₹10 lakh plant head, above → CFO). *Leaks:* PO amended after supplier shipped; unapproved PO; rate above rate contract.
- **PO Amendment** (revision R1, R2…): changes qty/price/date. Must keep history; invoices must be checked against the revision valid when goods were supplied.
- **Release order / call-off** against a blanket PO or rate contract.
- **Short-close**: buyer closes the remaining quantity (no more deliveries expected) — open quantity must not be treated as "pending".

### Step 5 — Order Acknowledgement
Supplier → Buyer: accepts PO (or counter-proposes). Optional but valuable evidence.

### Step 6 — Advance payment (if terms say so)
Buyer → Supplier via NEFT/RTGS against the PI. Recorded with **UTR** (Unique Transaction Reference). Under GST, advance for goods does not trigger GST on the supplier. *Leaks:* advance recorded against wrong PO; not adjusted later.

### Step 7 — Dispatch documents (per batch) — **issued by the supplier**
- **Tax Invoice**: the GST supply document (Rule 46 fields: supplier & recipient GSTIN, invoice number unique per financial year (max 16 chars), date, HSN, description, qty, UOM, taxable value, rate, CGST+SGST or IGST, place of supply, signature). If the supplier's aggregate annual turnover (AATO) exceeds the e-invoicing threshold (₹5 crore since 1 Aug 2023), the invoice must be reported to an **IRP**, which returns an **IRN** (64-char SHA-256 hash) and a **digitally signed QR code** [V]. From 1 Apr 2025, taxpayers with AATO ≥ ₹10 crore cannot report e-invoices older than 30 days [V]. IRN can be cancelled within 24 hours [V].
- **E-way bill**: required before movement when consignment value exceeds ₹50,000 [V]; validity 1 day per 200 km (normal cargo) [V].
- **Delivery challan / packing list**: what is in the truck (used also for non-supply movements: job work, returns, same-GSTIN branch transfers).
- **LR / transporter docket**.
*Leaks:* invoice raised for full PO quantity although only one batch shipped; invoice quantity ≠ challan quantity; e-invoice missing or QR data ≠ printed invoice; one invoice for two batches or two invoices for one batch.

### Step 8 — Gate entry and Goods Receipt Note (GRN) — **issued by buyer's stores**
Stores record what physically arrived: qty received per line, batch, date, vehicle no., against which PO/challan. *Leaks:* GRN not entered (omitted record) → invoice blocked or paid without proof; GRN against wrong PO line; GRN posted twice.

### Step 9 — Quality Inspection (QC) — buyer's quality team
Accepted qty vs rejected qty with reason. Only **accepted** qty is payable under most contracts ("4-way match": PO–GRN–QC–Invoice). Rejected goods go back with a **return delivery challan**; buyer raises a **debit note** (commercial) and/or supplier issues a **credit note** (GST credit note, section 34; time limit 30 Nov following FY end). *Leaks:* rejected qty still paid; credit note never received; credit note applied twice.

### Step 10 — Invoice booking in Accounts Payable (AP)
AP clerk enters the supplier invoice in the ERP (often by retyping the PDF) and matches: **2-way** (PO↔invoice, services), **3-way** (PO↔GRN↔invoice), **4-way** (+QC). Price and quantity tolerances apply [CFG] (e.g., price ±0.5% or ±₹100; qty ±0 for counted items, ±2% for bulk by weight). *Leaks:* typing errors; same invoice keyed twice with formatting variation ("INV-041" vs "INV/041" vs "INV 041"); invoice booked in parent and child entity; freight/packing charged without PO basis; GST rate or type wrong.

### Step 11 — Payment
Treasury proposes payment by due date, deducts **TDS** where applicable (0.1% on purchases of goods above ₹50 lakh from a seller in a year, if buyer's turnover > ₹10 crore in preceding year [V]; under IT Act 2025 the provision lives in s.393 from 1 Apr 2026 [V]), pays via NEFT/RTGS/IMPS. Payments can be **partial**, **split across transfers**, **one transfer for many invoices**, or **net of advances/credit notes/TDS**. A **remittance advice** tells the supplier what the payment covers. *Leaks:* payment without invoice reference (unallocated); same invoice paid twice (by invoice and again by statement); overpayment; payment to changed bank account (fraud); TDS deducted wrongly → amount mismatch looks like short payment.

### Step 12 — GST input tax credit (ITC) cycle (monthly)
Supplier reports the invoice in GSTR-1 → it appears in the buyer's **IMS** (Invoice Management System, live since 14 Oct 2024) where buyer can **accept / reject / keep pending**; no action = deemed accepted [V] → flows to **GSTR-2B** → buyer claims ITC in **GSTR-3B**. Conditions: invoice must be in GSTR-2B (s.16(2)(aa)), goods received, tax paid by supplier, return filed; time limit s.16(4). If the buyer does not pay the supplier (value + tax) within **180 days** of invoice date, ITC must be reversed proportionately with interest (Rule 37) and can be re-availed after payment [V]. *Leaks:* invoice paid but not in 2B (supplier didn't report) → ITC lost; ITC claimed on rejected/duplicate invoice → interest up to 24% p.a. on wrongly availed & utilised ITC (s.50(3)) [V]; Rule 37 reversal missed.

### Step 13 — MSME payment discipline
For suppliers that are micro/small enterprises: payment due by the agreed date, **never later than 45 days** from acceptance (or deemed acceptance); without a written agreement, within 15 days (MSMED Act s.15) [V]. Late payment carries **compound interest at 3× the RBI bank rate** (s.16) [V], and from AY 2024-25 the buyer **cannot deduct the expense for income-tax** until actually paid (IT Act 1961 s.43B(h)) [V]. Buyers must report dues > 45 days in MSME-1. *Satya value:* a deadline engine that knows which suppliers are micro/small and which invoices are about to breach 45 days — combined with the reconciliation status (you cannot pay what is disputed, so disputes must be resolved fast).

### Step 14 — Period close and audit
Supplier statement of account vs buyer ledger reconciliation, balance confirmations, fiscal year-end (31 March) cut-off (goods received in April against March invoices), audit trail.

### 3.1 Intra-group (parent–child) flows
- Parent negotiates **rate contract**; children issue release orders.
- **Stock transfer between entities with different GSTINs is a taxable supply** (even without consideration, Schedule I) → needs a tax invoice; the receiving entity books a purchase. Same-GSTIN branch movements use delivery challans.
- **Intercompany reconciliation**: entity A's sales invoice must equal entity B's purchase booking (amount, GST, date). Mismatches distort consolidated accounts — Satya should flag them (P3 feature).
- Shared services: parent pays on behalf of child → cross charges.

### 3.2 Exports & SEZ (relevant to our distribution arm)
Zero-rated supplies (exports, SEZ) can be made **without paying IGST under a Letter of Undertaking (LUT, Form GST RFD-11)**, filed per financial year before such supplies [V]; otherwise pay IGST and claim refund. Invoices must carry the endorsement for supply under LUT. Satya must: store LUT reference + FY validity per entity; when an export/SEZ PI/invoice is created without IGST, require a valid LUT; warn if FY changed. Foreign currency invoices need an exchange-rate source (store the rate and its source as evidence; never invent).

### 3.3 Fiscal calendar and numbering
- Indian financial year: 1 April – 31 March ("FY 2026-27"). Tax-year terminology under IT Act 2025.
- Document numbers must be unique per FY per series; Satya numbering format default: `<ENTITYCODE>/<DOCTYPE>/<FY>/<SEQ>` e.g. `VPPL/PO/26-27/000123` [CFG]; GST invoice numbers (for outgoing tax invoices) must be ≤ 16 characters (Rule 46) → offer a compact series for invoices.
- Dates displayed `DD MMM YYYY`, time in IST; stored ISO-8601 with offset.

### 3.4 GST computation essentials (for the tax engine, details in 03)
- Intra-state supply (supplier state = place of supply state) → CGST + SGST (rate split equally). Inter-state → IGST. Union territories without legislature → CGST + UTGST.
- Since 22 Sep 2025 the main slabs are **5% (merit) and 18% (standard)** with a **40% special rate** for select goods; special low rates (e.g., 0.25%, 3%) exist for specific goods [V]. Rates are per HSN and **date-effective** → the HSN master stores `rate`, `effectiveFrom`, `effectiveTo`, `notificationRef`. Agents must load rates from the official CBIC/GST portal source, never type them from memory.
- HSN digits on invoices: 4 digits for AATO up to ₹5 crore, 6 digits above ₹5 crore [CFG + V in 08].
- Round-off: invoice total rounded to nearest rupee is common; show as a separate "Round off" line.
- Amount in words using Indian numbering (lakh, crore).
- Reverse charge (RCM) supplies: buyer pays GST; supported as a flag.

---

## 4. The error taxonomy — what Satya must detect

Every detector produces a `Finding` with: `code`, `title` (plain language), `severity` (`info|low|medium|high|critical`), `certainty` (see §5), `exposure` (₹ at risk, may be a range `{min,max}`), `evidence[]`, `explanation` (plain language), `calculation` (step list), `recommendedAction` (Approve/Clarify/Escalate/Hold), `whatResolvesIt` (the document or decision that would settle it), `detector` (`rule|ml|hybrid`) and `version`.

**Harmless vs costly** is decided by the **materiality policy** [CFG]: a variance within tolerance → `info` + "harmless variance" label; above tolerance → severity scaled by exposure and certainty. `riskScore = exposureMid × certaintyWeight` where weights CONFIRMED 1.0, PROBABLE 0.75, POSSIBLE 0.4, AMBIGUOUS 0.5 (unknown which side), INSUFFICIENT_EVIDENCE 0.25.

| Code | What happens (plain words) | Detection (rule/ML) | Default action |
|---|---|---|---|
| **QTY_PARTIAL_DELIVERY** | Only part of the order arrived | rule: received < ordered and not short-closed; overdue if past schedule date | Approve received part / info if within schedule |
| **QTY_OVER_DELIVERY** | More arrived than ordered | rule | Clarify |
| **QTY_INVOICED_EXCEEDS_RECEIVED** | Billed for more than arrived | rule (per line, after UOM conversion) | Hold excess |
| **QTY_INVOICED_EXCEEDS_ACCEPTED** | Billed for rejected goods | rule (4-way) | Hold excess, request credit note |
| **QTY_CHALLAN_VS_GRN** | Truck paper says 50, stores counted 48 | rule | Clarify with transporter/supplier |
| **QTY_UOM_UNKNOWN_CONVERSION** | PO in boxes, invoice in pieces, no approved pack size | rule → INSUFFICIENT_EVIDENCE | Clarify |
| **PRICE_VARIANCE** | Unit price ≠ PO/rate contract beyond tolerance | rule | Clarify / Hold excess |
| **PRICE_UNAUTHORISED_CHARGES** | Freight/packing/other charges not in PO terms | rule | Clarify |
| **PRICE_ANOMALY** | Price unusual vs history for same item/HSN | ML (robust z / isolation forest) | Escalate (review), never auto-hold |
| **DUP_EXACT_INVOICE** | Same supplier + same invoice no. + same amount posted twice | rule | Hold duplicate |
| **DUP_NEAR_INVOICE** | Same invoice keyed with formatting/amount/date variations | hybrid (normalised ref + ML similarity + conformal set) | Hold (PROBABLE) / Clarify (POSSIBLE) |
| **DUP_CROSS_ENTITY** | Same supplier invoice booked in two group entities | rule on supplier GSTIN + invoice no. + FY across entities | Escalate |
| **DUP_ADVANCE_NOT_ADJUSTED** | Advance paid on PI, final invoice paid in full again | rule (PI/advance ledger vs invoice payments) | Hold, adjust advance |
| **DUP_PAYMENT** | Same invoice paid twice (two different UTRs) | rule + allocation | Escalate, recover |
| **DUP_REPEATED_OBSERVATION** | Same UTR imported twice (not new cash) | rule (UTR identity) | info (dedupe) |
| **DUP_VENDOR_MASTER** | Same supplier exists under two codes | ML (Fellegi–Sunter on name/PAN/GSTIN/bank/address) | Escalate (master data fix) |
| **PAY_UNALLOCATED** | Money sent without a usable invoice reference | rule → AMBIGUOUS with candidate invoices (subset-sum) | Clarify (ask remittance advice) |
| **PAY_SPLIT** | One invoice paid in several transfers | rule/allocation | info if sums correctly |
| **PAY_COMBINED** | One transfer pays several invoices | allocation (subset-sum, unique solution required to be PROBABLE) | info / Clarify if multiple solutions |
| **PAY_OVERPAYMENT** | Paid more than supported liability | rule | Escalate, recover |
| **PAY_BEFORE_RECEIPT** | Paid (non-advance) before goods received/accepted | rule | Escalate (control breach) |
| **PAY_BANK_ACCOUNT_CHANGED** | Paid to an account different from master / recently changed | rule (+ maker-checker log) | Hold (fraud risk) |
| **PAY_TDS_MISMATCH** | TDS deducted where not applicable, wrong rate, or not deducted | rule (thresholds by FY, buyer turnover flag) | Clarify |
| **TAX_RATE_MISMATCH** | GST rate on invoice ≠ HSN master rate effective on invoice date | rule | Clarify |
| **TAX_TYPE_MISMATCH** | IGST charged on intra-state (or CGST/SGST on inter-state) | rule (place of supply) | Clarify (ITC risk) |
| **TAX_ARITHMETIC** | Line totals/tax/round-off don't add up | rule | Clarify |
| **TAX_GSTIN_INVALID** | GSTIN fails checksum / state code mismatch with address | rule (mod-36 checksum) | Hold |
| **TAX_NOT_IN_GSTR2B** | Invoice not reflected in GSTR-2B/IMS for the period | rule (2B import) | Clarify supplier; ITC at risk |
| **TAX_IMS_REJECTED_BUT_PAID** | Rejected in IMS but paid | rule | Escalate |
| **TAX_RULE37_RISK** | Unpaid invoice approaching/over 180 days with ITC claimed | rule (deadline engine) | Escalate |
| **TAX_EINVOICE_MISSING** | Supplier above threshold but no IRN/QR | rule (needs supplier AATO flag; else INSUFFICIENT_EVIDENCE) | Clarify |
| **TAX_QR_MISMATCH** | Signed QR fields ≠ printed invoice fields | rule (JWS verified QR vs extracted) | Hold |
| **TAX_EWAYBILL_MISSING** | Consignment > ₹50,000 moved without e-way bill number | rule | Clarify |
| **TAX_LUT_MISSING** | Zero-rated export/SEZ invoice without valid FY LUT | rule | Hold (seller side) |
| **MSME_45DAY_RISK** | Micro/small supplier payment approaching/over 45 days | rule (deadline engine) | Escalate (pay or resolve dispute) |
| **DOC_MISSING_GRN** | Invoice exists, no goods receipt recorded | rule → INSUFFICIENT_EVIDENCE (not proof of non-delivery) | Clarify stores |
| **DOC_MISSING_INVOICE** | Goods received long ago, no invoice | rule | info / Clarify supplier |
| **DOC_INVOICE_BEFORE_GRN** | Invoice dated before goods arrived | rule (normal for some flows) | info unless GR-based invoicing required |
| **DOC_PO_AMENDED_AFTER_SUPPLY** | PO revised after goods/invoice | rule (revision timeline) | Escalate |
| **DOC_CURRENCY_MISMATCH** | PO in USD, invoice in EUR, no agreed rate | rule → INSUFFICIENT_EVIDENCE | Clarify |
| **DOC_FY_CUTOFF** | Invoice and receipt in different financial years | rule | info (accrual check) |
| **DOC_CREDIT_NOTE_PENDING** | Rejection/return without credit note | rule | Clarify |
| **IC_MISMATCH** | Intercompany: A's sale ≠ B's purchase | rule across entities | Escalate (P3) |
| **MASTER_NAME_VARIANT** | Same supplier, different spellings | ML | info (link) |

The **flagship demo case (PO-1001)** must still produce exactly: 100 ordered, 60 received (40+20), 60 accepted, duplicate posting of INV-041 (₹70,800) flagged DUP_NEAR_INVOICE (PROBABLE), split payments T01 ₹30,000 + T02 ₹20,800 = ₹50,800 settled, T03 ₹15,000 PAY_UNALLOCATED (AMBIGUOUS between INV-041/INV-042/AP-992), delivery-supported outstanding ₹20,000, recorded AP ₹90,800. These numbers are regression fixtures.

## 5. Certainty classes (used everywhere)

| Class | Meaning | Typical basis |
|---|---|---|
| **CONFIRMED** | Proven by an exact reference or a human decision | exact PO/invoice reference, verified IRN QR, reviewer confirmation |
| **PROBABLE** | Strong evidence, one candidate; conformal set size 1 with calibrated p ≥ 0.9 [CFG] | normalised reference + amount + date fit |
| **POSSIBLE** | Some evidence, one candidate, below PROBABLE | fuzzy description match only |
| **AMBIGUOUS** | Two or more candidates fit; the system will not choose | conformal set size ≥ 2, multiple subset-sum solutions |
| **INSUFFICIENT_EVIDENCE** | A needed document/field is missing | no GRN, unknown pack conversion, no FX rate |

UI must show certainty as words + icon + colour (never colour alone), with a "Why?" popover listing evidence and "What would settle this?".

## 6. Recommendation logic (Approve / Request Clarification / Escalate / Place on Hold)

Per invoice (and per case), compute from its findings:
1. Any `critical` or any `high` with certainty ≥ PROBABLE → **Place on Hold** (scope: the affected amount, not necessarily the whole invoice — show "Hold ₹X, approve ₹Y").
2. Any AMBIGUOUS/INSUFFICIENT_EVIDENCE that blocks the balance → **Request Clarification** (with the exact question to send and to whom; copilot can draft the email; nothing is sent automatically).
3. Control breaches (pay-before-receipt, bank change, cross-entity duplicate, IMS-rejected-but-paid, Rule 37 / MSME breach) → **Escalate** to the configured role.
4. Otherwise and within tolerance → **Approve** (eligible amount = delivery/acceptance-supported, net of advances, credit notes, TDS).
Each recommendation states: scope, amount, prerequisites, who can act (role), and the evidence. Recommendation ≠ decision: a human records the decision (with reason); maker-checker enforced.

## 7. Personas (design for these people)

1. **Rakesh, owner/MD of a ₹60 crore manufacturing group** — non-technical; wants "how much do we really owe, what's stuck, what's at risk this week". Uses dashboard + copilot on mobile.
2. **Priya, AP manager / finance controller** — reviews holds, approves payments, answers auditors. Power user of investigations.
3. **Sanjay, purchase officer** — creates POs/amendments, chases suppliers. Uses PO wizard, supplier view.
4. **Meena, stores/QC** — enters GRN and inspection results on a tablet.
5. **CA Anil, external auditor / consultant** — read-only, exports evidence packs; serves many SME clients (our channel partner persona).
6. **Supplier contact (phase 2)** — sees PO status, uploads invoice/PI, sees why payment is held.

## 8. Roles & permissions (RBAC) — authoritative matrix

Roles are assigned per entity (a user can be `buyer` in Entity A and `auditor` in Entity B). `group_admin` applies to all entities of the group.

| Permission ↓ / Role → | platform_admin | group_admin | entity_admin | requester | buyer | stores | quality | ap_clerk | ap_manager | treasury | auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Manage group/entities/users | ✔ | ✔ | own entity | | | | | | | | |
| Configure policies (tolerance, DoA, numbering, letterhead) | | ✔ | ✔ | | | | | | | | |
| Raise PR | | | | ✔ | ✔ | | | | | | |
| Create/amend PO, record/create PI | | | | | ✔ | | | | | | |
| Approve PO (per DoA) | | ✔ | ✔ | | | | | | ✔ | | |
| Record GRN | | | | | | ✔ | | | | | |
| Record QC | | | | | | | ✔ | | | | |
| Upload/confirm invoices & docs | | | | | ✔ | ✔ | | ✔ | ✔ | | |
| Import payments / bank / GSTR-2B | | | | | | | | ✔ | ✔ | ✔ | |
| Decide findings (approve/hold/confirm duplicate/allocate) | | | | | | | | | ✔ | | |
| Release payment proposal | | | | | | | | | ✔ (maker) | ✔ (checker) | |
| Change supplier bank account | | maker | maker | | | | | | checker | checker | |
| Read everything in scope | ✔ | ✔ | ✔ | own PRs | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Export evidence packs | | ✔ | ✔ | | | | | | ✔ | | ✔ |
| Use copilot | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

Segregation of duties (enforced server-side): creator of a PO ≠ its approver; GRN recorder ≠ invoice approver for the same PO; maker ≠ checker for payment release and bank changes; a user cannot decide a finding on a document they created. Every denial returns a clear reason ("You created this PO, so another approver must approve it").

## 9. Product modules (what we ship)

1. **Home ("Today")** — money at risk, holds, deadlines (MSME 45-day, Rule 37 180-day, e-invoice 30-day), approvals waiting, ITC at risk.
2. **Purchase Orders** — list, PO wizard, amendments, release orders, PDF/CSV export, lifecycle timeline per line (ordered/received/accepted/invoiced/paid).
3. **Documents inbox** — drag & drop any file (PDF, image, CSV, Excel, e-invoice JSON), automatic classification + extraction + validation, human review of low-confidence fields, then commit as evidence.
4. **Investigations** — auto-created per PO (and per supplier/period); summary, money-trail graph, timeline replay, documents, calculations, alternatives, decisions, what-if.
5. **Suppliers** — 360° view: open POs, deliveries, invoices, payments, disputes, MSME status, duplicate-vendor alerts, statement reconciliation.
6. **Payments** — bank import, allocation workbench (ambiguous payments resolved by humans), payment proposal with eligible amounts.
7. **Compliance** — GSTR-2B/IMS reconciliation, ITC at risk, Rule 37, MSME 45-day & 43B(h) exposure, TDS checks, e-invoice/e-way bill checks, LUT validity.
8. **Ask Satya (copilot)** — full page + context drawer on every page.
9. **Reports & evidence packs** — PDF/CSV exports for auditors.
10. **Settings** — group & entities, users & roles, DoA matrix, tolerances, numbering series, letterhead/stamp/signature images, terms templates, HSN/items/suppliers masters, integrations, AI usage & data policy.
11. **Public site** — landing, product, pricing, research (papers, datasets, evaluation), security, legal pages, contact.
