import crypto from "node:crypto";

// Bank details are never stored in the clear (04 P1-B3/B12):
// masked display + keyed HMAC for duplicate detection only.
const secret = () => process.env.BANK_HASH_SECRET || process.env.NODE_INTERNAL_TOKEN || "dev-only-bank-secret";

export const maskAccount = (accountNo) => {
  const digits = String(accountNo).replace(/\D/g, "");
  return `****${digits.slice(-4)}`;
};

export const accountHash = (accountNo, ifsc = "") =>
  crypto.createHmac("sha256", secret()).update(`${String(accountNo).replace(/\s/g, "")}|${ifsc.toUpperCase()}`).digest("hex");
