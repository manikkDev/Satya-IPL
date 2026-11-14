// Indian fiscal year: April–March, on the Asia/Kolkata calendar.
// fyOf("2026-10-29") -> "2026-27". A bare business date ("YYYY-MM-DD") is
// already an Indian calendar date and is read as-is; Date objects and full
// timestamps are converted to IST first, so 31 Mar 20:00 UTC (= 1 Apr 01:30
// IST) lands in the new year.
const IST_OFFSET_MS = 330 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date in IST as "YYYY-MM-DD". */
export const istDate = (dateLike = new Date()) => {
  if (typeof dateLike === "string" && DATE_ONLY.test(dateLike)) return dateLike;
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
};

export const todayIst = () => istDate(new Date());

export const fyOf = (dateLike) => {
  let ymd;
  try { ymd = istDate(dateLike); } catch { throw new Error("Invalid date for fiscal year"); }
  const m = DATE_ONLY.exec(ymd);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error("Invalid date for fiscal year");
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

export const fyStartDate = (fy) => new Date(Date.UTC(Number(fy.slice(0, 4)), 3, 1));
export const fyRange = (fy) => ({ from: `${Number(fy.slice(0, 4))}-04-01`, to: `${Number(fy.slice(0, 4)) + 1}-03-31` });

/** True when "YYYY-MM-DD" is a real calendar date (rejects 2026-02-30). */
export const isRealDate = (value) => {
  const m = DATE_ONLY.exec(String(value || ""));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/** Whole days from a to b on the IST calendar. */
export const daysBetween = (a, b) =>
  Math.round((Date.parse(`${istDate(b)}T00:00:00Z`) - Date.parse(`${istDate(a)}T00:00:00Z`)) / 86400000);

export const addDays = (ymd, n) => new Date(Date.parse(`${istDate(ymd)}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
