// Indian tax/banking reference lookups — display helpers only.
// GST state codes (first 2 chars of a GSTIN) and IFSC bank prefixes.

export const GST_STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

/** "27" → "Maharashtra" (from a GSTIN's first two chars, or a stored stateCode). */
export const gstStateName = (code: string | null | undefined): string | null =>
  code ? GST_STATE_NAMES[code] ?? null : null;

const BANK_NAMES: Record<string, string> = {
  HDFC: "HDFC Bank",
  SBIN: "State Bank of India",
  ICIC: "ICICI Bank",
  UTIB: "Axis Bank",
  AXIS: "Axis Bank",
  KKBK: "Kotak Mahindra Bank",
  PUNB: "Punjab National Bank",
  IDFB: "IDFC First Bank",
  YESB: "Yes Bank",
  BARB: "Bank of Baroda",
  CNRB: "Canara Bank",
  UBIN: "Union Bank of India",
  IOBA: "Indian Overseas Bank",
  MAHB: "Bank of Maharashtra",
  INDB: "IndusInd Bank",
  FDRL: "Federal Bank",
  IDIB: "Indian Bank",
  CBIN: "Central Bank of India",
  BKID: "Bank of India",
  IBKL: "IDBI Bank",
  RATN: "RBL Bank",
  KVBL: "Karur Vysya Bank",
  KARB: "Karnataka Bank",
  SIBL: "South Indian Bank",
  TMBL: "Tamilnad Mercantile Bank",
  CITI: "Citibank",
  HSBC: "HSBC",
  SCBL: "Standard Chartered",
  DEUT: "Deutsche Bank",
  UJVN: "Ujjivan Small Finance Bank",
  ESFB: "Equitas Small Finance Bank",
  AIRP: "Airtel Payments Bank",
  IPPB: "India Post Payments Bank",
  JAKA: "Jammu & Kashmir Bank",
};

/** "HDFC0001088" → { bank: "HDFC Bank", branch: "001088" } — bank may be null
 *  for prefixes we don't recognise (never guess). */
export const decodeIfsc = (ifsc: string | null | undefined): { bank: string | null; branch: string | null } => {
  const code = (ifsc ?? "").trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) return { bank: null, branch: null };
  return { bank: BANK_NAMES[code.slice(0, 4)] ?? null, branch: code.slice(5) };
};

/** PAN embedded in a GSTIN is chars 3–12 — used to cross-check against the PAN on file. */
export const panFromGstin = (gstin: string | null | undefined): string | null => {
  const g = (gstin ?? "").trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(g) ? g.slice(2, 12) : null;
};
