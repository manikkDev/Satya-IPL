// ROI calculator model for /roi. Pure functions, no React.
//
// Arithmetic is exact: every input is parsed from its decimal string into a
// scaled BigInt (12 decimal places) and only the final rupee figures are
// rounded (half-up, to the paisa). The MSMED compound-interest factor uses
// whole monthly rests plus simple interest for the part-month, which keeps
// it rational and therefore exact too.
//
// Defaults are either benchmarks from "Satya AP automation research" (with
// the report's reference number), statutory values, or clearly labelled
// placeholders for the customer to replace. Benchmarks describe the AP
// automation market generally; they are not Satya results or promises.

export type Scenario = "conservative" | "expected";

export type SourceTag =
  | { kind: "benchmark"; refs: number[]; note: string }
  | { kind: "statutory"; refs: number[]; note: string }
  | { kind: "assumption"; note: string }
  | { kind: "placeholder"; note: string };

export type InputKey =
  | "invoicesPerMonth" | "apStaff" | "loadedCostPerFte" | "hoursPerFteYear" | "minutesPerInvoice"
  | "exceptionRatePct" | "minutesPerException" | "monthlyPayables" | "msmeSharePct" | "latePaidSharePct"
  | "lateDays" | "bankRatePct" | "duplicateRatePct" | "itcAtRiskPerYear" | "taxRatePct"
  | "touchlessPct" | "exceptionReductionPct" | "latePreventedPct" | "duplicateCatchPct" | "itcProtectedPct";

export type InputSpec = {
  key: InputKey;
  group: "volume" | "msme" | "risk" | "effect";
  label: string;
  unit: "count" | "inr" | "pct" | "min" | "days" | "hours";
  defaults: Record<Scenario, string>;
  source: SourceTag;
  min?: number;
  max?: number;
  step?: string;
};

const both = (v: string) => ({ conservative: v, expected: v });

export const INPUTS: InputSpec[] = [
  // --- your AP operation
  { key: "invoicesPerMonth", group: "volume", label: "Supplier invoices per month", unit: "count", defaults: both("1000"), min: 0, source: { kind: "placeholder", note: "Illustrative. Enter your own volume." } },
  { key: "apStaff", group: "volume", label: "AP staff (full-time equivalents)", unit: "count", defaults: both("3"), min: 0, step: "0.5", source: { kind: "placeholder", note: "Illustrative. Enter your own headcount." } },
  { key: "loadedCostPerFte", group: "volume", label: "Loaded cost per AP person, per year", unit: "inr", defaults: both("600000"), min: 0, source: { kind: "placeholder", note: "Illustrative. Salary + benefits + overhead, from your payroll." } },
  { key: "hoursPerFteYear", group: "volume", label: "Working hours per person, per year", unit: "hours", defaults: both("2000"), min: 1, source: { kind: "assumption", note: "8 hours × 250 days. Adjust to your calendar." } },
  { key: "minutesPerInvoice", group: "volume", label: "Minutes to key and check one clean invoice", unit: "min", defaults: both("4"), min: 0, step: "0.5", source: { kind: "benchmark", refs: [6], note: "Tally estimates about 4 minutes of manual entry per invoice." } },
  { key: "exceptionRatePct", group: "volume", label: "Exception rate (invoices needing investigation)", unit: "pct", defaults: both("18.4"), min: 0, max: 100, step: "0.1", source: { kind: "benchmark", refs: [2], note: "Ardent Partners global average, 2026 (a Medius summary reports 19.9%)." } },
  { key: "minutesPerException", group: "volume", label: "Extra minutes to resolve one exception", unit: "min", defaults: both("20"), min: 0, source: { kind: "placeholder", note: "No public benchmark found. Time a week of your own exceptions." } },

  // --- MSME exposure
  { key: "monthlyPayables", group: "msme", label: "Supplier payments per month (all suppliers)", unit: "inr", defaults: both("20000000"), min: 0, source: { kind: "placeholder", note: "Illustrative ₹2 crore a month. Enter your own." } },
  { key: "msmeSharePct", group: "msme", label: "Share paid to micro & small (Udyam) suppliers", unit: "pct", defaults: both("30"), min: 0, max: 100, source: { kind: "placeholder", note: "Illustrative. Use your Udyam-tagged vendor spend." } },
  { key: "latePaidSharePct", group: "msme", label: "Share of those payments made after the 45-day limit", unit: "pct", defaults: both("20"), min: 0, max: 100, source: { kind: "placeholder", note: "Illustrative. From your ageing report, counted from acceptance date." } },
  { key: "lateDays", group: "msme", label: "Average days late beyond the limit", unit: "days", defaults: both("30"), min: 0, max: 730, source: { kind: "placeholder", note: "Illustrative. From your payment history." } },
  { key: "bankRatePct", group: "msme", label: "RBI bank rate", unit: "pct", defaults: both("5.50"), min: 0, max: 20, step: "0.05", source: { kind: "statutory", refs: [16], note: "Rate used in the research report. Verify the current RBI bank rate. Interest is 3× this rate." } },
  { key: "taxRatePct", group: "msme", label: "Your effective income-tax rate", unit: "pct", defaults: both("25.17"), min: 0, max: 60, step: "0.01", source: { kind: "statutory", refs: [], note: "s.115BAA company rate (22% + 10% surcharge + 4% cess). Confirm with your tax adviser." } },

  // --- payment & tax risk
  { key: "duplicateRatePct", group: "risk", label: "Duplicate or erroneous payment rate", unit: "pct", defaults: both("0.8"), min: 0, max: 10, step: "0.1", source: { kind: "benchmark", refs: [4], note: "APQC: about 0.8% for top performers, 2% for bottom performers." } },
  { key: "itcAtRiskPerYear", group: "risk", label: "Input tax credit at risk per year", unit: "inr", defaults: both("500000"), min: 0, source: { kind: "placeholder", note: "Illustrative. Use last year's ITC reversals, 2B mismatches and Rule 37 reversals." } },

  // --- what Satya changes (scenario-driven)
  { key: "touchlessPct", group: "effect", label: "Invoices processed with no manual keying", unit: "pct", defaults: { conservative: "45", expected: "65" }, min: 0, max: 100, source: { kind: "benchmark", refs: [73], note: "Blended touchless rates of 45–65% reported across AP automation (Hypatos). Market benchmark, not a Satya result." } },
  { key: "exceptionReductionPct", group: "effect", label: "Reduction in exceptions needing manual work", unit: "pct", defaults: { conservative: "23.5", expected: "47" }, min: 0, max: 100, step: "0.5", source: { kind: "benchmark", refs: [2], note: "Best-in-class AP teams have 47% fewer exceptions (Ardent). Conservative uses half that gap." } },
  { key: "latePreventedPct", group: "effect", label: "Late MSME payments prevented by clock alerts", unit: "pct", defaults: { conservative: "50", expected: "80" }, min: 0, max: 100, source: { kind: "assumption", note: "No published benchmark. It depends on your cash position and approvals. Set your own." } },
  { key: "duplicateCatchPct", group: "effect", label: "Duplicate/erroneous payments caught before release", unit: "pct", defaults: { conservative: "25", expected: "50" }, min: 0, max: 100, source: { kind: "assumption", note: "No independently validated detection rate exists (research report). Set your own." } },
  { key: "itcProtectedPct", group: "effect", label: "ITC at risk protected by earlier matching", unit: "pct", defaults: { conservative: "25", expected: "50" }, min: 0, max: 100, source: { kind: "assumption", note: "No published benchmark. Set your own." } },
];

