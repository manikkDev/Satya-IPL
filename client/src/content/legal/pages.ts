// Legal page content (docs/plan/07 §4). Scaffolds for the team to review with
// a qualified adviser before real customers. Every page shows "Last updated"
// and a version, and opens with a plain-language summary.
// Satya is a student/hackathon prototype with no registered legal entity yet.
// These pages say so plainly instead of carrying unfilled placeholders;
// replace them with reviewed terms before onboarding real customers.

export type LegalSection = { heading: string; paragraphs: string[] };
export type LegalPage = {
  slug: string;
  title: string;
  updated: string;
  version: string;
  summary: string;
  sections: LegalSection[];
};

const UPDATED = "14 November 2026";
const VERSION = "Prototype notice — not a binding agreement";

export const LEGAL_PAGES: LegalPage[] = [
  {
    slug: "privacy",
    title: "Privacy Policy",
    updated: UPDATED,
    version: VERSION,
    summary:
      "We keep your business documents private to your organisation, process uploads with AI only under your chosen data setting, and never sell your data. You can access, correct or erase your personal data, and raise a complaint with our Grievance Officer.",
    sections: [
      {
        heading: "Who we are",
        paragraphs: [
          "Satya is a prototype built by a student project team. It is not operated by a registered company and is not offered as a commercial service. The workspace contains a fictional demo company; please do not upload real business or personal data. If Satya is ever offered to real customers, a registered entity will act as data fiduciary under the Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025, and these pages will be replaced.",
          "Contact: use the GitHub repository for this project to reach the team — there is no dedicated privacy mailbox for the prototype.",
        ],
      },
      {
        heading: "What we collect",
        paragraphs: [
          "Account data: your name, email, role and organisation membership.",
          "Business documents you upload: purchase orders, invoices, receipts, payment and GST records. These can contain personal data of third parties, such as the names, phone numbers and bank details of sole-proprietor suppliers. You are responsible for having the authority to share these with us.",
          "Usage data: pages visited and actions taken, used to keep the service reliable and secure.",
        ],
      },
      {
        heading: "How AI processing works",
        paragraphs: [
          "Satya reads documents and answers questions using AI models provided by Google Gemini. Demo or sample documents may be processed on the free tier, where inputs may be used by Google to improve its products.",
          "Your real company documents are processed by AI only when your organisation's data policy is set to paid processing or you have given consent (Settings → AI). Evidence-only mode never sends document contents to an AI model.",
        ],
      },
      {
        heading: "Who we share data with",
        paragraphs: [
          "Hosting and infrastructure: Vercel (website), Render (services), MongoDB Atlas (records), Neo4j Aura (relationship graph), Google (AI models, under the policy above). Data may be stored or processed outside India; we use contractual safeguards with these providers.",
          "We do not sell personal data and do not share it for advertising.",
        ],
      },
      {
        heading: "Retention, security and breaches",
        paragraphs: [
          "Demo records are fictional and may be reset or deleted at any time without notice. Nothing in the prototype should be relied on as a record of real transactions.",
          "We encrypt data in transit, mask bank account numbers, isolate each organisation's records, and keep a tamper-evident audit log.",
          "If a breach affects your personal data, we will notify you and the Data Protection Board as required by law.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "If you entered any personal data despite the notice above, you may ask the team to correct or erase it through the project’s GitHub repository.",
          "This service is for businesses and is not intended for children.",
          "We do not currently use a Consent Manager; if that changes we will update this policy.",
        ],
      },
      {
        heading: "Grievance Officer",
        paragraphs: ["No grievance officer is appointed for this prototype. Raise any concern through the project’s GitHub repository; see Grievance Redressal."],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms of Service",
    updated: UPDATED,
    version: VERSION,
    summary:
      "Satya helps you organise and check procure-to-pay records. It does not give tax or legal advice, does not file returns, and never moves money. A human in your organisation always makes the final decision.",
    sections: [
      {
        heading: "The service",
        paragraphs: [
          "Satya reconstructs purchase orders, deliveries, invoices, payments and GST records, flags mismatches with evidence, and suggests next steps. Recommendations are decision-support; authorised people in your organisation approve, hold or escalate.",
        ],
      },
      {
        heading: "What Satya does not do",
        paragraphs: [
          "Satya does not provide tax, accounting or legal advice, does not file any return or form with any authority, and does not execute, initiate or schedule payments.",
          "AI-generated explanations may be incomplete. Figures shown are computed from your documents, not invented — but you should verify important figures with your accountant or tax adviser.",
        ],
      },
      {
        heading: "Your responsibilities",
        paragraphs: [
          "You confirm the accuracy of what you upload and that you are authorised to share third-party documents with us. You keep your credentials confidential and assign roles (maker/checker) responsibly.",
        ],
      },
      {
        heading: "Fees",
        paragraphs: [
          "Paid plans are billed as per the pricing page. All prices exclude GST, which is charged additionally as applicable. Trial terms are shown at signup.",
        ],
      },
      {
        heading: "General",
        paragraphs: [
          "The prototype is provided free and as-is, without any warranty. Demo accounts may be reset or removed at any time. It does not move money, file returns or give tax advice, and no figure in it should be relied on for a real business decision.",
        ],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    updated: UPDATED,
    version: VERSION,
    summary:
      "We use only essential cookies to keep you signed in. Our analytics (Vercel Analytics) is cookieless, and we use no advertising cookies — so there is no cookie banner.",
    sections: [
      {
        heading: "Essential cookies",
        paragraphs: ["Authentication/session cookies keep you signed in and protect your account. They are required for the service to work."],
      },
      {
        heading: "Analytics",
        paragraphs: ["We use Vercel Analytics, which does not set cookies. No advertising or tracking cookies are used."],
      },
    ],
  },
  {
    slug: "dpa",
    title: "Data Processing Addendum",
    updated: UPDATED,
    version: VERSION,
    summary:
      "For business customers: you remain the data fiduciary for the contents of your documents; Satya acts as your processor under these terms.",
    sections: [
      {
        heading: "Roles",
        paragraphs: [
          "The customer is the data fiduciary for personal data inside uploaded documents. Satya processes that data only on the customer's documented instructions, as a processor.",
        ],
      },
      {
        heading: "Sub-processors",
        paragraphs: [
          "Vercel Inc. (hosting), Render Services Inc. (compute), MongoDB Inc. (database), Neo4j Inc. (graph database), Google LLC (AI models — only under the customer's data policy). We will update this page before adding new sub-processors.",
        ],
      },
      {
        heading: "Security, breaches, deletion",
        paragraphs: [
          "Measures: encryption in transit, per-organisation isolation, masked bank details, tamper-evident audit logs, role-based access.",
          "The prototype holds only fictional demo data, so no customer data processing agreement applies. This addendum describes how a future commercial version would be expected to work and is not in force.",
          "Customers may audit compliance once per year on reasonable notice.",
        ],
      },
    ],
  },
  {
    slug: "ai",
    title: "AI Transparency",
    updated: UPDATED,
    version: VERSION,
    summary:
      "Where Satya uses AI, what it never does, and how your documents are treated. AI suggests; humans decide. AI never invents numbers.",
    sections: [
      {
        heading: "Where AI is used",
        paragraphs: [
          "Reading uploaded documents when the text layer is insufficient, phrasing answers in Ask Satya, and suggesting matches between records. Every figure in an answer is filled from your records, not generated by the model.",
        ],
      },
      {
        heading: "What AI never does",
        paragraphs: [
          "Approves payments, moves money, files returns, decides between ambiguous matches, or produces numbers that are not traceable to a document field.",
        ],
      },
      {
        heading: "Providers and data policy",
        paragraphs: [
          "Models: Google Gemini (primary). Demo data may use the free tier; real company documents are processed only under paid processing or with your consent (Settings → AI). Evidence-only mode works with no AI calls at all.",
        ],
      },
      {
        heading: "Limitations and problems",
        paragraphs: [
          "AI can misread unusual document layouts — low-confidence fields are always marked for your review. Report problems through the project’s GitHub repository.",
        ],
      },
    ],
  },
  {
    slug: "grievance",
    title: "Grievance Redressal",
    updated: UPDATED,
    version: VERSION,
    summary: "How to raise a complaint about personal data or the service, and the timelines we commit to.",
    sections: [
      {
        heading: "Grievance Officer",
        paragraphs: ["Satya is a prototype without an appointed grievance officer. Please raise concerns through the project’s GitHub repository; the team aims to respond within a reasonable time but makes no statutory commitment."],
      },
      {
        heading: "Timelines",
        paragraphs: [
          "We acknowledge complaints within 48 hours and aim to resolve them within 15 days. If unresolved, you may escalate to the Data Protection Board of India as provided under the DPDP Act, 2023.",
        ],
      },
    ],
  },
];

export function legalPage(slug: string) {
  return LEGAL_PAGES.find((page) => page.slug === slug);
}
