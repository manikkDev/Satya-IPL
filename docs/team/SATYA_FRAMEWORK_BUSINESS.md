# Satya — Business Framework (for the team, judges & investors)

> **One line:** Satya tells Indian manufacturing businesses **what they really owe their suppliers, and why** — by checking purchase orders, deliveries, invoices, payments and GST records against each other, flagging costly errors with proof, and recommending the next step.

How to use this document: Part 1 teaches the business world we work in (so no cross-question surprises). Part 2 is the problem and its size. Part 3 is our solution. Part 4 is the business (market, model, money, valuation for the Shark Tank round). Part 5 is the Q&A bank. A glossary is at the end. Every jargon word is explained where it first appears. Numbers marked *(source)* are from the research list in `docs/plan/08_RESEARCH_REFERENCES.md`; numbers marked *(assumption)* are our planning estimates — say so if asked.

Technical details (ML, chatbot, backend) are in `SATYA_FRAMEWORK_TECHNICAL.md`.

---

# Part 1 — How buying works in an Indian company (the supply chain, step by step)

## 1.1 The players
- **Buyer** — our customer. Example: *Vasundhara Industries Group*, a manufacturing group. It has a **parent company** and several **child companies / plants** in different states. Each one has its own **GSTIN** (a 15-character GST registration number — like a PAN for GST), so for tax purposes each is a separate business.
- **Supplier (vendor)** — sells goods to the buyer, often a small business (an **MSME** = Micro, Small or Medium Enterprise, registered on the government's **Udyam** portal).
- **Transporter** — carries the goods.
- **Bank** — moves the money (NEFT/RTGS/IMPS). Every transfer gets a **UTR** (Unique Transaction Reference) number.
- **Government systems** — GST portal (tax returns), **IRP** (Invoice Registration Portal, which registers e-invoices), **e-way bill portal** (permission slip for moving goods), Income-tax (TDS).
- **Auditor / CA** — checks the books.

## 1.2 Who sends what to whom (one order's life)
| # | Document | From → To | What it means | Common problem |
|---|---|---|---|---|
| 1 | **Purchase Requisition (PR)** | Department → Purchase team | "We need 100 pumps" (internal request) | Requests split to dodge approval limits |
| 2 | **RFQ / Quotation** | Buyer asks → Supplier quotes | Price, delivery time, terms | — |
| 3 | **Proforma Invoice (PI)** | **Supplier → Buyer** | A *preview bill / quote*, often used to ask for an **advance**. **Not a tax invoice** — cannot be used to claim GST credit | Advance paid on PI is later forgotten and the full final invoice is paid again |
| 4 | **Purchase Order (PO)** | **Buyer → Supplier** | The official order: items, quantity, price, tax, delivery dates (often in **batches**: 40 now, 60 later), payment terms, inspection, warranty, penalties. Approved internally by the right manager (**Delegation of Authority** = who can approve how much) | PO changed after supply; unapproved PO; price above contract |
| 5 | **Order acknowledgement** | Supplier → Buyer | "We accept your PO" | — |
| 6 | **Advance payment** | Buyer → Supplier (bank) | e.g. 30% before manufacturing | Not adjusted later |
| 7 | **Tax invoice** (and **e-invoice**) | Supplier → Buyer | The real bill. If the supplier's yearly turnover is above the government threshold, the invoice is registered on the IRP, which returns an **IRN** (unique invoice number) and a **digitally signed QR code** *(source)* | Billed for more than delivered; billed twice; wrong GST |
| 8 | **E-way bill** | Supplier/transporter (GST portal) | Needed before moving goods worth over ₹50,000 *(source)* | Missing |
| 9 | **Delivery challan / packing list / LR** | Supplier/transporter → Buyer | What's in the truck | Says 50, only 48 arrive |
| 10 | **GRN (Goods Receipt Note)** | Buyer's stores (internal) | What physically arrived | Not entered → "missing record" |
| 11 | **Quality check (QC)** | Buyer's quality team | Accepted vs rejected quantity | Rejected items still paid |
| 12 | **Return + Debit note / Credit note** | Buyer returns goods; supplier issues credit note | Reduces the amount owed | Credit note never comes, or is used twice |
| 13 | **Invoice booking (Accounts Payable, AP)** | Buyer's accounts team | Typing the invoice into the accounting system and matching it: **2-way** (PO↔invoice), **3-way** (PO↔GRN↔invoice), **4-way** (+QC) | Typing errors, duplicates ("INV-041" vs "INV 041") |
| 14 | **Payment** (+ **TDS**) | Buyer → Supplier (bank) | Can be **full**, **partial**, **split** over several transfers, **combined** (one transfer for many invoices), **net of advance / credit notes / TDS**. A **remittance advice** tells the supplier what the payment covers | Payment without invoice reference; paid twice; paid to a changed (fraudulent) bank account |
| 15 | **GST credit (ITC) cycle** | Supplier files GSTR-1 → buyer sees it in **IMS** and **GSTR-2B** → buyer claims credit in GSTR-3B | Buyer gets back the GST it paid (Input Tax Credit) only if the supplier reported the invoice | Supplier didn't report → credit lost; credit claimed on a duplicate → penalty interest |
| 16 | **Period close / audit** | Accounts ↔ Supplier statement, auditors | Balances confirmed | Differences nobody can explain |

## 1.3 How deliveries and payments really happen
- **Batches**: engineering goods are often delivered in parts as per a **delivery schedule** — so a "partial delivery" is often *normal*, not an error. It becomes a problem only when overdue or when it's billed as complete.
- **Payment terms** examples: "30% advance against PI, 70% within 30 days of acceptance"; "100% within 45 days"; milestone payments for big equipment.
- **TDS (Tax Deducted at Source)**: large buyers (turnover > ₹10 crore) deduct 0.1% income tax on purchases above ₹50 lakh a year from one supplier and pay it to the government *(source)*. So the bank payment is slightly less than the invoice — that looks like a "short payment" if you don't know the rule. From 1 April 2026 this rule is in section 393 of the new Income-tax Act 2025 (earlier s.194Q) *(source)*.
- **MSME 45-day rule**: if the supplier is a micro or small enterprise, the buyer must pay within the agreed time, **never later than 45 days** (15 days if nothing is agreed in writing) *(source)*. Late payment = compound interest at 3× the RBI bank rate, and the buyer **loses the income-tax deduction** for that expense until it pays (section 43B(h)) *(source)*.
- **Rule 37 (180 days)**: if the buyer claimed GST credit but hasn't paid the supplier within 180 days of the invoice, it must reverse that credit with interest *(source)*.

## 1.4 Taxes you must know (simply)
- **GST** is charged on almost all goods. Since 22 September 2025 the main rates are **5% and 18%**, with a **40%** rate for a few luxury/sin goods *(source)*. Most industrial equipment falls at 18%, but the exact rate depends on the item's **HSN code** (a classification number for goods).
- **CGST + SGST** (central + state, split half-half) when supplier and buyer are in the **same state**; **IGST** when they are in **different states**. "Place of supply" decides which.
- **E-invoice**: registered with the government's IRP; gets an IRN + signed QR. From April 2025, businesses with turnover ≥ ₹10 crore must register e-invoices within 30 days *(source)*.
- **LUT (Letter of Undertaking, Form RFD-11)**: lets an exporter (or a supplier to an SEZ) sell **without charging IGST**. It must be filed **every financial year** before such sales *(source)*. Our system checks the LUT is valid for that year before it allows a zero-tax export PI/invoice.
- **Financial year (FY)**: 1 April – 31 March (e.g. FY 2026-27). Invoice numbers must be unique per FY. Year-end causes "cut-off" issues (goods in April, invoice in March).

## 1.5 Parent–child companies
- The parent often negotiates a **rate contract** (fixed prices for a year); plants place **release orders** against it.
- Moving stock between two group companies with different GSTINs is treated as a **sale** for GST — it needs a tax invoice.
- **Intercompany mismatch**: company A records a sale of ₹10 lakh, company B records a purchase of ₹9.5 lakh — the group's combined accounts are wrong until someone finds why.
- Same supplier invoice may get booked in **two** group companies → duplicate payment.

---

# Part 2 — The problem

## 2.1 Refined problem statement
> Indian manufacturing groups buy from thousands of suppliers through documents spread across purchase, stores, quality, accounts, bank and GST systems. These records rarely agree perfectly: deliveries come in parts, invoices get duplicated or mistyped, advances are forgotten, payments are split or unlabelled, GST details mismatch, and deadlines (MSME 45-day, GST 180-day) are missed. Teams reconcile this manually in spreadsheets, which is slow, error-prone and impossible to audit. The result is **overpayments, lost GST credit, interest and tax penalties, supplier disputes and delayed MSME payments.**
> **Satya** reconstructs the true state of every order from all these records, separates harmless differences from costly errors, shows the evidence and confidence behind every issue, refuses to guess when evidence is unclear, and recommends the next step: **Approve, Ask for clarification, Escalate, or Put on hold.**

## 2.2 How money leaks (every scenario to be ready for)
**Duplicates**
1. Same invoice typed twice with small changes ("INV-041", "INV/041", "INV 041", date 1 day off).
2. Supplier sends the invoice by email and courier; both get booked.
3. Paid once by invoice and again from the supplier's statement.
4. Same invoice booked in parent and child company.
5. Advance paid on PI not adjusted against the final invoice.
6. Same supplier exists twice in the master (two vendor codes) → two payments.
7. Same bank transfer imported twice (this one is *not* real money lost — Satya recognises it as the same UTR).

**Quantity & quality**
8. Partial delivery billed as full. 9. Rejected items billed/paid. 10. Over-delivery accepted without approval. 11. Truck paper vs actual count differs. 12. Box vs piece confusion (no agreed pack size).

**Price & charges**
13. Price higher than PO/rate contract. 14. Freight/packing charged though PO said "included". 15. Discount not applied. 16. Unusual price compared to history.

**Payments**
17. Payment without invoice reference (which invoice is it for?). 18. One payment for many invoices — several combinations fit. 19. Overpayment. 20. Payment before goods received. 21. Payment to a changed bank account (invoice-fraud pattern). 22. TDS deducted wrongly.

**GST & compliance**
23. Wrong GST rate for the HSN. 24. IGST instead of CGST+SGST (or opposite) → credit problems. 25. Invoice not in GSTR-2B → credit lost. 26. Credit claimed on a duplicate/rejected invoice → interest up to 24% *(source)*. 27. Missing e-invoice/IRN or QR doesn't match the printed invoice. 28. Missing e-way bill. 29. Rule 37 180-day reversal missed. 30. MSME 45-day breach → interest + tax deduction lost. 31. Export without valid LUT.

**Missing/timing records**
32. Invoice but no GRN (goods never entered). 33. GRN but no invoice. 34. PO changed after supply. 35. Currency mismatch (PO in USD, invoice in EUR). 36. Year-end cut-off.

## 2.3 How big is it
- **₹7.34 lakh crore** is owed to MSMEs in delayed payments (March 2024), more than **4.6% of India's GVA** *(source: GAME–FISME–C2FO)*. Peak was ₹10.7 lakh crore in 2022.
- MSMEs are **30.1% of GDP**, **35.4% of manufacturing** and **45.73% of exports** *(source: PIB)*. Manufacturing is about **16% of GVA** *(source: MoSPI via Lok Sabha)*.
- Companies make **duplicate or wrong payments in 0.8% (best) to 2% (worst) of all disbursements** *(source: APQC)*.
- Careful wording for the pitch: we do **not** say reconciliation errors cause all ₹7.34 lakh crore. We say: *a big share of payment delays start as document disputes — short deliveries, duplicates, mismatched invoices. Resolving them in minutes instead of weeks releases working capital and stops leakage.*

## 2.4 Why existing tools don't solve it (research gap)
| Tool type | What it does | Gap |
|---|---|---|
| Tally / Zoho / ERP | Records entries | Doesn't investigate across PO, GRN, QC, bank and GST together; trusts what's typed |
| GST reconciliation tools | Match GSTR-2B with purchase register | Don't know about deliveries, quality rejections, advances, payments |
| Enterprise suites (SAP Ariba, Coupa) | Full procurement automation | Expensive, months to implement, built for large enterprises |
| AI invoice readers | Extract text from PDFs | Extraction ≠ investigation; no ambiguity handling |
| Spreadsheets + CA | Manual matching | Slow, no audit trail, doesn't scale |
**Research gaps we address:** (1) explainable reconstruction across the *whole* chain, (2) honest handling of ambiguity (most tools force a match), (3) India-specific compliance built into the investigation, (4) affordability for mid-size/MSME groups, (5) evidence that an auditor accepts.

---

# Part 3 — Our solution

## 3.1 What Satya does (modules)
1. **Today dashboard** — what you really owe, amount under question, GST credit at risk, payments due this week, deadlines.
2. **Create PO / PI correctly** — a guided step-by-step form; GST calculated automatically (CGST+SGST vs IGST, HSN rates), approvals routed to the right person, numbered per company and FY, exported as a professional PDF with letterhead, HSN tax summary, terms, stamp/signature images and a **verification QR** so suppliers can check it's genuine.
3. **Documents inbox** — drop any PDF, photo, Excel or GST file. Satya reads it: first by **verifying the e-invoice's signed QR code** (government-signed, so 100% reliable), then the PDF's text, and only if needed with AI vision. Every field shows where it came from; low-confidence fields go to a human.
4. **Order checks (investigations)** — per PO: ordered → received → accepted → invoiced → paid → GST credit, issues with proof and confidence, and the recommended action with exact amounts ("Hold ₹70,800, approve ₹20,000").
5. **Money-trail graph** — an interactive picture of how documents and payments connect, with a time slider to replay what happened.
6. **Payments workbench** — for unclear payments, Satya shows all invoice combinations that fit; a human picks with evidence.
7. **Compliance** — GSTR-2B mismatches, MSME 45-day list, Rule 37, TDS, e-invoice/e-way bill, LUT.
8. **Ask Satya** — chat in plain English: "Why do we owe only ₹20,000 on PO-1001?" Answers come with citations; numbers are filled from records, so the AI can't make them up.
9. **Audit trail** — tamper-evident history of every action; evidence packs for CAs/auditors.

## 3.2 What makes us different (USP)
1. **Evidence or it didn't happen** — every number clickable down to the document line.
2. **"I'm not sure" is an answer** — statistically calibrated ambiguity (conformal prediction) instead of fake confidence; the system lists the candidates and what document would settle it.
3. **Built for India** — GST, e-invoice QR verification, e-way bill, MSME 45-day, TDS, LUT, Indian number formats, parent–child GSTINs.
4. **AI that can't invent money** — numbers come from calculations, not from the chatbot.
5. **Affordable & fast to start** — upload documents or CSV exports from Tally/ERP; no long implementation.

## 3.3 The flagship demo story (memorise)
PO-1001: 100 pumps ordered. Delivered 40 + 20 = 60. Supplier invoice INV-041 for 60 pumps = ₹70,800 — but it was entered **twice** in accounts. Payments: ₹30,000 + ₹20,800 (linked to INV-041) = ₹50,800, plus another ₹15,000 with **no reference**.
- A spreadsheet says you owe **₹90,800** (because of the duplicate).
- Satya says you really owe **₹20,000** (backed by deliveries), **₹70,800** is a likely duplicate → **put on hold**, and the **₹15,000** transfer is **unclear** — it could belong to three invoices, so Satya **asks the supplier for a remittance advice** instead of guessing.

## 3.4 Impact we can promise (and measure in pilots)
- Fewer duplicate/erroneous payments (APQC range 0.8–2% of disbursements is the opportunity).
- Faster dispute resolution → MSME suppliers paid on time → less interest, keep tax deductions (43B(h)).
- Protect GST credit (2B mismatches, Rule 37).
- Hours saved per month of manual reconciliation (pilot KPI).
- Audit-ready evidence.

---

# Part 4 — The business

## 4.1 Target customers
- **Primary:** manufacturing & engineering-goods groups and distributors with turnover roughly ₹20 crore – ₹500 crore (*assumption* for our beachhead), especially those with multiple plants/GSTINs. Clusters: Pune–Chakan, Rajkot, Coimbatore, Ahmedabad, Faridabad.
- **Channel:** **Chartered Accountant (CA) firms** — each serves many SME clients and is trusted; they resell or use Satya for audits.
- **Later:** pharma, construction, FMCG distributors, government suppliers.

## 4.2 Market size (quote with sources & as ranges)
- India accounts-payable automation market: **USD 165 million (2024) → USD 255 million (2030), CAGR 7.4%** (TechSci) up to **USD 1.36 billion (2025) → USD 2.1 billion (2032), CAGR 8.9%** (6Wresearch) depending on scope *(source)*. Say: "Analysts size India's AP automation market between USD 0.17 and 1.4 billion today, growing 7–9% a year."
- Our wedge is broader than AP automation: GST credit protection + MSME compliance + procurement documents.

## 4.3 Business model & pricing *(assumption — validate with 10 customer interviews)*
SaaS subscription per company group, priced by entities (GSTINs) and documents, plus optional success fee.
| Plan | Price (per month, excl. GST) | Includes |
|---|---|---|
| **Sandbox** | Free | Demo data, all features, no real documents |
| **Starter** | ₹2,499 | 1 entity, 3 users, 300 documents/month, PO/PI, investigations, copilot |
| **Growth** | ₹7,999 | 3 entities, 10 users, 2,000 documents, compliance module, payments workbench |
| **Group** | ₹19,999 | up to 10 entities, unlimited users, 8,000 documents, intercompany checks, priority support |
| **CA Partner** | ₹14,999 | manage up to 25 client companies (Starter level each), white-label evidence packs |
| **Enterprise** | Custom | private AI/self-hosting, integrations, SLAs |
Add-ons: extra documents ₹2/document; **Recovery review** (one-time check of last FY's payments) with a success fee on duplicates actually recovered (*assumption:* 10–15%). Annual plans = 2 months free.

## 4.4 Costs & unit economics *(assumptions; show the method)*
- **AI cost per document page** on paid Gemini Flash-Lite: price $0.25 per million input tokens and $1.50 per million output tokens *(source: Google pricing)*. Assume ~1,500 input + 800 output tokens per page → ≈ $0.0016 ≈ **₹0.15 per page** (at ₹88/USD, assumption). E-invoices with verified QR codes need little or no AI.
- **Hosting** (paid tiers once live): roughly ₹15,000–25,000/month for app servers + database + graph at early scale (*assumption*, check current pricing).
- **Gross margin target** > 80% (typical SaaS) once beyond the first few customers.
- **Customer acquisition**: via CA partners (revenue share ~20%, assumption) and industry associations; pilots free for 30 days.

## 4.5 Illustrative projections *(assumption — formulas, not promises)*
| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Paying customers (avg) | 30 | 180 | 600 |
| Avg revenue / customer / month | ₹6,000 | ₹7,500 | ₹9,000 |
| CA partners | 5 | 25 | 80 |
| Subscription ARR | ₹21.6 lakh | ₹1.62 crore | ₹6.48 crore |
Formula: ARR = customers × avg monthly revenue × 12. Partner revenue and recovery fees are upside. Costs Year 1: hosting/AI ~₹3 lakh, legal/compliance ~₹1 lakh, marketing/events ~₹2 lakh, team stipends (founders unpaid initially).

## 4.6 Shark Tank round — valuation & equity (per the FR. CRCE brochure)
Rules: valuation must be **₹2,00,000 – ₹20,00,000**; Sharks together cannot hold **more than 49%** (loss-of-control penalty); judging = Novelty 20%, Business model & scalability 20%, Business knowledge 15%, Sales projection & costing 15%, Pitch 15%, Negotiation 15%; 7-min pitch + 6-min Q&A/negotiation.
**Suggested ask (team to decide):**
- **Opening:** ₹2,00,000 for **10%** equity → valuation **₹20,00,000** (top of the allowed range).
- **Acceptable counter:** ₹2,00,000 for 12.5% → ₹16 lakh valuation.
- **Walk-away floor:** don't go below ₹10 lakh valuation (₹2 lakh for 20%); never exceed **25% total** to Sharks (far from the 49% cap, keeps control).
**Justify the valuation:**
1. Working, deployed product (not a mock-up) + 1st place at IPL hackathon.
2. Cost to rebuild: ~4 people × 3–4 months of full-stack + ML + domain work (*assumption*) ≈ more than the ask at market rates.
3. Large, regulated, painful problem with clear ROI: one avoided ₹70,800 duplicate pays for 2+ years of Starter plan.
4. Capital-light model; CA channel lowers acquisition cost.
**Use of funds (₹2 lakh):** paid AI + hosting for 6 months (₹60k), 3 paid pilots onboarding & travel (₹50k), legal review of privacy/DPA/terms (₹40k), CA association events & marketing (₹30k), buffer (₹20k).
**Negotiation tips:** ask for mentorship/introductions (CA networks, manufacturing clusters) as part of the deal; prefer one strategic Shark over many; if offered more money for more equity, re-anchor on valuation, not on amount.

## 4.7 Go-to-market & scaling
1. 3–5 design-partner pilots (manufacturing groups via mentors/CA contacts) → case studies with measured savings.
2. CA partner program → each CA brings 5–20 clients.
3. Integrations: Tally export import, bank statement formats, GST JSON downloads.
4. New sectors via configuration (rules + document types): pharma → construction → FMCG.
5. Supplier portal (suppliers upload invoices, see why held) → network effect.
6. Embedded finance later: verified, reconciled invoices are ideal for **TReDS** invoice discounting partners (referral revenue) — clearly *later*.

## 4.8 Risks & answers
| Risk | Mitigation |
|---|---|
| Data privacy (financial data) | Company isolation, masked bank details, audit trail, DPDP-aligned policies, AI only under paid/consented settings for real data |
| AI mistakes | AI never decides money; numbers from calculations; human approval; confidence + evidence on everything |
| Competition (GST tools, ERPs) | Whole-chain evidence + ambiguity handling + MSME/GST compliance in one; partner with ERPs rather than replace |
| Adoption by non-tech users | Plain-language UI, CA-assisted onboarding, WhatsApp-friendly summaries (later) |
| Free-tier limits | Paid AI for customers; system keeps working in evidence-only mode even without AI |

---

# Part 5 — Likely questions & strong answers
1. **"Isn't this just Tally / an ERP?"** — ERPs record what you type. Satya checks whether what was typed is *true* against deliveries, quality, bank and GST, and explains differences.
2. **"How is this different from GST reconciliation software?"** — They match your purchase register with GSTR-2B. We also check if goods arrived, were accepted, priced right, paid once, and whether advances/credit notes were adjusted — and tie GST credit risk to real payments (Rule 37, MSME).
3. **"What if the AI is wrong?"** — AI only reads documents and writes sentences. Money is calculated by fixed rules, every number links to proof, and humans approve. When unsure, Satya says "unclear" and lists options.
4. **"Where does your data come from? Is it real?"** — We use real public data where it exists: the **BPI Challenge 2019** real purchase-order event log (60 subsidiaries of a multinational), official **GST HSN and rate tables**, public **GeM** procurement orders, and the **DocILE** real-invoice benchmark for testing extraction. No public dataset contains linked PO+delivery+invoice+bank records with labelled errors, so we built a **calibrated generator** using real distributions to create labelled test cases — and we label it clearly.
5. **"How accurate is it?"** — Our evaluation page reports matching precision/recall, calibration and ambiguity coverage on our test data with limitations. Real-world accuracy will be measured in pilots; we don't claim numbers we haven't measured.
6. **"Why would an MSME pay?"** — One avoided duplicate payment or saved GST credit usually exceeds a year's subscription; MSME suppliers benefit from faster, dispute-free payments.
7. **"What's the moat?"** — India-specific rules + labelled decisions from reviewers improve matching over time (data advantage) + CA distribution + trust (audit trail).
8. **"Who creates the PI — buyer or supplier?"** — The **supplier** issues the proforma invoice; the **buyer** issues the PO. In Satya the buyer records incoming PIs; our distribution arm can create outgoing PIs.
9. **"What is LUT?"** — A yearly undertaking (Form RFD-11) that lets exporters/SEZ suppliers sell without charging IGST.
10. **"Why manufacturing first?"** — Largest MSME share (35.4% of manufacturing), multi-batch deliveries + inspections + advances make it the hardest and most valuable case; ~16% of GVA.
11. **"How do you make money?"** — Monthly SaaS per company group + document volume, CA partner plans, optional success fee on recovered duplicates.
12. **"How will you get customers?"** — CA partners, manufacturing clusters/associations, mentors' networks; free 30-day pilots with a savings report.
13. **"What about data security?"** — Each company's data is isolated, bank numbers are masked and hashed, every action is logged in a tamper-evident chain, and we follow India's DPDP Act requirements.
14. **"Is the e-invoice check real?"** — Yes: the QR on an e-invoice is digitally signed by the government's IRP; we verify that signature using the IRP's published public keys, so those fields are proven authentic.
15. **"Can it handle split and combined payments?"** — Yes; it finds every invoice combination that adds up exactly (including TDS deductions). If only one fits, it suggests it; if many fit, it marks the payment unclear and asks for a remittance advice.
16. **"What happens at scale?"** — Stateless calculation engine, background jobs, database indexes; paid hosting scales horizontally.

---

# Glossary (A–Z)
- **AATO** — Aggregate Annual Turnover (used for GST thresholds).
- **Advance** — money paid before delivery, usually against a PI.
- **AP (Accounts Payable)** — money the company owes suppliers; also the team that handles it.
- **Conformal prediction** — a statistical method that gives a set of possible answers with a guaranteed error rate; we use it to decide when something is "unclear".
- **Credit note / Debit note** — documents that reduce (credit) or increase (debit) the amount of an earlier invoice.
- **DoA (Delegation of Authority)** — rules for who can approve how much.
- **E-invoice / IRN / IRP** — government-registered invoice / its unique number / the portal that registers it.
- **E-way bill** — online permit for moving goods worth over ₹50,000.
- **FY** — Financial Year, April to March.
- **GRN** — Goods Receipt Note; what stores recorded as received.
- **GSTIN** — 15-character GST registration number.
- **GSTR-1 / GSTR-2B / GSTR-3B / IMS** — supplier's sales return / buyer's auto-generated purchase statement / monthly summary return where credit is claimed / Invoice Management System to accept or reject supplier invoices.
- **HSN** — Harmonised System of Nomenclature code classifying goods; decides GST rate.
- **ITC** — Input Tax Credit: GST paid on purchases that can be set off.
- **LUT** — Letter of Undertaking for zero-tax exports.
- **MSME / Udyam** — Micro, Small, Medium Enterprise / government registration portal.
- **PI** — Proforma Invoice (supplier's preview bill; not a tax invoice).
- **PO** — Purchase Order (buyer's official order).
- **QC** — Quality check.
- **Rule 37** — GST rule: reverse credit if supplier not paid within 180 days.
- **TDS** — Tax Deducted at Source.
- **3-way / 4-way match** — checking PO + GRN + invoice (+ QC) agree.
- **UTR** — Unique Transaction Reference of a bank transfer.
