# 08 — Research References, Datasets & Sources

Legend: **[V]** = opened/verified during the 29 Oct 2026 research pass (URL checked). **[S]** = standard, widely cited reference — verify the DOI/URL before publishing on the website. Agent D copies this list into `client/src/content/references.ts` for the `/research` page (show title, authors, venue, year, link; group by topic).

## A. Problem size & Indian economy (for pitch and landing page)
1. GAME, FISME & C2FO (2024). *Delayed Payments Report 3.0 — MSMEs' Access to Finance and Timely Payments*: delayed payments ₹7.34 lakh crore (Mar 2024), ₹8.27 lakh crore (2023), ₹10.7 lakh crore (2022); > 4.6% of GVA. https://c2fo.com/newsroom/delayed-payments-to-msmes-in-india-decrease-to-%E2%82%B97-34-lakh-crore-but-challenges-persist-delayed-payments-3-0-report/ ; https://knnindia.co.in/news/newsdetails/msme/delayed-payments-to-msmes-decline-from-rs-10-lakh-cr-to-rs-7-lakh-cr-but-challenges-persist-game-fisme-report [V]
2. Economic Times (2024). *Payments of ₹21,108 cr to small firms pending: MSME Samadhaan portal*. https://economictimes.indiatimes.com/news/economy/finance/payments-of-21108-cr-to-small-firms-pending-msme-samadhaan-portal/articleshow/114743675.cms [V]; MSME Samadhaan portal reports https://samadhaan.msme.gov.in [V]
3. PIB (2024/2025). MSME share: 30.1% of GDP (2022-23), 35.4% of manufacturing, 45.73% of exports. https://www.pib.gov.in/PressReleasePage.aspx?PRID=2142170 ; https://static.pib.gov.in/WriteReadData/specificdocs/documents/2024/dec/doc20241223476301.pdf [V]
4. Lok Sabha unstarred question (Ministry of Commerce & Industry): manufacturing share of GVA 15.69% (2024-25 FRE), 16.10% (2025-26 PE), base 2022-23. https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU3740_Uw9syO.pdf [V]
5. APQC Open Standards Benchmarking — duplicate or erroneous disbursements 0.8% (top performers) to 2% (bottom performers). CFO.com *Metric of the Month*: https://www.cfo.com/news/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/656852/ ; https://www.apqc.org/resource-library/resource-listing/percentage-duplicate-disbursements-processed [V]
6. India accounts-payable automation market estimates (two analyst sources with different scopes; quote as a range and name the source): 6Wresearch — USD 1,357 million (2025) → USD 2,097 million (2032), CAGR 8.9% https://www.6wresearch.com/industry-report/india-accounts-payable-automation-market ; TechSci/ResearchAndMarkets — USD 165 million (2024) → USD 255.51 million (2030), CAGR 7.4% https://www.researchandmarkets.com/report/india-accounts-payable-market [V]

