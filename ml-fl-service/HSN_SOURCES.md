# HSN master sources and outstanding verification

No real HSN directory or rate master has been committed. Tests use explicitly
artificial rates; those tests do not verify any real notification or rate change.
Until official sources are ingested, rate lookup returns `None`.

## Primary sources checked on 2026-10-29

- GSTN instructions:
  https://tutorial.gst.gov.in/userguide/taxpayersdashboard/Search_HSN_SAC_Tax_Rates.htm
  instruct downloading the HSN Directory in Excel Format from Services > User
  Services > Search HSN Code.
- Directory page: https://services.gst.gov.in/services/searchhsnsac
  returned HTTP 403 from the engine container.
- Government notification FAQ:
  https://www.pib.gov.in/PressReleasePage.aspx?PRID=2168426
  identifies Notification 9/2025-Central Tax (Rate), dated 17 September 2025,
  and links to https://taxinformation.cbic.gov.in/view-pdf/1010436/ENG/Notifications.
  Container access to that PDF failed certificate-chain verification.

TLS verification was not disabled. No tax rates were inferred from search
snippets or typed from memory.

## Build from a manually downloaded directory

Place primary files under `data/raw/` (gitignored). Preserve HSN codes as text,
including leading zeroes. Column mappings are mandatory; the builder does not
guess workbook headers, numeric-code padding, descriptions or rates.

```sh
docker compose exec -T ml-fl-service python -m satya_engine.cli build-hsn \
  --hsn-xlsx data/raw/hsn-directory.xlsx \
  --code-column '<actual code header>' \
  --description-column '<actual description header>' \
  --retrieved-at '<actual retrieval ISO timestamp with offset>' \
  --output data/processed/hsn_master.review.json.gz
```

`--hsn-csv` is also supported. Excel uses read-only `openpyxl`, a dev/build
dependency only. Sources are capped at 64 MiB (including expanded workbook ZIP
contents); output must be below 5 MiB. Existing artifacts are never overwritten.
Review before copying an artifact into the committed `assets/` directory.

## Reviewed rate extraction

Optionally supply `--reviewed-rates data/raw/reviewed-rates.json`. This is a
locally reviewed extraction, not an automated PDF classification claim:

- `extractionReviewed`: `true` only after human review.
- `taxBasis`: `"total_gst"`; a central-tax-only schedule is NOT a combined rate.
- `sources`: name, primary government HTTPS URL, actual `retrievedAt`, `sha256`,
  and `localPath` relative to the extraction JSON. The builder verifies hashes.
- `rateRules`: prefix, description, rate (decimal string), optional cessRate,
  schedule, sNo, effectiveFrom, optional effectiveTo, notificationRef,
  conditional, sourceSha256, sourceLocator (page/row reference).

No example legal rates are provided. Keep conditional exclusions explicit.
`effectiveTo` is exclusive: close the prior rule at the new rule's effective
date. Lookup selects the longest active prefix only for a known directory code.
Conditional or overlapping equal-prefix rules return `rate: null`, candidates
and a warning rather than selecting a potentially wrong rate.

Outstanding: obtain and review the official directory and applicable
notifications (including amendments and historic rules), then add real
date-change regression fixtures. This must happen before enabling tax defaults.

## Repairs applied to the committed artifact (2026-11)

`assets/hsn_master.json.gz` version `20261029-r1` is the original extraction
passed through `python -m satya_engine.cli repair-hsn` (see
`satya_engine/india/hsn_repair.py`): schedule labels re-derived from S.No.
runs (Schedule II S.Nos. 96–640 had been labelled Schedule I at 5%), rates
re-derived per schedule, 4-digit prefixes extended from leading sub-heading
digits, and Schedule I S.No. 425 (water pumps) restored for the three
directory codes that name those pumps. `tests/test_hsn_rates.py` pins the
result. `build-hsn` applies the same repairs to new extractions. The server
image carries a copy at `server/assets/hsn_master.json.gz` (keep in sync).
