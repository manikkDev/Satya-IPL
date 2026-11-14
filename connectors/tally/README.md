# Satya ↔ TallyPrime

Two ways to bring Tally data into Satya. Both end in the same import pipeline
(preview → commit, duplicates skipped, automatic checks afterwards).

| | Manual export | Connector (automatic) |
|---|---|---|
| Setup | none | Node.js 18+ on the Tally PC, one API key |
| How | Export XML from Tally, drop it on **Import hub → TallyPrime XML** | `satya-tally-connector.mjs` pulls from Tally on `localhost:9000` and pushes to Satya |
| Good for | first load, occasional catch-up | daily sync |

## What Satya reads from Tally

| Tally | Satya |
|---|---|
| Ledger under *Sundry Creditors* (GSTIN, PAN, credit period, MSME/Udyam details, address, e-mail) | Supplier (matched by GSTIN, then PAN, then name — existing suppliers only get blank fields filled) |
| Stock item (part no. / mailing name, HSN, GST rate, base unit) | Item |
| **Purchase Order** voucher | PO (status *issued*) |
| **Receipt Note** | GRN — `ORDERNO` in batch allocation links it to the PO |
| **Purchase** (or any type whose parent is Purchase) | Purchase invoice — supplier invoice no. = `Reference`, invoice date = `Reference date`; `ORDERNO`/`TRACKINGNUMBER` link PO and GRN |
| **Rejections Out** | Return to supplier |
| **Debit Note** | Debit note, applied to the bill named in bill-wise details (*Agst Ref*) |
| **Payment** | Supplier payment — bill-wise *Agst Ref* lines become allocations; UTR/cheque from the bank allocation |
| Sales, Receipt, Journal, Contra, … | skipped (counted in the preview) |

Cancelled and optional vouchers are skipped. Custom voucher types are resolved
through their parent type when the export contains the voucher-type masters,
otherwise by name. References to documents not yet in Satya (a receipt note
whose PO was never imported) are kept and linked automatically when the
missing document arrives.

## Option 1 — export by hand

1. Open the company in TallyPrime.
2. **Masters** (first load, then after master changes): *Alt+E (Export) → Masters → All Masters*,
   format **XML (Data Interchange)**, *Export*.
3. **Vouchers**: open *Day Book* (*Alt+G → Day Book*), set the period with *F2*,
   then *Alt+E → Current*, format **XML (Data Interchange)**, *Export*.
4. In Satya: **Import hub → TallyPrime XML**, drop the file, check the preview, **Import**.

Tally writes UTF-16 XML by default; Satya reads it as is.

## Option 2 — the connector

### 1. Enable Tally's HTTP interface (once)
*F1 (Help) → Settings → Connectivity → Client/Server configuration*:
set **TallyPrime acts as** = *Server* (or *Both*) and **Port** = `9000`.
Keep the company open while the connector runs. Leave port 9000 closed on the
firewall — the connector talks to Tally on `localhost` and only makes
outbound HTTPS calls to Satya.

### 2. Create an import key in Satya (once)
**Import hub → Connector keys → New key**. Copy the `satk_…` key — it is
shown once. A key can only push files into the import pipeline of one
company entity; it cannot read your data or approve anything. Revoke it from
the same screen.

### 3. Run
```bash
# Windows (PowerShell)
$env:SATYA_URL="https://satya-api.example.in"
$env:SATYA_API_KEY="satk_…"
node satya-tally-connector.mjs --days 7 --commit

# preview only (nothing written in Satya) — check the counts first
node satya-tally-connector.mjs --days 7

# exact period, a named company, or a file you exported by hand
node satya-tally-connector.mjs --from 2026-11-01 --to 2026-11-14 --company "Satya Equipment Distribution Pvt Ltd" --commit
node satya-tally-connector.mjs --file DayBook.xml --commit
```
Flags: `--tally-url` (default `http://localhost:9000`), `--chunk-days 7`,
`--no-masters`, `--dry-run` (talk to Tally only), `--config connector.json`
(`{"satyaUrl","apiKey","tallyUrl","company"}`), `--state` (where the last
synced date is remembered; the next run without `--from/--days` continues
from there).

### 4. Schedule (optional)
Windows Task Scheduler → *Create Basic Task* → daily →
*Start a program*: `node`, arguments `C:\satya\satya-tally-connector.mjs --commit --config C:\satya\connector.json`,
*Start in*: `C:\satya`.

Re-running over the same days is safe: every voucher is de-duplicated
(supplier + number + financial year; payments by UTR).

## Notes and limits
* The connector uses Tally's standard *Export Data* requests (`Day Book`,
  `List of Accounts`). Tally versions and TDL customisations differ — if a
  request returns no vouchers, export by hand once and compare.
* Satya does not write back to Tally.
* Each push is limited to 10 MB; the connector splits vouchers into 7-day
  chunks (`--chunk-days` to change).
* TDS on Tally payments is read from a ledger named like *TDS …*; the payment
  amount stored is the bank amount, bill-wise allocations keep Tally's figures.
