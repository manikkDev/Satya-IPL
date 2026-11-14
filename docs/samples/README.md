# Sample import files (fictional)

All names, GSTINs, UTRs and amounts are made up but consistent with the curated
demo company **Satya Equipment Distribution Pvt Ltd** (GSTIN `27AAKCS4821M1ZW`)
and its suppliers (`server/src/seed/company.js`). Import them in **Import hub**
(`/app/imports`) as the demo user `manager@satya.demo`, in this order:

| # | File | Source | What it shows |
|---|---|---|---|
| 1 | `templates/suppliers.csv` | Suppliers | new supplier (bank account → maker-checker), Godavari gets TDS 194Q + ≥ ₹10 cr turnover, one unchanged, one GSTIN checksum error |
| 2 | `templates/items.csv` | Items | new item, existing items unchanged, bad HSN rejected |
| 3 | `templates/purchase-orders.csv` | Purchase orders | PO for the new supplier → case created and reconciled |
| 4 | `templates/grns.csv` | Goods receipts | GRN + derived QC (2 seals rejected) |
| 5 | `templates/purchase-invoices.csv` | Purchase invoices | bills 20 seals, only 18 accepted → *invoiced exceeds accepted* finding |
| 6 | `templates/debit-credit-notes.csv` | Debit / credit notes | credit note applied to the invoice |
| 7 | `templates/payments.csv` | Payments | payment allocated to the invoice by reference |
| 8 | `tally/tally-daybook-nov-2026.xml` | TallyPrime XML | new supplier ledger, receipt note + purchase + rejection + debit note against PO 000035, a Tally PO, a bill-wise payment; a Sales voucher is skipped |
| 9 | `gst/gstr2b-27AAKCS4821M1ZW-102026.json` | GSTR-2B JSON | Oct 2026: matches (one despite `DVI/2026-27/134` vs `DVI/26-27/0134`), a ₹1,000 tax difference, invoices missing from 2B (incl. a GSTIN typo in the books), entries only in 2B |
| 10 | `bank/hdfc-statement-nov-2026.csv` | Bank statement | HDFC layout auto-detected; 3 exact payments allocated automatically (one net of 194Q TDS once step 1 is in), others left for review; a repeated UTR skipped |
| 11 | `bank/hdfc-cms-mt940-nov-2026.sta` | Bank statement | MT940: 2 automatic allocations, a part payment left for review, a customer receipt |

Re-importing any file is safe: everything already in Satya is reported as
*already in Satya* and skipped.
