// Business dates for the curated seed. Everything is anchored to "today in
// IST" at seed time and expressed as days-ago, so the demo never drifts into
// the future and always sits inside the current Indian financial year
// (falling back into the previous FY only when the seed runs early in April).

const IST_OFFSET_MS = 330 * 60000;

// YYYY-MM-DD for the given instant, in Asia/Kolkata.
export const istDate = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Indian FY: "2026-27" for any date from 2026-04-01 to 2027-03-31.
export const fyOf = (iso) => {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};
export const fyShort = (fy) => fy.slice(2); // "2026-27" -> "26-27"
export const fyStart = (fy) => `${fy.slice(0, 4)}-04-01`;

// "2026-10-14" + "11:20" -> "2026-10-14T11:20:00+05:30"
export const istStamp = (iso, hhmm = "10:00") => `${iso}T${hhmm}:00+05:30`;
export const istInstant = (iso, hhmm = "10:00") => new Date(istStamp(iso, hhmm));

export const makeClock = (today = istDate()) => ({
  today,
  daysAgo: (n) => addDays(today, -n),
});
