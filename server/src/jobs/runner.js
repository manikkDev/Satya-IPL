import crypto from "node:crypto";
import Job from "../models/Job.js";
import { newId } from "../lib/ids.js";

// Mongo-backed job runner (04 P2-B6): one runner per process, lease +
// exponential backoff (max 5 attempts -> dead), safe on Render restarts.
const handlers = new Map();
export const registerHandler = (kind, fn) => handlers.set(kind, fn);

export const enqueue = async (kind, payload, groupId) =>
  Job.create({ id: newId("job"), kind, payload, groupId, status: "queued", runAfter: new Date() });

const backoffMs = (attempts) => Math.min(60000, 2000 * 2 ** attempts) + Math.floor(Math.random() * 1000);

export const startJobRunner = () => {
  const tick = async () => {
    const workerToken = crypto.randomUUID();
    const job = await Job.findOneAndUpdate(
      { status: "queued", runAfter: { $lte: new Date() } },
      { $set: { status: "running", workerToken, leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } },
      { returnDocument: "after", sort: { createdAt: 1 } }
    );
    if (!job) return;
    const handler = handlers.get(job.kind);
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
      const result = await handler(job.payload, job);
      await Job.updateOne({ _id: job._id, workerToken }, { $set: { status: "completed", result, progress: 100 } });
    } catch (error) {
      const dead = job.attempts >= job.maxAttempts || [400, 403, 404, 409, 422].includes(error.status);
      await Job.updateOne(
        { _id: job._id, workerToken },
        { $set: { status: dead ? "dead" : "queued", error: error.message, ...(dead ? {} : { runAfter: new Date(Date.now() + backoffMs(job.attempts)) }) } }
      );
    }
  };
  const loop = async () => { try { await tick(); } catch (e) { console.error("job runner:", e.message); } setTimeout(loop, 3000); };
  loop();
};
