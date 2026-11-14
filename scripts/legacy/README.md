# Legacy demo scripts (superseded)

These scripts are superseded by `server/src/seed/curated.js` — see `docs/DEMO_DATASET.md`. Do not run them against a demo or production database.

They are kept for reference only:

- `seed-bpi-company.mjs` and `seed-bpi-discrepancies.mjs` generated the 455 BPI-derived cases. Those cases used synthetic "(Unit N)" suppliers, GSTINs that fail validation and dates that ran into the future.
- `enrich-demo-orders.mjs` was the owner's 11 SATYAD/PO/27-28 stories. They now live, re-dated into FY 2026-27 with corrected identities, as stories S01–S11 in `server/src/seed/stories.js`.
- `enrich-po-cases.mjs` charged IGST on intra-state supplies.
- `seed-demo-v2.mjs` used IRNs that were not 64-hex and counted rejected QC quantities as accepted.

Their import paths were updated for this folder. They still connect without a `dbName` and expect users who have already logged in.