## B. Indian law, tax & compliance (primary sources)
7. GST Council 56th meeting (3 Sep 2025): two-rate structure 5% / 18% + 40% special rate; effective 22 Sep 2025. https://www.gstcouncil.gov.in/sites/default/files/2025-09/press_release_press_information_bureau.pdf ; https://www.pib.gov.in/PressReleasePage.aspx?PRID=2164586 [V]
8. CBIC — GST goods & services rate schedules. http://cbic-gst.gov.in/gst-goods-services-rates.html [V]; GST portal HSN directory download (Search HSN Code → Download HSN Directory in Excel). https://tutorial.gst.gov.in/userguide/taxpayersdashboard/Search_HSN_SAC_Tax_Rates.htm [V]
9. GSTN advisory: e-invoice reporting within 30 days for AATO ≥ ₹10 crore from 1 Apr 2025. https://einvoice1.gst.gov.in/Documents/advisory270325.pdf [V]
10. IRP signed QR code procedure and FAQs (fields in the signed QR; JWT format). https://einvoice1.gst.gov.in/Documents/Qrcode_procedure.pdf ; https://einvoice1.gst.gov.in/Documents/IRN_QR_FAQS.pdf [V]; IRP public keys: https://einvoice.gst.gov.in/publickeys [V]; e-invoice digital signature overview: https://einvoice.gst.gov.in/einv-digitalsignature [V]
11. IRN cancellation within 24 hours (IRIS IRP knowledge base). https://einvoice6.gst.gov.in/content/kb/other-actions-for-e-invoicing/ [V]
12. Invoice Management System (IMS) FAQs (launched 14 Oct 2024; no action = deemed accepted). https://tutorial.gst.gov.in/downloads/news/final_faqs_on_ims_22_09_2024.pdf ; https://tutorial.gst.gov.in/downloads/news/additional_faqs_ims_17_10_2024.pdf [V]
13. CGST Rules, Rule 37 — reversal of ITC for non-payment within 180 days. https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter5/rule37_v1.00.html [V]; CGST Act s.50 (interest). https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter10/section50_v1.00.html [V]
14. CGST Rules, Rule 96A — export under bond/LUT (RFD-11). https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter10/rule96a_v1.00.html ; GST portal LUT guide https://tutorial.gst.gov.in/userguide/refund/Furnishing_of_Letter_of_Undertaking_for_Export_of_Goods_or_Services.htm [V]
15. E-way bill rules (Rule 138; ₹50,000 consignment value; validity per 200 km). https://cbic-gst.gov.in/ewaybill-rules.html ; https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter16/rule138_v1.00.html [V]
16. CBDT Circular 13/2021 — s.194Q TDS on purchase of goods (0.1% above ₹50 lakh; buyer turnover > ₹10 crore). https://traces61contents.tdscpc.gov.in/docs/30-Jun-21.pdf [V]
17. Income-tax Act, 2025 (in force 1 Apr 2026; TDS consolidated in ss. 392–393). https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf ; transition FAQs https://www.incometaxindia.gov.in/documents/81799/11848482/Updated-FQAs-on-Interplay%26Transitions.pdf [V]
18. Income-tax Act 1961 s.43B(h) (MSME payments) and MSMED Act 2006 s.15–16 (45-day limit, interest 3× bank rate). https://www.incometaxindia.gov.in/w/section-43b-42 [V]; analysis https://taxguru.in/income-tax/complete-analysis-section-43b-h-income-tax-act-w-r-t-msme-payment.html [V]
19. GSTIN structure and mod-36 check digit. https://gstinapi.com/blog/gstin-checksum-algorithm [V] (verify with official GSTN documentation where available)
20. Digital Personal Data Protection Rules, 2025 (notified 13 Nov 2025; phased commencement). https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa ; PIB https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014 [V]
21. To re-verify before release (well known, not re-opened in this pass): e-invoicing threshold AATO > ₹5 crore (Notification 10/2023-CT, from 1 Aug 2023); HSN digits on invoices (4 digits ≤ ₹5 crore AATO, 6 digits above; Notification 78/2020-CT); GST invoice number ≤ 16 characters (CGST Rule 46); ITC time limit (CGST s.16(4)); credit note time limit (CGST s.34). [S]

## C. Datasets
22. van Dongen, B.F. (2019). *BPI Challenge 2019* [Dataset]. 4TU.ResearchData. Real purchase-order handling event log, multinational coatings & paints company, ~60 subsidiaries. https://data.4tu.nl/datasets/35ed7122-966a-484e-a0e1-749b64e3366d ; TU/e portal https://research.tue.nl/en/datasets/bpi-challenge-2019/ ; IEEE Task Force on Process Mining https://www.tf-pm.org/competitions-awards/bpi-challenge/2019 [V] (check licence on dataset page)
23. BPI Challenge 2019 — OCEL (object-centric) version. https://data.4tu.nl/datasets/46a7e15b-10c7-4ab2-988d-ee67d8ea515a [V]
24. Šimsa, Š. et al. (2023). *DocILE Benchmark for Document Information Localization and Extraction*. ICDAR 2023. arXiv:2302.05658. Dataset (access request): https://docile.rossum.ai/ ; code https://github.com/rossumai/docile [V]
25. Government e-Marketplace (GeM) public order listings (real Indian procurement orders; e.g. buyer-published GeM order tables). https://mkp.gem.gov.in/ ; example public listing https://tenders.eil.co.in/NEWTENDERS/GeMThreshold [V] — respect terms of use; small manual samples only.
26. GST HSN directory & CBIC rate schedules (see B.8). [V]

