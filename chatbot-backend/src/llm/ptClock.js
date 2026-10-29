// ptClock.js — Gemini daily quotas reset at midnight America/Los_Angeles.
// All key-pool "day" bookkeeping is done in Pacific Time, never server-local time.

const dtf = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const wallDtf = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const partsOf = (formatter, instant) => {
  const out = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
};

/** "YYYY-MM-DD" in Pacific Time for a given instant (Date | epoch ms). */
export function ptDayKey(instant = Date.now()) {
  const p = partsOf(dtf, instant instanceof Date ? instant : new Date(instant));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset (ms) of Pacific wall-clock relative to UTC at a given instant. */
function ptOffsetMs(instant) {
  const p = partsOf(wallDtf, instant);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - instant.getTime();
}

/**
 * ISO string of the next 00:00 Pacific Time strictly after `instant`.
 * Two fixed-point iterations absorb the (rare) DST offset change; PT
 * transitions happen at 02:00 so local midnight always exists.
 */
export function nextPtMidnightIso(instant = new Date()) {
  const p = partsOf(dtf, instant);
  // PT wall-clock target: 00:00 on the day after the current PT day.
  let guess = Date.UTC(p.year, p.month - 1, p.day + 1, 8, 0, 0); // UTC-8 ballpark
  for (let i = 0; i < 3; i++) {
    const offset = ptOffsetMs(new Date(guess));
    guess = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0) - offset;
  }
  return new Date(guess).toISOString();
}
