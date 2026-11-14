import crypto from "node:crypto";
import Job from "../models/Job.js";
import { newId } from "../lib/ids.js";

// Mongo-backed job runner (04 P2-B6): one runner per process, lease +
// exponential backoff (max attempts -> dead), safe on Render restarts.
//
// A job is claimable when it is queued and due, OR "running" with an expired
// lease (the process holding it died — free instances are recycled
// mid-job). The lease is renewed while a handler runs so a long reconcile is
// never stolen; a job whose attempts are exhausted is dead-lettered.
const handlers = new Map();
export const registerHandler = (kind, fn) => handlers.set(kind, fn);

export const LEASE_MS = 120000;
const HEARTBEAT_MS = 30000;
const IDLE_POLL_MS = 3000;
const MAX_IDLE_POLL_MS = 15000;

export const enqueue = async (kind, payload, groupId) =>
  Job.create({ id: newId("job"), kind, payload, groupId, status: "queued", runAfter: new Date() });

const backoffMs = (attempts) => Math.min(60000, 2000 * 2 ** attempts) + Math.floor(Math.random() * 1000);

/** Dead-letter running jobs whose lease expired on their final attempt. */
export const reapExhausted = async (now = new Date()) => {
  const res = await Job.updateMany(
    { status: "running", leaseUntil: { $lt: now }, $expr: { $gte: ["$attempts", "$maxAttempts"] } },
    { $set: { status: "dead", error: "Worker lease expired on the final attempt (process restarted mid-job)" }, $unset: { workerToken: "", leaseUntil: "" } },
  );
  return res.modifiedCount || 0;
};

/** Claim the next due job: queued, or running with an expired lease. */
export const claimNext = async (now = new Date()) => {
  const workerToken = crypto.randomUUID();
  const job = await Job.findOneAndUpdate(
    {
      $or: [
        { status: "queued", runAfter: { $lte: now } },
        { status: "running", leaseUntil: { $lt: now } },
      ],
      $expr: { $lt: ["$attempts", "$maxAttempts"] },
    },
    { $set: { status: "running", workerToken, leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { returnDocument: "after", sort: { runAfter: 1, createdAt: 1 } }
  );
  return job ? { job, workerToken } : null;
};

export const runClaimed = async ({ job, workerToken }) => {
  const handler = handlers.get(job.kind);
  const heartbeat = setInterval(() => {
    Job.updateOne({ _id: job._id, workerToken, status: "running" }, { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }).catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    if (!handler) throw Object.assign(new Error(`No handler for job kind ${job.kind}`), { status: 422 });
    const result = await handler(job.payload, job);
    await Job.updateOne({ _id: job._id, workerToken }, { $set: { status: "completed", result, progress: 100 }, $unset: { leaseUntil: "" } });
    return "completed";
  } catch (error) {
    const dead = job.attempts >= job.maxAttempts || [400, 403, 404, 409, 422].includes(error.status);
    await Job.updateOne(
      { _id: job._id, workerToken },
      {
        $set: { status: dead ? "dead" : "queued", error: String(error.message || error).slice(0, 1000), ...(dead ? {} : { runAfter: new Date(Date.now() + backoffMs(job.attempts)) }) },
        $unset: { leaseUntil: "" },
      }
    );
    if (dead) console.warn(`[jobs] ${job.kind} ${job.id} dead-lettered after ${job.attempts} attempt(s): ${error.message}`);
    return dead ? "dead" : "retry";
  } finally {
    clearInterval(heartbeat);
  }
};

export const tick = async () => {
  await reapExhausted();
  const claimed = await claimNext();
  if (!claimed) return false;
  await runClaimed(claimed);
  return true;
};

export const startJobRunner = () => {
  let delay = IDLE_POLL_MS;
  const loop = async () => {
    try {
      const worked = await tick();
      delay = worked ? 250 : Math.min(MAX_IDLE_POLL_MS, delay + 1000);
    } catch (e) {
      console.error("job runner:", e.message);
      delay = MAX_IDLE_POLL_MS;
    }
    setTimeout(loop, delay).unref?.();
  };
  loop();
};
