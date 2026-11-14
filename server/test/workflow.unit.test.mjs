import test from "node:test";
import assert from "node:assert/strict";
import { scoreSupplier, bandFor } from "../src/services/riskScore.js";
import { quietHoursRelease, shareLink } from "../src/services/outbox.js";
import { csvCell } from "../src/routes/v2/workflow.js";

const cleanSupplier = {
  id: "sup_1", legalName: "Clean Valves Pvt Ltd",
  gstins: [{ gstin: "27AAACS5678B1ZC" }],
  bankAccounts: [{ status: "active" }],
  msme: true, udyam: { number: "UDYAM-MH-19-0012345", category: "small" },
};

test("risk score: clean supplier scores low with no factors", () => {
  const r = scoreSupplier({ supplier: cleanSupplier });
  assert.equal(r.score, 0);
  assert.equal(r.band, "low");
  assert.deepEqual(r.factors, []);
});

test("risk score: every point is explained by a factor", () => {
  const r = scoreSupplier({
    supplier: { ...cleanSupplier, gstins: [{ gstin: "27AAACS5678B1Z3" }], bankAccounts: [] },
    findings: [
      { status: "open", severity: "critical", code: "DUPLICATE_INVOICE" },
      { status: "open", severity: "high", code: "PRICE_VARIANCE" },
      { status: "resolved", severity: "critical", code: "X" },
    ],
  });
  assert.equal(r.score, r.factors.reduce((s, f) => s + f.points, 0));
  assert.equal(r.openIssues, 2);
  assert.ok(r.factors.some((f) => /checksum/i.test(f.label)));
  assert.equal(r.band, bandFor(r.score));
  assert.ok(r.score <= 100);
});

test("quiet hours: emails between 22:00 and 08:00 IST wait until 08:00 IST", () => {
  // 23:30 IST = 18:00 UTC
  const late = quietHoursRelease(new Date("2026-11-14T18:00:00Z"));
  assert.equal(late.toISOString(), "2026-11-15T02:30:00.000Z"); // 08:00 IST next day
  // 06:00 IST = 00:30 UTC same day
  const early = quietHoursRelease(new Date("2026-11-15T00:30:00Z"));
  assert.equal(early.toISOString(), "2026-11-15T02:30:00.000Z");
  // 14:00 IST = 08:30 UTC — no delay
  assert.equal(quietHoursRelease(new Date("2026-11-15T08:30:00Z")), null);
});

test("share links: Indian mobiles default to +91 and text is encoded", () => {
  assert.equal(shareLink("whatsapp", "98220 41105", "Hi & bye"), "https://wa.me/919822041105?text=Hi%20%26%20bye");
  assert.equal(shareLink("sms", "+91 98220 41105", "ok"), "sms:+919822041105?body=ok");
});

test("csv cells are formula-safe and quoted", () => {
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("-15000"), "'-15000");
  assert.equal(csvCell('He said "hi", ok'), '"He said ""hi"", ok"');
  assert.equal(csvCell(null), "");
});
