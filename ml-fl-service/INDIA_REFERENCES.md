# India helpers: sources and boundaries

Reviewed 2026-10-29. These are informational controls, not tax/legal advice.

- NIC state-code directory:
  https://einvoice1.gst.gov.in/Others/MasterCodes
  The committed asset transcribes that table, including historic code 25 and
  foreign/place-of-supply placeholders 96/99. A listed state is not evidence of
  an active GST registration.
- CGST Act section 2(103), 2(114):
  https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter1/section2_v1.00.html
  defines State to include UTs with legislature, and identifies the other UTs.
- CBIC registration structure:
  https://cbic-gst.gov.in/gst-registration-rules.html
  describes state + PAN/TAN + entity code + checksum. The helper deliberately
  handles ordinary PAN-based `...Z...` GSTINs, not all TDS/TCS/UIN categories.
  Mod-36 algorithm follows the project plan; the arithmetic regression vector is
  **not** claimed to be a GSTN-provided test vector. An official GSTN checksum
  test fixture remains outstanding.
- Purchase-of-goods TDS: Income-tax Act 2025 section 393(1), Table 8(ii),
  Note 1 (threshold/rate and exceptions):
  https://www.incometaxindia.gov.in/w/section-393-6
- Legacy buyer business-turnover definition and advance guidance: CBDT
  Circular 13/2021, especially paragraphs 4.6-4.8:
  https://traces61downloads.tdscpc.gov.in/docs/30-Jun-21.pdf
- Current section numbering: the official Income-tax Act 2025, as amended:
  https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf

The income-tax HTML page was indexed with the statutory table, but direct
container retrieval returned HTTP 403. No authentication or TLS checks were
bypassed. Deployment should get professional review of applicability and current
amendments; this is not a filing or withholding authority.

## Informational TDS boundaries

The caller must supply reviewed, eligible purchase bases and explicit residency,
buyer exemption, other-TDS/TCS applicability and prior-year business turnover.
Unknown eligibility produces `null`, not an assumed exemption or deduction.
This helper does not determine whether GST, an advance, return or seller
aggregation belongs in the statutory base.

Only the *incremental* amount above the per-seller annual threshold is estimated;
prior excess is not taxed again. Old dates cite 194Q; FY 2026-27 cites 393 and
402. Dates before 1 July 2021 and financial years beyond the reviewed 2026-27
version return an unavailable estimate rather than extrapolating future law.

`make_fictional_gstin` is a **demo-only checksum generator**. It cannot establish
that an identifier is unissued; all records using it must stay explicitly
`CONSTRUCTED_DEMO` and must never be treated as verified identities.
