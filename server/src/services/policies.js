import Policy from "../models/Policy.js";

const LEGAL_NOTE = "Sample template — review with your legal adviser before issuing";

export const DEFAULT_TERMS = [
  {
    id: "terms-po-standard", name: "Standard purchase order terms", docType: "PO",
    disclaimer: LEGAL_NOTE,
    clauses: [
      "Prices are firm and in INR unless stated otherwise.",
      "Delivery as per the schedule on each line; partial deliveries need written acceptance.",
      "Goods are inspected on receipt; acceptance follows quality clearance.",
      "Payments follow agreed terms on accepted quantity and valid tax invoices.",
      "Invoices must quote this PO number and line references.",
      "Applicable GST is payable only against a compliant tax invoice reflected in our GSTR-2B.",
      "MSME suppliers: payments target the timelines under the MSMED Act, 2006.",
      "Disputes are subject to the jurisdiction stated in the order.",
    ],
  },
  {
    id: "terms-pi-out-standard", name: "Standard proforma invoice terms", docType: "PI_OUT",
    disclaimer: LEGAL_NOTE,
    clauses: [
      "This proforma invoice is not a tax invoice; a tax invoice follows on supply.",
      "Prices and taxes are estimates valid for the stated validity period.",
      "Advance payments, if any, adjust against the final tax invoice.",
    ],
  },
];

export const DEFAULT_NUMBERING = [
  { docType: "PO", pattern: "{ENT}/PO/{FY}/{SEQ:6}" },
  { docType: "PO_AMENDMENT", pattern: "{ENT}/POA/{FY}/{SEQ:6}" },
  { docType: "PI_OUT", pattern: "{ENT}/PI/{FY}/{SEQ:6}" },
  { docType: "INVOICE_OUT", pattern: "{ENT}/INV/{FY}/{SEQ:6}" },
  { docType: "GRN", pattern: "{ENT}/GRN/{FY}/{SEQ:6}" },
];

export const DEFAULT_DOA = [
  { docType: "PO", maxAmount: "100000.00", roles: ["entity_admin", "ap_manager"] },
  { docType: "PO", maxAmount: "10000000.00", roles: ["group_admin"] },
];

// Fetch or lazily create the entity policy with sensible defaults (04 P1-B3).
export const ensurePolicy = async (entityId, groupId) => {
  const existing = await Policy.findOne({ entityId });
  if (existing) return existing;
  return Policy.create({
    entityId,
    groupId,
    doa: DEFAULT_DOA,
    numbering: DEFAULT_NUMBERING.map((n) => ({ ...n, nextSeq: 1 })),
    termsTemplates: DEFAULT_TERMS,
  });
};