## D. Entity resolution / record linkage
27. Fellegi, I.P. & Sunter, A.B. (1969). A Theory for Record Linkage. *Journal of the American Statistical Association*, 64(328). [S]
28. Enamorado, T., Fifield, B. & Imai, K. (2019). Using a Probabilistic Model to Assist Merging of Large-Scale Administrative Records (fastLink). *American Political Science Review*. [S]
29. Splink — probabilistic record linkage (UK Ministry of Justice). https://github.com/moj-analytical-services/splink ; https://www.gov.uk/government/publications/joined-up-data-in-government-the-future-of-data-linking-methods/splink-mojs-open-source-library-for-probabilistic-record-linkage-at-scale [V]
30. Li, Y., Li, J., Suhara, Y., Doan, A. & Tan, W.-C. (2021). Deep Entity Matching with Pre-Trained Language Models (Ditto). *PVLDB* 14(1):50–60. https://doi.org/10.14778/3421424.3421431 ; arXiv:2004.00584 [V]
31. Christen, P. (2012). *Data Matching: Concepts and Techniques for Record Linkage, Entity Resolution, and Duplicate Detection*. Springer. [S]

## E. Calibration, uncertainty & conformal prediction
32. Angelopoulos, A.N. & Bates, S. (2021). A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification. arXiv:2107.07511. [S]
33. Vovk, V., Gammerman, A. & Shafer, G. (2005). *Algorithmic Learning in a Random World*. Springer. [S]
34. Zadrozny, B. & Elkan, C. (2002). Transforming classifier scores into accurate multiclass probability estimates. *KDD 2002*. [S]
35. Guo, C., Pleiss, G., Sun, Y. & Weinberger, K.Q. (2017). On Calibration of Modern Neural Networks. *ICML 2017*. [S]
36. Galbraith, W., Li, X., Gyori, B.M. & Han, L. Risk-Controlled Prediction Sets for Entity Linking (RCPS-EL). https://gyorilab.github.io/papers/rcpsel_staix.pdf [V]
37. Kamsteeg, I. et al. (2025). Confidence Calibration in Large Language Model-Based Entity Matching. *UncertaiNLP 2025*. https://doi.org/10.18653/v1/2025.uncertainlp-main.12 [V]

## F. Machine learning & anomaly detection
38. Chen, T. & Guestrin, C. (2016). XGBoost: A Scalable Tree Boosting System. *KDD 2016*. [S]
39. Liu, F.T., Ting, K.M. & Zhou, Z.-H. (2008). Isolation Forest. *IEEE ICDM 2008*. [S] (IEEE)
40. Li, Z., Zhao, Y., Hu, X., Botta, N., Ionescu, C. & Chen, G.H. (2022). ECOD: Unsupervised Outlier Detection Using Empirical Cumulative Distribution Functions. *IEEE TKDE*. [S] (IEEE)
41. Iglewicz, B. & Hoaglin, D.C. (1993). *How to Detect and Handle Outliers* (modified z-score). ASQC. [S]
42. Nigrini, M.J. (2012). *Benford's Law: Applications for Forensic Accounting, Auditing, and Fraud Detection*. Wiley. [S]
43. Lundberg, S.M. & Lee, S.-I. (2017). A Unified Approach to Interpreting Model Predictions (SHAP). *NeurIPS 2017*. [S]
44. Kuhn, H.W. (1955). The Hungarian Method for the Assignment Problem. *Naval Research Logistics Quarterly*. [S]
45. van der Aalst, W.M.P. (2016). *Process Mining: Data Science in Action*. Springer. [S]

