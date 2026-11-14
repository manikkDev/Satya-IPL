// DB-backed unit tests (no HTTP server): run against a throwaway database on
// MONGO_TEST_URI (default mongodb://localhost:27017). Skipped when Mongo is
// unreachable so `npm test` stays usable offline.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI || "mongodb://localhost:27017";
const DB = `satya_unit_${process.pid}`;
let up = false;

before(async () => {
  try {
    await mongoose.connect(URI, { dbName: DB, serverSelectionTimeoutMS: 2000 });
    up = true;
  } catch { up = false; }
});
after(async () => {
  if (up) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});

test("audit chain stays linear under concurrent appends", async (t) => {
  if (!up) return t.skip("mongo unavailable");
  const { default: Audit } = await import("../src/models/Audit.js");
  await Audit.syncIndexes();
  const { writeAudit, verifyChain } = await import("../src/services/audit.js");
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    writeAudit({ groupId: "grp_t", actor: `u${i}`, action: `POST /x/${i}`, target: { id: `d${i}` }, statusCode: 200 })));
  assert.ok(results.every(Boolean));
  const seqs = (await Audit.find({ groupId: "grp_t" }).lean()).map((r) => r.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1));
  const verdict = await verifyChain("grp_t");
  assert.equal(verdict.valid, true);
  assert.equal(verdict.checked, 25);
  assert.equal(verdict.validSinceSequencing, true);
  // a legacy fork (two rows sharing one prevHash) is reported, not fatal to new rows
  const { default: AuditModel } = await import("../src/models/Audit.js");
  const crypto = await import("node:crypto");
  const mk = (id, prevHash, at) => {
    const event = { groupId: "grp_l", actor: "u", action: "x", prevHash, at };
    const canon = JSON.stringify(Object.fromEntries(Object.keys(event).sort().map((k) => [k, event[k]])));
    return { id, ...event, hash: crypto.createHash("sha256").update(prevHash + canon).digest("hex") };
  };
  const g = "0".repeat(64);
  const a = mk("a", g, "2026-01-01T00:00:00.000Z");
  await AuditModel.create(a);
  await AuditModel.create(mk("b", a.hash, "2026-01-01T00:00:01.000Z"));
  await AuditModel.create(mk("c", a.hash, "2026-01-01T00:00:02.000Z")); // fork
  await writeAudit({ groupId: "grp_l", actor: "u", action: "after", statusCode: 200 });
  const v2 = await verifyChain("grp_l");
  assert.equal(v2.valid, false);
  assert.equal(v2.legacy.forks, 1);
  assert.equal(v2.legacy.tampered, 0);
  assert.equal(v2.validSinceSequencing, true);
  assert.equal(v2.firstBreak.id, "c");
});

test("job runner recovers expired leases and dead-letters exhausted jobs", async (t) => {
  if (!up) return t.skip("mongo unavailable");
  const { default: Job } = await import("../src/models/Job.js");
  const { claimNext, reapExhausted, registerHandler, runClaimed } = await import("../src/jobs/runner.js");
  const past = new Date(Date.now() - 60000);
  await Job.create({ id: "job_stuck", kind: "t", status: "running", attempts: 1, maxAttempts: 5, leaseUntil: past, runAfter: past });
  await Job.create({ id: "job_spent", kind: "t", status: "running", attempts: 5, maxAttempts: 5, leaseUntil: past, runAfter: past });
  await Job.create({ id: "job_live", kind: "t", status: "running", attempts: 1, maxAttempts: 5, leaseUntil: new Date(Date.now() + 60000), runAfter: past });
  assert.equal(await reapExhausted(), 1);
  assert.equal((await Job.findOne({ id: "job_spent" })).status, "dead");
  const claimed = await claimNext();
  assert.equal(claimed.job.id, "job_stuck");
  assert.equal(claimed.job.attempts, 2);
  registerHandler("t", async () => ({ ok: true }));
  assert.equal(await runClaimed(claimed), "completed");
  assert.equal(await claimNext(), null); // live lease is not stolen
});

test("numbering issues a second doc type in the same FY", async (t) => {
  if (!up) return t.skip("mongo unavailable");
  const { default: Policy } = await import("../src/models/Policy.js");
  const { nextNumber } = await import("../src/services/numbering.js");
  await Policy.deleteMany({ entityId: "ent_n" });
  const a = await nextNumber("ent_n", "grp_n", "SATYA", "PO", "2026-27");
  const b = await nextNumber("ent_n", "grp_n", "SATYA", "PI_OUT", "2026-27");
  const c = await nextNumber("ent_n", "grp_n", "SATYA", "PO", "2026-27");
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 1);
  assert.equal(c.seq, 2);
  assert.ok(b.number.includes("PI"));
});
