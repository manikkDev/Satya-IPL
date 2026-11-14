// Lightweight in-process scheduler for the daily re-check.
//
// Every few minutes each API process tries to take a Mongo lease for
// "daily-recheck"; only one process wins per IST day (lastRunDay guard +
// lease expiry), so restarts and multiple instances never double-run it and
// a process that dies mid-run is retried after the lease expires.
//
// The re-check itself only ENQUEUES work: debounced reconcile jobs for open
// cases (staggered, capped per day) so date-based findings — MSME/43B(h)
// deadlines, Rule 37 180-day, e-invoice 30-day reporting — refresh as the
// calendar moves, plus a GSTR-2B re-match per entity so "awaiting 2B"
// invoices become "missing from 2B" once a later period is imported.
import crypto from "node:crypto";
import mongoose from "mongoose";
import Case from "../models/Case.js";
import Document from "../models/Document.js";
import { todayIst } from "../lib/fy.js";
import { enqueueReconcileDebounced } from "../services/autoChecks.js";
import { runGstr2bMatch } from "../services/gstr2bMatch.js";

const LEASE_MS = 10 * 60 * 1000;
const TICK_MS = Number(process.env.SCHEDULER_TICK_MS || 5 * 60 * 1000);
const MAX_CASES = Number(process.env.DAILY_RECHECK_MAX_CASES || 400);
const STAGGER_MS = Number(process.env.DAILY_RECHECK_STAGGER_MS || 4000);
const RUN_AFTER_IST_HOUR = Number(process.env.DAILY_RECHECK_IST_HOUR ?? 2);
const OPEN = ["open", "in_review", "escalated", "on_hold"];

const leases = () => mongoose.connection.db.collection("scheduler_leases");
const istHour = () => new Date(Date.now() + 330 * 60000).getUTCHours();

/** Try to take today's lease for `key`. Returns owner token or null. */
export const claimDaily = async (key, now = new Date(), day = todayIst()) => {
  const owner = crypto.randomUUID();
  try {
    const res = await leases().findOneAndUpdate(
      { _id: key, lastRunDay: { $ne: day }, $or: [{ leaseUntil: { $lt: now } }, { leaseUntil: { $exists: false } }, { leaseUntil: null }] },
      { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), owner, day } },
      { upsert: true, returnDocument: "after" },
    );
    const doc = res?.value !== undefined ? res.value : res;
    return doc?.owner === owner ? owner : null;
  } catch (e) {
    if (e?.code === 11000) return null; // someone else holds it / already ran today
    throw e;
  }
};

export const finishDaily = (key, owner, day, result) =>
  leases().updateOne({ _id: key, owner }, { $set: { lastRunDay: day, leaseUntil: null, lastResult: result, lastRunAt: new Date() } });

/** The daily re-check (exported for tests / manual runs). */
export const dailyRecheck = async ({ maxCases = MAX_CASES } = {}) => {
  const started = Date.now();
  const staleBefore = new Date(Date.now() - 20 * 3600 * 1000);
  let queued = 0;
  const cursor = Case.find({ status: { $in: OPEN }, updatedAt: { $lt: staleBefore } }, { id: 1, groupId: 1 }).sort({ updatedAt: 1 }).limit(maxCases).lean().cursor({ batchSize: 100 });
  for await (const c of cursor) {
    await enqueueReconcileDebounced(c.groupId, c.id, 5000 + queued * STAGGER_MS);
    queued++;
  }
  // GSTR-2B re-match for entities with 2B data (cheap, bounded per entity)
  const pairs = await Document.aggregate([{ $match: { type: "GSTR2B_ENTRY" } }, { $group: { _id: { g: "$groupId", e: "$entityId" } } }, { $limit: 200 }]);
  let matched = 0;
  for (const p of pairs) {
    try { await runGstr2bMatch({ groupId: p._id.g, entityId: p._id.e }); matched++; } catch (e) { console.warn(`[scheduler] 2B re-match ${p._id.e}: ${e.message}`); }
  }
  return { casesQueued: queued, gstr2bEntities: matched, ms: Date.now() - started };
};

let timer = null;
export const startScheduler = () => {
  if (timer || process.env.SCHEDULER_DISABLED === "1") return;
  const tick = async () => {
    try {
      if (mongoose.connection.readyState !== 1 || istHour() < RUN_AFTER_IST_HOUR) return;
      const day = todayIst();
      const owner = await claimDaily("daily-recheck", new Date(), day);
      if (!owner) return;
      const result = await dailyRecheck();
      await finishDaily("daily-recheck", owner, day, result);
      console.log(`[scheduler] daily re-check: ${result.casesQueued} case(s) queued, ${result.gstr2bEntities} 2B entity re-match(es)`);
    } catch (e) {
      console.warn(`[scheduler] daily re-check failed (will retry after lease expiry): ${e.message}`);
    }
  };
  // first attempt shortly after boot, then every TICK_MS
  setTimeout(tick, 30000).unref?.();
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
};
export const stopScheduler = () => { if (timer) clearInterval(timer); timer = null; };
