// AUTO-DERIVED from "Satya AP automation research.md" (References section,
// Nov 2026). Do not hand-edit — regenerate from the report.
// notReverified = the report tags the item "(not re-fetched)": a canonical
// paper whose identifier came from bibliographic records and was not
// re-opened during the research. Vendor sources are commercial claims.

export type Reference = {
  n: number;
  group: string;
  text: string;
  url: string | null;
  year: string | null;
  notReverified: boolean;
};

export const REFERENCE_GROUPS: readonly string[] = [
  "Internal",
  "Benchmarks, surveys and industry data (AP, India)",
  "Indian law, tax and regulation",
  "Fraud and enforcement news",
  "Competitors and products (vendor sources)",
  "Integration and data-source documentation",
  "Patents",
  "Academic: entity resolution, duplicates, allocation",
  "Academic: anomaly, fraud and process mining",
  "Academic: document AI",
  "Academic: calibration, abstention, drift, explainability",
  "Academic: LLM agents, grounding and security"
];

export const REFERENCES: Reference[] = [
  {
    "n": 1,
    "group": "Internal",
    "text": "Satya current system audit (read-only code inventory of the Satya repository, main branch, Nov 2026). Internal research note; no public URL.",
    "url": null,
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 2,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "Ardent Partners, State of ePayables Part Nine: AP Benchmarks and Best-in-Class Performance (Jan 2026).",
    "url": "https://payablesplace.ardentpartners.com/2026/01/state-of-epayables-part-nine-ap-benchmarks-and-best-in-class-performance/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 3,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "Medius, Ardent Partners: Accounts Payable Metrics That Matter.",
    "url": "https://www.medius.com/resources/guides-reports/ardent-partners-accounts-payable-metrics-that-matter/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 4,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "CFO.com / APQC, Metric of the Month: Detect and Prevent Duplicate or Erroneous Payments (Mar 2020).",
    "url": "https://cfo.com/news/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/656852/",
    "year": "2020",
    "notReverified": false
  },
  {
    "n": 5,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "CXOToday, Analysis of over 2,400 businesses shows invoice processing remains a bigger challenge than GST reconciliation (Aug 2026).",
    "url": "https://cxotoday.com/media-coverage/analysis-of-over-2400-businesses-shows-invoice-processing-remains-a-bigger-challenge-than-gst-reconciliation-as-founders-increasingly-seek-finance-automation/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 6,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "Tally Solutions, The ROI of Accounts Payable Automation.",
    "url": "https://tallysolutions.com/accounting/the-roi-of-accounts-payable-automation-calculating-the-cost-of-a-manual-invoice/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 7,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "AI Accountant, Real cost of manual invoice entry.",
    "url": "https://www.aiaccountant.com/blog/real-cost-manual-invoice-entry",
    "year": null,
    "notReverified": false
  },
  {
    "n": 8,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "C2FO newsroom, Delayed payments to MSMEs decrease to ₹7.34 lakh crore (Delayed Payments 3.0) (Nov 2025).",
    "url": "https://c2fo.com/newsroom/delayed-payments-to-msmes-in-india-decrease-to-%E2%82%B97-34-lakh-crore-but-challenges-persist-delayed-payments-3-0-report/",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 9,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "PIB, From Enterprise to Empowerment: The MSME Story (26 Jun 2026).",
    "url": "https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/jun/doc2026626903401.pdf",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 10,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "Rajya Sabha Unstarred Q.159, Impact of Section 43B(h) (20 Jul 2026).",
    "url": "https://a2ztaxcorp.net/wp-content/uploads/2026/07/RS-IMPACT-OF-SECTION-43Bh-FINANCE-ACT-2023-ON-MSMEs-21.07.2026.pdf",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 11,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "Wolters Kluwer, Pulse of Finance India 2025 press release (Oct 2025).",
    "url": "https://www.wolterskluwer.com/en-in/news/pr-2025-indian-cfos-prioritize-strategic-epm-erp-connection",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 12,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "EY India, Corporate Treasury Survey 2025 newsroom (Sep 2025).",
    "url": "https://www.ey.com/en_in/newsroom/2025/09/indian-leaders-embrace-ai-in-corporate-treasury-and-banking-operations-nearly-50-percent-rank-automation-as-top-investment-priority",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 13,
    "group": "Benchmarks, surveys and industry data (AP, India)",
    "text": "Grant Thornton Bharat, Finance Leaders Barometer 2026.",
    "url": "https://www.grantthornton.in/en/insights/thought-leadership/what-is-stopping-cfos-from-leading-at-full-capacity/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 14,
    "group": "Indian law, tax and regulation",
    "text": "LiveLaw, The stringency of interest provisions under MSMED Act.",
    "url": "https://www.livelaw.in/law-firms/law-firm-articles-/the-stringency-of-interest-provisions-under-msmed-act-implementation-and-judicial-interpretation-310929",
    "year": null,
    "notReverified": false
  },
  {
    "n": 15,
    "group": "Indian law, tax and regulation",
    "text": "DC-MSME, Legal Framework (PDF).",
    "url": "https://www.dcmsme.gov.in/publications/LegalFramework.pdf",
    "year": null,
    "notReverified": false
  },
  {
    "n": 16,
    "group": "Indian law, tax and regulation",
    "text": "incorpx, MSME 45-day payment rule compliance guide.",
    "url": "https://www.incorpx.io/guide/msme-45-day-payment-rule-compliance-section-405",
    "year": null,
    "notReverified": false
  },
  {
    "n": 17,
    "group": "Indian law, tax and regulation",
    "text": "Business Standard, 45-day MSME payment rule: Section 43B(h) explained.",
    "url": "https://www.business-standard.com/finance/personal-finance/45-day-msme-payment-rule-impact-and-details-of-section-43b-h-explained-124032600333_1.html",
    "year": null,
    "notReverified": false
  },
  {
    "n": 18,
    "group": "Indian law, tax and regulation",
    "text": "Taxmann, Practical insights into Section 43B(h).",
    "url": "https://www.taxmann.com/post/blog/analysis-practical-insights-into-section-43bh-regarding-disallowance-of-delayed-payments-to-mses/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 19,
    "group": "Indian law, tax and regulation",
    "text": "Business Today, 45-day MSME payment rule kicks in from Monday (31 Mar 2024).",
    "url": "https://businesstoday.in/latest/economy/story/45-day-msme-payment-rule-kicks-in-from-monday-heres-what-this-means-for-the-sector-423606-2024-03-31",
    "year": "2024",
    "notReverified": false
  },
  {
    "n": 20,
    "group": "Indian law, tax and regulation",
    "text": "TaxGuru, Section 43B(h) and Udyam registration timing.",
    "url": "https://taxguru.in/?p=1090442",
    "year": null,
    "notReverified": false
  },
  {
    "n": 21,
    "group": "Indian law, tax and regulation",
    "text": "Grant Thornton Bharat, What's changing with the 180-day ITC reversal rule (Dec 2025).",
    "url": "https://www.grantthornton.in/en/insights/articles/whats-changing-with-the-180-day-itc-reversal-rule-under-gst/",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 22,
    "group": "Indian law, tax and regulation",
    "text": "ClearTax, Rule 37: ITC reversal after 180 days.",
    "url": "https://cleartax.in/s/rule-37-of-cgst-sgst-rules-itc-reversal-180-days",
    "year": null,
    "notReverified": false
  },
  {
    "n": 23,
    "group": "Indian law, tax and regulation",
    "text": "TaxGuru, Rule 37A ITC reversal.",
    "url": "https://taxguru.in/goods-and-service-tax/rule-37a-gst-critical-itc-reversal-rule-businesses-avoid-costly-interest.html",
    "year": null,
    "notReverified": false
  },
  {
    "n": 24,
    "group": "Indian law, tax and regulation",
    "text": "ClearTax, Rule 88D / DRC-01C.",
    "url": "https://cleartax.in/s/rule-88d-cgst-itc-mismatch-gstr-2b-vs-gstr-3b",
    "year": null,
    "notReverified": false
  },
  {
    "n": 25,
    "group": "Indian law, tax and regulation",
    "text": "Tally Solutions, Step-by-step guide to IMS on the GST portal.",
    "url": "https://tallysolutions.com/gst/a-step-by-step-guide-on-how-to-use-ims-in-gst-portal/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 26,
    "group": "Indian law, tax and regulation",
    "text": "Taxmann, GSTN adds pending option for credit notes and ITC reversal flexibility in IMS.",
    "url": "https://www.taxmann.com/post/blog/gstn-adds-pending-option-for-credit-notes-and-itc-reversal-flexibility-in-ims",
    "year": null,
    "notReverified": false
  },
  {
    "n": 27,
    "group": "Indian law, tax and regulation",
    "text": "EY India, CBIC lowers e-invoicing threshold to ₹5 crore (May 2023).",
    "url": "https://www.ey.com/en_in/alerts-hub/2023/05/cbic-lowers-turnover-threshold-for-e-invoicing-to-inr5-crores-with-effect-from-1-august-2023",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 28,
    "group": "Indian law, tax and regulation",
    "text": "GSTN advisory (hosted by Maharashtra GST), Time limit for reporting e-invoices: AATO ₹10 crore and above.",
    "url": "https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf",
    "year": null,
    "notReverified": false
  },
  {
    "n": 29,
    "group": "Indian law, tax and regulation",
    "text": "SCC Online, GST Council 56th meeting: slab reforms (Sep 2025).",
    "url": "https://www.scconline.com/blog/post/2025/09/04/gst-council-56th-meeting-slab-reforms-tribunal-rollouts-2025/",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 30,
    "group": "Indian law, tax and regulation",
    "text": "Business Today, Can GST rate rejig lead to a logistical nightmare? (Sep 2025).",
    "url": "https://www.businesstoday.in/india/story/can-gst-rate-rejig-lead-to-a-logistical-nightmare-for-retailers-experts-flag-concerns-492862-2025-09-06",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 31,
    "group": "Indian law, tax and regulation",
    "text": "Income Tax Department, TDS on purchase of goods (194Q) tutorial.",
    "url": "https://incometaxindia.gov.in/tutorials/71.tds-on-purchase-of-goods.pdf",
    "year": null,
    "notReverified": false
  },
  {
    "n": 32,
    "group": "Indian law, tax and regulation",
    "text": "Tally Solutions, MSME payment rules: vendor payment compliance guide.",
    "url": "https://tallysolutions.com/business-guides/msme-payment-rules-vendor-payment-compliance-guide/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 33,
    "group": "Indian law, tax and regulation",
    "text": "RBI, FREE-AI Committee report press release (Aug 2025).",
    "url": "https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=61018",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 34,
    "group": "Indian law, tax and regulation",
    "text": "Securiti, Summary of RBI FREE-AI framework.",
    "url": "https://securiti.ai/?p=100951",
    "year": null,
    "notReverified": false
  },
  {
    "n": 35,
    "group": "Indian law, tax and regulation",
    "text": "AZB & Partners, India's DPDP framework comes into effect.",
    "url": "https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 36,
    "group": "Indian law, tax and regulation",
    "text": "Mondaq, Digital Personal Data Protection Rules 2025: highlights.",
    "url": "https://www.mondaq.com/india/privacy-protection/1707558/digital-personal-data-protection-rules-2025-highlights",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 37,
    "group": "Indian law, tax and regulation",
    "text": "Linklaters, India: new and onerous cyber security framework and breach reporting obligations (May 2022).",
    "url": "https://www.linklaters.com/en/insights/blogs/digilinks/2022/may/india-new-and-onerous-cyber-security-framework-and-breach-reporting-obligations",
    "year": "2022",
    "notReverified": false
  },
  {
    "n": 38,
    "group": "Indian law, tax and regulation",
    "text": "Sahamati, Financial Information User (FIU).",
    "url": "https://sahamati.org.in/financial-information-user-fiu",
    "year": null,
    "notReverified": false
  },
  {
    "n": 39,
    "group": "Fraud and enforcement news",
    "text": "Business Standard, GST officers detect ₹35,132 cr ITC evasion by over 17k fake firms (Dec 2024).",
    "url": "https://business-standard.com/finance/news/gst-officers-detect-rs-35-132-cr-itc-evasion-by-over-17k-fake-firms-govt-124120900549_1.html",
    "year": "2024",
    "notReverified": false
  },
  {
    "n": 40,
    "group": "Fraud and enforcement news",
    "text": "Free Press Journal, GST evasion of ₹7.08 lakh crore detected in 5 years.",
    "url": "https://www.freepressjournal.in/business/gst-evasion-of-708-lakh-crore-detected-in-5-years-179-lakh-crore-linked-to-itc-fraud",
    "year": null,
    "notReverified": false
  },
  {
    "n": 41,
    "group": "Fraud and enforcement news",
    "text": "ETV Bharat, Engineering firm duped of ₹5.47 crore.",
    "url": "https://etvbharat.com/en/!state/cybercriminals-dupe-engineering-firm-of-rs-5-dot-47-crore-all-it-took-was-a-letter-change-in-email-address-enn25021501764",
    "year": null,
    "notReverified": false
  },
  {
    "n": 42,
    "group": "Fraud and enforcement news",
    "text": "Medical Dialogues, Cybercriminals trick Dr Reddy's finance team (Nov 2025).",
    "url": "https://medicaldialogues.in/amp/news/industry/pharma/cybercriminals-trick-dr-reddys-finance-team-divert-rs-216-crore-payment-158412",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 43,
    "group": "Fraud and enforcement news",
    "text": "Cyber Security News, Pune auto-parts firm loses ₹2.35 crore.",
    "url": "https://cybersecuritynews.com/pune-auto-parts-firm-loses-%E2%82%B92-35-crore/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 44,
    "group": "Fraud and enforcement news",
    "text": "Bridge Chronicle, Pune engineering firm duped of ₹2.3 crore.",
    "url": "https://www.thebridgechronicle.com/pune/cyber-crime-pune-engineering-firm-duped-2-3-crore-email-fraud-foreign-supplier",
    "year": null,
    "notReverified": false
  },
  {
    "n": 45,
    "group": "Fraud and enforcement news",
    "text": "Deccan Herald, Manipal Technologies lured into sending ₹1.04 crore.",
    "url": "https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fmanipal-technologies-limited-lured-into-sending-rs-104-crore-to-the-account-of-cyber-fraudsters-3787920",
    "year": null,
    "notReverified": false
  },
  {
    "n": 46,
    "group": "Competitors and products (vendor sources)",
    "text": "Ramp, Agents for AP announcement (Oct 2025).",
    "url": "https://ramp.com/blog/ramp-ap-agents-announcement",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 47,
    "group": "Competitors and products (vendor sources)",
    "text": "Coupa newsroom, September release accelerates agentic spend capabilities (2026).",
    "url": "https://www.coupa.com/newsroom/coupas-september-release-accelerates-agentic-spend-capabilities/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 48,
    "group": "Competitors and products (vendor sources)",
    "text": "Coupa blog, September 2026 finance automation.",
    "url": "https://www.coupa.com/blog/september-2026-finance-automation/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 49,
    "group": "Competitors and products (vendor sources)",
    "text": "Tipalti, PO matching.",
    "url": "https://tipalti.com/product/po-matching/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 50,
    "group": "Competitors and products (vendor sources)",
    "text": "CFO Dive (Basware press release), Basware launches agentic AI (Feb 2026).",
    "url": "https://www.cfodive.com/press-release/20260224-basware-launches-new-agentic-ai-capabilities-to-transform-intelligent-finan-1/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 51,
    "group": "Competitors and products (vendor sources)",
    "text": "UC Strategies, Basware's AI agents can process 2.2B invoices but can't decide which to approve.",
    "url": "https://ucstrategies.com/news/baswares-ai-agents-can-process-2-2b-invoices-but-cant-decide-which-to-approve/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 52,
    "group": "Competitors and products (vendor sources)",
    "text": "Hyperbots, 3-way matching copilot.",
    "url": "https://www.hyperbots.com/copilots/invoice-processing/3-way-matching",
    "year": null,
    "notReverified": false
  },
  {
    "n": 53,
    "group": "Competitors and products (vendor sources)",
    "text": "Stampli, Prevent duplicate invoice payments.",
    "url": "https://www.stampli.com/blog/accounts-payable/prevent-duplicate-invoice-payments/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 54,
    "group": "Competitors and products (vendor sources)",
    "text": "Costbench, Accounts payable pricing 2026.",
    "url": "https://costbench.com/stats/accounts-payable-pricing-2026/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 55,
    "group": "Competitors and products (vendor sources)",
    "text": "Corpay, Tipalti vs BILL.",
    "url": "https://www.corpay.com/resources/blog/tipalti-vs-bill-com",
    "year": null,
    "notReverified": false
  },
  {
    "n": 56,
    "group": "Competitors and products (vendor sources)",
    "text": "Tally Solutions, Streamlining compliance and payments to MSMEs (TallyPrime 4.1).",
    "url": "https://tallysolutions.com/tally/streamlining-compliance-and-payments-to-msmes/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 57,
    "group": "Competitors and products (vendor sources)",
    "text": "Tally Help, MSME features.",
    "url": "https://help.tallysolutions.com/tally-prime/accounting/msme-features/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 58,
    "group": "Competitors and products (vendor sources)",
    "text": "Zoho Books Help, Bill reconciliation (BillPay add-on).",
    "url": "https://www.zoho.com/books/help/billpay-addon/bill-reconciliation.html",
    "year": null,
    "notReverified": false
  },
  {
    "n": 59,
    "group": "Competitors and products (vendor sources)",
    "text": "ClearTax, AI ITC matching.",
    "url": "https://cleartax.in/s/ai-itc-matching",
    "year": null,
    "notReverified": false
  },
  {
    "n": 60,
    "group": "Competitors and products (vendor sources)",
    "text": "Masters India docs, IMS vs Purchase Register reconciliation.",
    "url": "https://docs.mastersindia.co/masters-india-gst-software/introduction/reconciliation/ims-vs-purchase-register-reconciliation",
    "year": null,
    "notReverified": false
  },
  {
    "n": 61,
    "group": "Competitors and products (vendor sources)",
    "text": "RazorpayX, Source to Pay.",
    "url": "https://razorpay.com/x/source-to-pay/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 62,
    "group": "Competitors and products (vendor sources)",
    "text": "RazorpayX docs, Tally integration.",
    "url": "https://razorpay.com/docs/x/vendor-payments/tally",
    "year": null,
    "notReverified": false
  },
  {
    "n": 63,
    "group": "Competitors and products (vendor sources)",
    "text": "Digital Terminal, Cygnet.One launches agentic AI platform for accounts payable (Aug 2026).",
    "url": "https://digitalterminal.in/solutions/cygnetone-launches-agentic-ai-platform-to-transform-accounts-payable",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 64,
    "group": "Competitors and products (vendor sources)",
    "text": "Capterra, Suvit.",
    "url": "https://www.capterra.com/p/10031523/Suvit/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 65,
    "group": "Competitors and products (vendor sources)",
    "text": "Tally Solutions, TallyPrime total cost of ownership in India.",
    "url": "https://tallysolutions.com/business-guides/tallyprime-total-cost-of-ownership-india/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 66,
    "group": "Competitors and products (vendor sources)",
    "text": "Patron Accounting, Zoho Books pricing India 2026.",
    "url": "https://www.patronaccounting.com/blog/zoho-books-pricing-india-2026",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 67,
    "group": "Competitors and products (vendor sources)",
    "text": "Invoice Data Extraction, Partial delivery and multi-GRN reconciliation.",
    "url": "https://invoicedataextraction.com/blog/partial-delivery-multi-grn-reconciliation",
    "year": null,
    "notReverified": false
  },
  {
    "n": 68,
    "group": "Competitors and products (vendor sources)",
    "text": "Microsoft Learn, Configure the account reconciliation agent (Dynamics 365 Finance).",
    "url": "https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/configure-acct-recon-agent",
    "year": null,
    "notReverified": false
  },
  {
    "n": 69,
    "group": "Competitors and products (vendor sources)",
    "text": "Accounting Today, Intuit debuts AI agents for QuickBooks.",
    "url": "https://www.accountingtoday.com/news/intuit-debuts-ai-agents-for-quickbooks",
    "year": null,
    "notReverified": false
  },
  {
    "n": 70,
    "group": "Competitors and products (vendor sources)",
    "text": "Vic.ai, What does Vic.ai do?",
    "url": "https://www.vic.ai/blog/what-does-vic-ai-do",
    "year": null,
    "notReverified": false
  },
  {
    "n": 71,
    "group": "Competitors and products (vendor sources)",
    "text": "HighRadius, AI invoice processing.",
    "url": "https://www.highradius.com/resources/Blog/ai-invoice-processing/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 72,
    "group": "Competitors and products (vendor sources)",
    "text": "Corpay, Touchless invoice processing.",
    "url": "https://www.corpay.com/resources/blog/touchless-invoice-processing",
    "year": null,
    "notReverified": false
  },
  {
    "n": 73,
    "group": "Competitors and products (vendor sources)",
    "text": "Hypatos, What is touchless rate in AP automation?",
    "url": "https://www.hypatos.ai/knowledge-base/what-is-touchless-rate-ap-automation",
    "year": null,
    "notReverified": false
  },
  {
    "n": 74,
    "group": "Competitors and products (vendor sources)",
    "text": "Stampli, Data to clean before automation.",
    "url": "https://www.stampli.com/resources/data-to-clean-before-automation/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 75,
    "group": "Competitors and products (vendor sources)",
    "text": "Stampli, Evaluating invoice processing tools.",
    "url": "https://www.stampli.com/resources/evaluating-invoice-processing-tools/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 76,
    "group": "Competitors and products (vendor sources)",
    "text": "Stampli, AI learns your business.",
    "url": "https://www.stampli.com/resources/ai-learns-your-business/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 77,
    "group": "Competitors and products (vendor sources)",
    "text": "Peakflo, Prevent duplicate invoices and payments.",
    "url": "https://peakflo.co/blog/prevent-duplicate-invoices-payments-accounts-payable",
    "year": null,
    "notReverified": false
  },
  {
    "n": 78,
    "group": "Competitors and products (vendor sources)",
    "text": "Formance, AI reconciliation: what it can and cannot automate.",
    "url": "https://www.formance.com/blog/embedded-finance/ai-reconciliation",
    "year": null,
    "notReverified": false
  },
  {
    "n": 79,
    "group": "Competitors and products (vendor sources)",
    "text": "Stripe, How we built it: Stripe Radar.",
    "url": "https://stripe.com/blog/how-we-built-it-stripe-radar",
    "year": null,
    "notReverified": false
  },
  {
    "n": 80,
    "group": "Competitors and products (vendor sources)",
    "text": "Uber Engineering, Project RADAR: intelligent early fraud detection with humans in the loop.",
    "url": "https://eng.uber.com/blog/project-radar-intelligent-early-fraud-detection/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 81,
    "group": "Integration and data-source documentation",
    "text": "Tally Help, XML Integration.",
    "url": "https://help.tallysolutions.com/xml-integration/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 82,
    "group": "Integration and data-source documentation",
    "text": "Tally Help, JSON-based export/import.",
    "url": "https://help.tallysolutions.com/json-based-export-import/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 83,
    "group": "Integration and data-source documentation",
    "text": "Suvit Help, Sync Master & Sync Vouchers.",
    "url": "https://help.suvit.io/articles/sync-master-sync-vouchers",
    "year": null,
    "notReverified": false
  },
  {
    "n": 84,
    "group": "Integration and data-source documentation",
    "text": "Suvit Help, Transactions failed to sync in Tally.",
    "url": "https://help.suvit.io/articles/transaction-s-failed-to-sync-in-tally",
    "year": null,
    "notReverified": false
  },
  {
    "n": 85,
    "group": "Integration and data-source documentation",
    "text": "Truto, How to integrate with the Zoho Books API (2026).",
    "url": "https://truto.one/blog/how-to-integrate-with-the-zoho-books-api-2026-engineering-guide/",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 86,
    "group": "Integration and data-source documentation",
    "text": "BUSY FAQ, How do I import/export data in BUSY?",
    "url": "https://busy.in/faqs/how-do-i-importexport-data-in-busy-answerid-67737/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 87,
    "group": "Integration and data-source documentation",
    "text": "Vayana enriched API, GSTR-2B download.",
    "url": "https://docs.enriched-api.vayana.com/routes/basic/gstn/apis/returns/Gstr-Download-Lite-Api/gstr-2b/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 88,
    "group": "Integration and data-source documentation",
    "text": "Terra Insight, MT940 vs CAMT.053 vs MT942 in India (vendor blog).",
    "url": "https://www.terra-insight.com/insights/mt940-vs-camt-053-vs-mt942-india/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 89,
    "group": "Integration and data-source documentation",
    "text": "Attestr, PAN–Udyam MSME status API.",
    "url": "https://attestr.developerhub.io/attestr-docs/pan-udyam-msme-status-api",
    "year": null,
    "notReverified": false
  },
  {
    "n": 90,
    "group": "Integration and data-source documentation",
    "text": "TaxGuru, GSTIN structure.",
    "url": "https://taxguru.in/goods-and-service-tax/gstin-goods-and-service-tax-identification-number-structure.html",
    "year": null,
    "notReverified": false
  },
  {
    "n": 91,
    "group": "Integration and data-source documentation",
    "text": "python-stdnum, stdnum/in_/gstin.py (reference GSTIN checksum implementation).",
    "url": "https://sources.debian.org/data/main/p/python-stdnum/2.2-1/stdnum/in_/gstin.py",
    "year": null,
    "notReverified": false
  },
  {
    "n": 92,
    "group": "Integration and data-source documentation",
    "text": "ClearTax docs, E-invoicing API basics (IRN, SignedQRCode).",
    "url": "https://docs.cleartax.in/cleartax-docs/e-invoicing-api/learn-e-invoicing-api-basics",
    "year": null,
    "notReverified": false
  },
  {
    "n": 93,
    "group": "Integration and data-source documentation",
    "text": "Masters India, Signed QR code in e-invoicing.",
    "url": "https://www.mastersindia.co/gst/signed-qr-code-e-invoicing-system/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 94,
    "group": "Integration and data-source documentation",
    "text": "invoicedataextraction.com, Vision-LLM invoice extraction in Python (vendor blog).",
    "url": "https://invoicedataextraction.com/blog/vision-llm-invoice-extraction-python",
    "year": null,
    "notReverified": false
  },
  {
    "n": 95,
    "group": "Integration and data-source documentation",
    "text": "HackerNoon, Can your LLM handle an invoice? I tested 5 (blog).",
    "url": "https://hackernoon.com/can-your-llm-handle-an-invoice-i-tested-5heres-the-truth",
    "year": null,
    "notReverified": false
  },
  {
    "n": 96,
    "group": "Integration and data-source documentation",
    "text": "Groq, Rate limits documentation.",
    "url": "https://console.groq.com/docs/rate-limits",
    "year": null,
    "notReverified": false
  },
  {
    "n": 97,
    "group": "Integration and data-source documentation",
    "text": "BenchLM, Groq free tier summary (third-party).",
    "url": "https://benchlm.ai/md/free-tier/groq.md",
    "year": null,
    "notReverified": false
  },
  {
    "n": 98,
    "group": "Integration and data-source documentation",
    "text": "agentdeals, Gemini API pricing changes (third-party).",
    "url": "https://agentdeals.dev/gemini-api-pricing-changes",
    "year": null,
    "notReverified": false
  },
  {
    "n": 99,
    "group": "Patents",
    "text": "USPTO 12045215, Machine learning based duplicate invoice detection.",
    "url": "https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12045215",
    "year": null,
    "notReverified": false
  },
  {
    "n": 100,
    "group": "Patents",
    "text": "USPTO 11450129, Data extraction and duplicate detection.",
    "url": "https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11450129",
    "year": null,
    "notReverified": false
  },
  {
    "n": 101,
    "group": "Patents",
    "text": "USPTO 12277148, ML matching engine for bank statements and open invoices (SAP).",
    "url": "https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12277148",
    "year": null,
    "notReverified": false
  },
  {
    "n": 102,
    "group": "Patents",
    "text": "USPTO 12235848, Solving subset sum matching problem using search approach.",
    "url": "https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12235848",
    "year": null,
    "notReverified": false
  },
  {
    "n": 103,
    "group": "Patents",
    "text": "USPTO 11556728, ML matching of invoice and payment statements with drift-triggered retraining.",
    "url": "https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11556728",
    "year": null,
    "notReverified": false
  },
  {
    "n": 104,
    "group": "Patents",
    "text": "USPTO 12430403, Dynamic calibration of confidence-to-accuracy mappings in entity matching.",
    "url": "https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12430403",
    "year": null,
    "notReverified": false
  },
  {
    "n": 105,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Fellegi, I.P. & Sunter, A.B. (1969). A Theory for Record Linkage. JASA 64(328).",
    "url": "https://doi.org/10.1080/01621459.1969.10501049",
    "year": "1969",
    "notReverified": true
  },
  {
    "n": 106,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Binette, O. & Steorts, R.C. (2022). (Almost) All of Entity Resolution. Science Advances; arXiv:2008.04443.",
    "url": "https://arxiv.org/pdf/2008.04443",
    "year": "2022",
    "notReverified": false
  },
  {
    "n": 107,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Enamorado, T., Fifield, B. & Imai, K. (2019). Using a Probabilistic Model to Assist Merging of Large-Scale Administrative Records. APSR 113(2).",
    "url": "https://doi.org/10.1017/S0003055418000783",
    "year": "2019",
    "notReverified": true
  },
  {
    "n": 108,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Linacre, R. et al. (2022). Splink: Free software for probabilistic record linkage at scale. IJPDS 7(3).",
    "url": "https://ijpds.org/article/view/1794",
    "year": "2022",
    "notReverified": false
  },
  {
    "n": 109,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Sarawagi, S. & Bhamidipaty, A. (2002). Interactive deduplication using active learning. KDD 2002.",
    "url": "https://doi.org/10.1145/775047.775087",
    "year": "2002",
    "notReverified": true
  },
  {
    "n": 110,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Meduri, V.V. et al. (2020). A Comprehensive Benchmark Framework for Active Learning Methods in Entity Matching. SIGMOD 2020.",
    "url": "https://doi.org/10.1145/3318464.3380597",
    "year": "2020",
    "notReverified": true
  },
  {
    "n": 111,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Mudgal, S. et al. (2018). Deep Learning for Entity Matching: A Design Space Exploration. SIGMOD 2018.",
    "url": "https://doi.org/10.1145/3183713.3196926",
    "year": "2018",
    "notReverified": true
  },
  {
    "n": 112,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Li, Y. et al. (2020). Deep Entity Matching with Pre-Trained Language Models (Ditto). PVLDB 14(1).",
    "url": "https://doi.org/10.14778/3421424.3421431",
    "year": "2020",
    "notReverified": true
  },
  {
    "n": 113,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Peeters, R., Steiner, A. & Bizer, C. (2025). Entity Matching using Large Language Models. EDBT 2025; arXiv:2310.11244.",
    "url": "https://arxiv.org/abs/2310.11244v2",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 114,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Christen, P. (2012). A Survey of Indexing Techniques for Scalable Record Linkage and Deduplication. IEEE TKDE 24(9).",
    "url": "https://doi.org/10.1109/TKDE.2011.127",
    "year": "2012",
    "notReverified": true
  },
  {
    "n": 115,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Papadakis, G. et al. (2020). Blocking and Filtering Techniques for Entity Resolution: A Survey. ACM Computing Surveys 53(2).",
    "url": "https://doi.org/10.1145/3377455",
    "year": "2020",
    "notReverified": true
  },
  {
    "n": 116,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Madhani, Y. et al. (2023). Aksharantar: Open Indic-language Transliteration Datasets and Models. Findings of EMNLP 2023; arXiv:2205.03018.",
    "url": "https://arxiv.org/abs/2205.03018v2",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 117,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Digital Auditor: A Framework for Matching Duplicate Invoices. IEEE Xplore doc. 8978075 (authors/year not retrievable).",
    "url": "https://ieeexplore.ieee.org/document/8978075/",
    "year": null,
    "notReverified": false
  },
  {
    "n": 118,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Nigrini, M. Benford's Law and digital analysis (ACFE Fraud Conference presentation).",
    "url": "https://www.fraudconference.com/uploadedFiles/Fraud_Conference/Content/Course-Materials/presentations/23rd/ppt/12E-Mark-Nigrini.pdf",
    "year": null,
    "notReverified": false
  },
  {
    "n": 119,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "AuditNet, Using Benford's Law for fraud detection and auditing (slides).",
    "url": "https://de.slideshare.net/auditnet/using-benfords-law-for-fraud-detection-and-auditing",
    "year": null,
    "notReverified": false
  },
  {
    "n": 120,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Wu, Y. et al. (2025). The Subset Sum Matching Problem. ECAI 2025; arXiv:2508.19218.",
    "url": "https://arxiv.org/abs/2508.19218",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 121,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Bringmann, K. (2017). A Near-Linear Pseudopolynomial Time Algorithm for Subset Sum. SODA 2017.",
    "url": "https://doi.org/10.1137/1.9781611974782.69",
    "year": "2017",
    "notReverified": true
  },
  {
    "n": 122,
    "group": "Academic: entity resolution, duplicates, allocation",
    "text": "Kuhn, H.W. (1955). The Hungarian Method for the Assignment Problem. Naval Research Logistics Quarterly 2.",
    "url": "https://doi.org/10.1002/nav.3800020109",
    "year": "1955",
    "notReverified": true
  },
  {
    "n": 123,
    "group": "Academic: anomaly, fraud and process mining",
    "text": "Liu, F.T., Ting, K.M. & Zhou, Z.-H. (2008). Isolation Forest. ICDM 2008.",
    "url": "https://doi.org/10.1109/ICDM.2008.17",
    "year": "2008",
    "notReverified": true
  },
  {
    "n": 124,
    "group": "Academic: anomaly, fraud and process mining",
    "text": "Schreyer, M. et al. (2017). Detection of Anomalies in Large Scale Accounting Data using Deep Autoencoder Networks. arXiv:1709.05254.",
    "url": "https://arxiv.org/abs/1709.05254v2",
    "year": "2017",
    "notReverified": false
  },
  {
    "n": 125,
    "group": "Academic: anomaly, fraud and process mining",
    "text": "Dou, Y. et al. (2020). Enhancing GNN-based Fraud Detectors against Camouflaged Fraudsters (CARE-GNN). CIKM 2020; arXiv:2008.08692.",
    "url": "https://arxiv.org/pdf/2008.08692",
    "year": "2020",
    "notReverified": false
  },
  {
    "n": 126,
    "group": "Academic: anomaly, fraud and process mining",
    "text": "Collusion Detection with Graph Neural Networks (2024). arXiv:2410.07091.",
    "url": "https://arxiv.org/pdf/2410.07091",
    "year": "2024",
    "notReverified": false
  },
  {
    "n": 127,
    "group": "Academic: anomaly, fraud and process mining",
    "text": "Public Procurement Collusion Identification Based on GraphSAGE Algorithm. Springer, doi:10.1007/978-3-031-82427-2_3.",
    "url": "https://link.springer.com/chapter/10.1007/978-3-031-82427-2_3",
    "year": null,
    "notReverified": false
  },
  {
    "n": 128,
    "group": "Academic: anomaly, fraud and process mining",
    "text": "van Dongen, B. (2019). BPI Challenge 2019 dataset. 4TU.ResearchData / TU/e.",
    "url": "https://research.tue.nl/en/datasets/bpi-challenge-2019/",
    "year": "2019",
    "notReverified": false
  },
  {
    "n": 129,
    "group": "Academic: anomaly, fraud and process mining",
    "text": "BPI Challenge 2019 Submission 3, Dissecting the Purchase-to-Pay Process (non-peer-reviewed).",
    "url": "https://icpmconference.org/wp-content/uploads/BPI-Challenge-Submission-3.pdf",
    "year": "2019",
    "notReverified": false
  },
  {
    "n": 130,
    "group": "Academic: document AI",
    "text": "Šimsa, Š. et al. (2023). DocILE Benchmark for Document Information Localization and Extraction. ICDAR 2023; arXiv:2302.05658.",
    "url": "https://arxiv.org/abs/2302.05658",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 131,
    "group": "Academic: document AI",
    "text": "Wang, Z. et al. (2023). VRDU: A Benchmark for Visually-rich Document Understanding. KDD 2023; arXiv:2211.15421.",
    "url": "https://arxiv.org/abs/2211.15421",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 132,
    "group": "Academic: document AI",
    "text": "Huang, Y. et al. (2022). LayoutLMv3. arXiv:2204.08387.",
    "url": "https://arxiv.org/abs/2204.08387",
    "year": "2022",
    "notReverified": true
  },
  {
    "n": 133,
    "group": "Academic: document AI",
    "text": "PaddleOCR-VL (2025). arXiv:2510.14528.",
    "url": "https://arxiv.org/pdf/2510.14528",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 134,
    "group": "Academic: document AI",
    "text": "Ouyang, L. et al. (2025). OmniDocBench. CVPR 2025; arXiv:2412.07626.",
    "url": "https://arxiv.org/html/2412.07626v2",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 135,
    "group": "Academic: document AI",
    "text": "Limam, M. et al. (2023). FATURA: A Multi-Layout Invoice Image Dataset. arXiv:2311.11856.",
    "url": "https://arxiv.org/abs/2311.11856",
    "year": "2023",
    "notReverified": true
  },
  {
    "n": 136,
    "group": "Academic: document AI",
    "text": "Jin et al. (2026). Perception, Layout, and Validation: Calibrated Confidence for Reliable Straight-Through Processing of Financial Documents. arXiv:2609.20110.",
    "url": "https://arxiv.org/abs/2609.20110",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 137,
    "group": "Academic: document AI",
    "text": "Biten, A.F. et al. (2019). Scene Text Visual Question Answering (ANLS). arXiv:1905.13648.",
    "url": "https://arxiv.org/abs/1905.13648",
    "year": "2019",
    "notReverified": true
  },
  {
    "n": 138,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Niculescu-Mizil, A. & Caruana, R. (2005). Predicting Good Probabilities with Supervised Learning. ICML 2005.",
    "url": "https://doi.org/10.1145/1102351.1102430",
    "year": "2005",
    "notReverified": true
  },
  {
    "n": 139,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Zadrozny, B. & Elkan, C. (2002). Transforming Classifier Scores into Accurate Multiclass Probability Estimates. KDD 2002.",
    "url": "https://doi.org/10.1145/775047.775151",
    "year": "2002",
    "notReverified": true
  },
  {
    "n": 140,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Vovk, V. & Petej, I. (2014). Venn–Abers Predictors. UAI 2014; arXiv:1211.0025.",
    "url": "https://arxiv.org/abs/1211.0025",
    "year": "2014",
    "notReverified": true
  },
  {
    "n": 141,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Elkan, C. (2001). The Foundations of Cost-Sensitive Learning. IJCAI 2001.",
    "url": "https://cseweb.ucsd.edu/~elkan/rescale.pdf",
    "year": "2001",
    "notReverified": true
  },
  {
    "n": 142,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Chow, C.K. (1970). On Optimum Recognition Error and Reject Tradeoff. IEEE Trans. Information Theory 16(1).",
    "url": "https://doi.org/10.1109/TIT.1970.1054406",
    "year": "1970",
    "notReverified": true
  },
  {
    "n": 143,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Geifman, Y. & El-Yaniv, R. (2017). Selective Classification for Deep Neural Networks. NeurIPS 2017; arXiv:1705.08500.",
    "url": "https://arxiv.org/abs/1705.08500",
    "year": "2017",
    "notReverified": true
  },
  {
    "n": 144,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Angelopoulos, A.N. & Bates, S. (2023). Conformal Prediction: A Gentle Introduction. arXiv:2107.07511.",
    "url": "https://arxiv.org/abs/2107.07511",
    "year": "2023",
    "notReverified": true
  },
  {
    "n": 145,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Angelopoulos, A.N. et al. (2024). Conformal Risk Control. ICLR 2024; arXiv:2208.02814.",
    "url": "https://arxiv.org/abs/2208.02814",
    "year": "2024",
    "notReverified": true
  },
  {
    "n": 146,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Rabanser, S., Günnemann, S. & Lipton, Z.C. (2019). Failing Loudly: Detecting Dataset Shift. NeurIPS 2019; arXiv:1810.11953.",
    "url": "https://arxiv.org/abs/1810.11953",
    "year": "2019",
    "notReverified": true
  },
  {
    "n": 147,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Gama, J. et al. (2014). A Survey on Concept Drift Adaptation. ACM Computing Surveys 46(4).",
    "url": "https://doi.org/10.1145/2523813",
    "year": "2014",
    "notReverified": true
  },
  {
    "n": 148,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Saito, T. & Rehmsmeier, M. (2015). The Precision-Recall Plot Is More Informative than the ROC Plot. PLoS ONE 10(3).",
    "url": "https://doi.org/10.1371/journal.pone.0118432",
    "year": "2015",
    "notReverified": true
  },
  {
    "n": 149,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Nixon, J. et al. (2019). Measuring Calibration in Deep Learning. arXiv:1904.01685.",
    "url": "https://arxiv.org/abs/1904.01685",
    "year": "2019",
    "notReverified": true
  },
  {
    "n": 150,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Brier, G.W. (1950). Verification of Forecasts Expressed in Terms of Probability. Monthly Weather Review 78(1).",
    "url": "https://doi.org/10.1175/1520-0493(1950)078%3C0001:VOFEIT%3E2.0.CO;2",
    "year": "1950",
    "notReverified": true
  },
  {
    "n": 151,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Dror, R. et al. (2018). The Hitchhiker's Guide to Testing Statistical Significance in NLP. ACL 2018.",
    "url": "https://aclanthology.org/P18-1128/",
    "year": "2018",
    "notReverified": true
  },
  {
    "n": 152,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Lundberg, S.M. et al. (2020). From Local Explanations to Global Understanding with Explainable AI for Trees. Nature Machine Intelligence 2.",
    "url": "https://doi.org/10.1038/s42256-019-0138-9",
    "year": "2020",
    "notReverified": true
  },
  {
    "n": 153,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Mothilal, R.K., Sharma, A. & Tan, C. (2020). Explaining ML Classifiers through Diverse Counterfactual Explanations (DiCE). FAT 2020.",
    "url": "https://doi.org/10.1145/3351095.3372850",
    "year": "2020",
    "notReverified": true
  },
  {
    "n": 154,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Mitchell, M. et al. (2019). Model Cards for Model Reporting. FAT 2019; arXiv:1810.03993.",
    "url": "https://arxiv.org/abs/1810.03993",
    "year": "2019",
    "notReverified": true
  },
  {
    "n": 155,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Gebru, T. et al. (2021). Datasheets for Datasets. CACM; arXiv:1803.09010.",
    "url": "https://arxiv.org/abs/1803.09010",
    "year": "2021",
    "notReverified": true
  },
  {
    "n": 156,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "Board of Governors of the Federal Reserve System & OCC (2011). SR 11-7: Guidance on Model Risk Management.",
    "url": "https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm",
    "year": "2011",
    "notReverified": false
  },
  {
    "n": 157,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "NIST (2023). AI Risk Management Framework 1.0 (AI 100-1).",
    "url": "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 158,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "NIST (2024). Generative AI Profile (AI 600-1).",
    "url": "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf",
    "year": "2024",
    "notReverified": false
  },
  {
    "n": 159,
    "group": "Academic: calibration, abstention, drift, explainability",
    "text": "MUSE: Multi-Tenant Model Serving (2026). arXiv:2602.11776.",
    "url": "https://arxiv.org/html/2602.11776v2",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 160,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Yao, S. et al. (2023). ReAct: Synergizing Reasoning and Acting in Language Models. arXiv:2210.03629.",
    "url": "https://arxiv.org/abs/2210.03629",
    "year": "2023",
    "notReverified": true
  },
  {
    "n": 161,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Chen, W. et al. (2023). Program of Thoughts Prompting. TMLR; arXiv:2211.12588.",
    "url": "https://arxiv.org/abs/2211.12588",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 162,
    "group": "Academic: LLM agents, grounding and security",
    "text": "FINDER (2025). arXiv:2510.13157.",
    "url": "https://arxiv.org/abs/2510.13157",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 163,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Li, J. et al. (2023). Can LLM Already Serve as a Database Interface? (BIRD). arXiv:2305.03111.",
    "url": "https://arxiv.org/abs/2305.03111",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 164,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Kang, D. (2026). Pervasive annotation errors break text-to-SQL benchmarks. CIDR 2026 slides.",
    "url": "https://www.cidrdb.org/cidr2026/slides/Kang-16.pdf",
    "year": "2026",
    "notReverified": false
  },
  {
    "n": 165,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Kang, D. Pervasive annotation errors break text-to-SQL benchmarks (Substack).",
    "url": "https://ddkang.substack.com/p/pervasive-annotation-errors-break",
    "year": null,
    "notReverified": false
  },
  {
    "n": 166,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Islam, P. et al. (2023). FinanceBench: A New Benchmark for Financial Question Answering. arXiv:2311.11944.",
    "url": "https://arxiv.org/abs/2311.11944",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 167,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Gao, T. et al. (2023). Enabling Large Language Models to Generate Text with Citations (ALCE). arXiv:2305.14627.",
    "url": "https://arxiv.org/abs/2305.14627",
    "year": "2023",
    "notReverified": false
  },
  {
    "n": 168,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Es, S. et al. (2023). RAGAS: Automated Evaluation of Retrieval Augmented Generation. arXiv:2309.15217.",
    "url": "https://arxiv.org/abs/2309.15217",
    "year": "2023",
    "notReverified": true
  },
  {
    "n": 169,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Greshake, K. et al. (2023). Not what you've signed up for: Indirect Prompt Injection. arXiv:2302.12173.",
    "url": "https://arxiv.org/abs/2302.12173",
    "year": "2023",
    "notReverified": true
  },
  {
    "n": 170,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Debenedetti, E. et al. (2025). Defeating Prompt Injections by Design (CaMeL). arXiv:2503.18813.",
    "url": "https://arxiv.org/abs/2503.18813",
    "year": "2025",
    "notReverified": false
  },
  {
    "n": 171,
    "group": "Academic: LLM agents, grounding and security",
    "text": "Sophos, Inside the lethal trifecta: blast-radius reduction in AI agent deployments (secondary report of Nasr et al.).",
    "url": "https://www.sophos.com/fr-fr/blog/inside-the-lethal-trifecta-blast-radius-reduction-in-ai-agent-deployments",
    "year": null,
    "notReverified": false
  }
];

export const REPORT_TITLE = "Satya AP automation research: Satya wins by proving the evidence chain (Nov 2026)";

export function ref(n: number): Reference {
  const found = REFERENCES.find((r) => r.n === n);
  if (!found) throw new Error(`Unknown reference #${n}`);
  return found;
}