export const GROUPS: { id: InputSpec["group"]; title: string; hint: string }[] = [
  { id: "volume", title: "Your AP operation", hint: "Volumes and time. Replace the illustrative values with your own." },
  { id: "msme", title: "MSME payments", hint: "Used for MSMED s.16 interest and the s.43B(h) deduction." },
  { id: "risk", title: "Payment and tax risk", hint: "Duplicates, erroneous payments and input tax credit." },
  { id: "effect", title: "What changes with Satya", hint: "Assumptions set by the scenario toggle. Benchmarks describe the market, not Satya." },
];

export type Inputs = Record<InputKey, string>;

export function defaultInputs(s: Scenario): Inputs {
  return Object.fromEntries(INPUTS.map((i) => [i.key, i.defaults[s]])) as Inputs;
}

/* ---------------- exact decimal arithmetic ---------------- */

const SCALE = BigInt(10) ** BigInt(12);
const ZERO = BigInt(0);
const ONE = SCALE;

/** Parse a non-negative decimal string into a scaled BigInt. Invalid → 0. */
export function D(text: string | number): bigint {
  const s = String(text).trim().replace(/[,₹\s]/g, "");
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return ZERO;
  const [i, f = ""] = s.split(".");
  return BigInt(i || "0") * SCALE + BigInt((f + "000000000000").slice(0, 12));
}
const roundDiv = (a: bigint, b: bigint) => {
  if (b === ZERO) return ZERO;
  const q = a / b;
  const r = a % b;
  return r * BigInt(2) >= b ? q + BigInt(1) : q;
};
export const mul = (a: bigint, b: bigint) => roundDiv(a * b, SCALE);
export const div = (a: bigint, b: bigint) => roundDiv(a * SCALE, b);
const pctOf = (p: bigint) => div(p, D(100));
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const floorInt = (a: bigint) => a / SCALE;

/** Scaled rupees → integer paise (half-up). */
export const toPaise = (rupees: bigint) => roundDiv(rupees * BigInt(100), SCALE);
/** Scaled value → plain decimal string with `dp` places (half-up). */
export function fmtScaled(v: bigint, dp = 2): string {
  const factor = BigInt(10) ** BigInt(dp);
  const n = roundDiv(v * factor, SCALE);
  const neg = n < ZERO;
  const abs = neg ? -n : n;
  const intPart = abs / factor;
  const frac = dp ? `.${(abs % factor).toString().padStart(dp, "0")}` : "";
  return `${neg ? "-" : ""}${intPart}${frac}`;
}

/* ---------------- the model ---------------- */