## G. Retrieval-augmented generation & LLM grounding
46. Lewis, P. et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. *NeurIPS 2020*. [S]
47. Sarmah, B., Hall, B., Rao, R., Patel, S., Pasquali, S. & Mehta, D. (2024). HybridRAG: Integrating Knowledge Graphs and Vector Retrieval Augmented Generation for Efficient Information Extraction. *ACM ICAIF 2024*. https://doi.org/10.1145/3677052.3698671 ; arXiv:2408.04948 [V]
48. Edge, D. et al. (2024). From Local to Global: A Graph RAG Approach to Query-Focused Summarization (Microsoft GraphRAG). arXiv:2404.16130. [S]
49. Yan, S.-Q., Gu, J.-C., Zhu, Y. & Ling, Z.-H. (2024). Corrective Retrieval Augmented Generation (CRAG). arXiv:2401.15884. [V]
50. Asai, A. et al. (2023). Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection. arXiv:2310.11511. [S]
51. Es, S. et al. (2023). RAGAS: Automated Evaluation of Retrieval Augmented Generation. arXiv:2309.15217. [S]
52. Cormack, G.V., Clarke, C.L.A. & Büttcher, S. (2009). Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods. *SIGIR 2009*. [S]
53. Kusupati, A. et al. (2022). Matryoshka Representation Learning. *NeurIPS 2022*. [S] (basis of Gemini embedding dimensionality control)
54. Google — Gemini API docs: rate limits (per project, RPD resets midnight Pacific) https://ai.google.dev/gemini-api/docs/rate-limits ; pricing & free-tier data use https://ai.google.dev/gemini-api/docs/pricing ; embeddings https://ai.google.dev/gemini-api/docs/embeddings ; models https://ai.google.dev/gemini-api/docs/models ; additional terms https://ai.google.dev/gemini-api/terms [V]

## H. Document understanding
55. Berghaus, D., Berger, A., Hillebrand, L., Cvejoski, K. & Sifa, R. (2025). Multi-Modal Vision vs. Text-Based Parsing: Benchmarking LLM Strategies for Invoice Processing. arXiv:2509.04469 — native image processing generally outperforms markdown-first parsing. [V]
56. *Invoice Information Extraction: Methods and Performance Evaluation* (2025), arXiv:2510.15727 — LLM extractor 94% vs Docling 63% field accuracy on 102 invoices; Docling faster. https://www.alphaxiv.org/abs/2510.15727 [V]
57. Cui, C. et al. (2025). PaddleOCR-VL: Boosting Multilingual Document Parsing via a 0.9B Ultra-Compact Vision-Language Model. arXiv:2510.14528 — candidate for future self-hosted, private extraction. [V]
58. Huang, Y. et al. (2022). LayoutLMv3: Pre-training for Document AI with Unified Text and Image Masking. *ACM MM 2022*. [S]

## I. Competitor & market landscape (for pitch; verify product claims on vendor sites before quoting)
- Accounting/ERP used by Indian SMEs: Tally (TallyPrime), Zoho Books, Busy, SAP Business One — record transactions; limited cross-document investigation.
- GST reconciliation tools (e.g., ClearTax/Clear GST, other GSP tools): strong at GSTR-2B vs purchase register matching — **a direct competitor for the ITC slice**; Satya differentiates by linking GST data with PO/GRN/QC/bank evidence and payments.
- Enterprise P2P suites: SAP Ariba, Coupa, Oracle — powerful, expensive, long implementations.
- Process mining: Celonis — discovers process inefficiencies at enterprise scale.
- AI document/AP tools: Rossum (creators of DocILE), AppZen, Vic.ai, HighRadius — extraction/AP automation, mostly global enterprises.
- Recovery audit firms (duplicate payment recovery, contingency-fee model).
Satya's position: India-first, SME/mid-market and group-aware, evidence-led investigation with calibrated ambiguity across the whole P2P + GST + payment chain, priced for MSMEs and sold through CAs.
