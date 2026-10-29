// INR amount-in-words (lakh/crore system) for PO/PI render models.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const threeDigits = (n) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${h ? `${ONES[h]} Hundred` : ""}${h && rest ? " " : ""}${rest ? twoDigits(rest) : ""}`.trim();
};

export const amountInWords = (amountStr, currency = "INR") => {
  const value = Number(amountStr);
  if (!Number.isFinite(value) || value < 0) return "";
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thousand = Math.floor((rupees % 1e5) / 1000);
  const rest = rupees % 1000;
  const parts = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  const rupeeText = parts.length ? `${parts.join(" ")} Rupees` : "Zero Rupees";
  const paiseText = paise ? ` and ${twoDigits(paise)} Paise` : "";
  return `${rupeeText}${paiseText} Only`;
};