export type Result = {
  hoursSavedPerYear: bigint; // scaled hours
  hoursCapped: boolean;
  labourSavedPerYear: bigint; // scaled ₹
  hourlyCost: bigint;
  lateMsePerMonth: bigint;
  monthsLate: bigint;
  wholeMonths: bigint;
  interestFactor: bigint;
  interestExposurePerYear: bigint;
  interestAvoidedPerYear: bigint;
  overdueAtYearEnd: bigint;
  deductionProtected: bigint;
  taxTimingBenefit: bigint;
  disbursementsPerYear: bigint;
  paymentsAtRiskPerYear: bigint;
  duplicatesPreventedPerYear: bigint;
  itcProtectedPerYear: bigint;
  totalPerYear: bigint;
};

export function compute(raw: Inputs): Result {
  const v = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, D(x)])) as Record<InputKey, bigint>;
  const twelve = D(12);
  const sixty = D(60);

  // 1. Time
  const minutesPerMonth =
    mul(mul(v.invoicesPerMonth, pctOf(v.touchlessPct)), v.minutesPerInvoice) +
    mul(mul(mul(v.invoicesPerMonth, pctOf(v.exceptionRatePct)), pctOf(v.exceptionReductionPct)), v.minutesPerException);
  const rawHours = div(mul(minutesPerMonth, twelve), sixty);
  const capacity = mul(v.apStaff, v.hoursPerFteYear);
  const hoursSavedPerYear = min(rawHours, capacity);
  const hourlyCost = v.hoursPerFteYear > ZERO ? div(v.loadedCostPerFte, v.hoursPerFteYear) : ZERO;
  const labourSavedPerYear = mul(hoursSavedPerYear, hourlyCost);

  // 2. MSMED s.16: compound interest with monthly rests at 3 × bank rate.
  const lateMsePerMonth = mul(mul(v.monthlyPayables, pctOf(v.msmeSharePct)), pctOf(v.latePaidSharePct));
  const monthlyRate = div(mul(D(3), pctOf(v.bankRatePct)), twelve);
  const monthsLate = div(mul(v.lateDays, twelve), D(365));
  const wholeMonths = floorInt(monthsLate);
  const part = monthsLate - wholeMonths * SCALE;
  let growth = ONE;
  for (let i = BigInt(0); i < wholeMonths; i++) growth = mul(growth, ONE + monthlyRate);
  growth = mul(growth, ONE + mul(monthlyRate, part));
  const interestFactor = growth - ONE;
  const interestExposurePerYear = mul(mul(lateMsePerMonth, interestFactor), twelve);
  const interestAvoidedPerYear = mul(interestExposurePerYear, pctOf(v.latePreventedPct));

  // 3. s.43B(h): late MSE dues outstanding at 31 March move their deduction
  // to the next year. Approximation: one month's late cohort per month late.
  const overdueAtYearEnd = mul(lateMsePerMonth, min(monthsLate, twelve));
  const deductionProtected = mul(overdueAtYearEnd, pctOf(v.latePreventedPct));
  const taxTimingBenefit = mul(deductionProtected, pctOf(v.taxRatePct));

  // 4. Duplicates / erroneous payments
  const disbursementsPerYear = mul(v.monthlyPayables, twelve);
  const paymentsAtRiskPerYear = mul(disbursementsPerYear, pctOf(v.duplicateRatePct));
  const duplicatesPreventedPerYear = mul(paymentsAtRiskPerYear, pctOf(v.duplicateCatchPct));

  // 5. ITC
  const itcProtectedPerYear = mul(v.itcAtRiskPerYear, pctOf(v.itcProtectedPct));

  const totalPerYear = labourSavedPerYear + interestAvoidedPerYear + duplicatesPreventedPerYear + itcProtectedPerYear;

  return {
    hoursSavedPerYear, hoursCapped: rawHours > capacity, labourSavedPerYear, hourlyCost,
    lateMsePerMonth, monthsLate, wholeMonths, interestFactor, interestExposurePerYear, interestAvoidedPerYear,
    overdueAtYearEnd, deductionProtected, taxTimingBenefit,
    disbursementsPerYear, paymentsAtRiskPerYear, duplicatesPreventedPerYear, itcProtectedPerYear, totalPerYear,
  };
}

/* ---------------- URL sharing ---------------- */

export function toQuery(s: Scenario, inputs: Inputs): string {
  const base = defaultInputs(s);
  const p = new URLSearchParams();
  p.set("s", s);
  for (const spec of INPUTS) if (inputs[spec.key] !== base[spec.key]) p.set(spec.key, inputs[spec.key]);
  return p.toString();
}

export function fromQuery(search: string): { scenario: Scenario; inputs: Inputs } {
  const p = new URLSearchParams(search);
  const scenario: Scenario = p.get("s") === "conservative" ? "conservative" : "expected";
  const inputs = defaultInputs(scenario);
  for (const spec of INPUTS) {
    const val = p.get(spec.key);
    if (val !== null && /^\d{0,12}(\.\d{0,6})?$/.test(val) && val !== "") inputs[spec.key] = val;
  }
  return { scenario, inputs };
}
