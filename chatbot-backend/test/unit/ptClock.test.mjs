import { test } from "node:test";
import assert from "node:assert/strict";
import { ptDayKey, nextPtMidnightIso } from "../../src/llm/ptClock.js";

test("ptDayKey uses America/Los_Angeles, not server-local time", () => {
  // 2026-10-30T05:30:00Z = 2026-10-29 22:30 PDT (UTC-7)
  assert.equal(ptDayKey(Date.parse("2026-10-30T05:30:00Z")), "2026-10-29");
  // 2026-10-30T07:30:00Z = 2026-10-30 00:30 PDT
  assert.equal(ptDayKey(Date.parse("2026-10-30T07:30:00Z")), "2026-10-30");
});

test("nextPtMidnightIso returns the next 00:00 Pacific instant", () => {
  // PDT is UTC-7 in October → PT midnight 2026-10-30 = 2026-10-30T07:00:00Z
  const iso = nextPtMidnightIso(new Date("2026-10-29T20:00:00Z"));
  assert.equal(iso, "2026-10-30T07:00:00.000Z");
  // Already past that PT midnight → rolls to the following one
  const iso2 = nextPtMidnightIso(new Date("2026-10-30T08:00:00Z"));
  assert.equal(iso2, "2026-10-31T07:00:00.000Z");
});

test("midnight crossing back into PST (Nov 1 2026) yields UTC-8", () => {
  // PST is UTC-8 → PT midnight 2026-11-02 = 2026-11-02T08:00:00Z
  const iso = nextPtMidnightIso(new Date("2026-11-01T20:00:00Z"));
  assert.equal(iso, "2026-11-02T08:00:00.000Z");
});
