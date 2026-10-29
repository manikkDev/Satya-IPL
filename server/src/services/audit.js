import crypto from "node:crypto";
import Audit from "../models/Audit.js";
import { newId } from "../lib/ids.js";

const GENESIS = "0".repeat(64);

// deterministic JSON: sort object keys recursively
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
};
const canonical = (e) => JSON.stringify(canon(e));

// Append a hash-chained audit event (04 P3-B9). Never breaks the request.
export const writeAudit = async ({ groupId, entityId, actor, actorRole, action, target, statusCode, ip }) => {
  try {
    const prev = await Audit.findOne({ groupId }).sort({ createdAt: -1 }).select("hash").lean();
    const prevHash = prev?.hash || GENESIS;
    const event = { groupId, entityId, actor, actorRole, action, target, statusCode, ip, prevHash, at: new Date().toISOString() };
    const hash = crypto.createHash("sha256").update(prevHash + canonical(event)).digest("hex");
    await Audit.create({ id: newId("evd"), ...event, hash });
  } catch (e) {
    console.warn("audit write skipped:", e.message);
  }
};

// Re-walk the chain: each row's hash must equal sha256(prevHash | event).
export const verifyChain = async (groupId) => {
  const rows = await Audit.find({ groupId }).sort({ createdAt: 1 }).lean();
  let prev = GENESIS;
  for (const row of rows) {
    const { id: _id2, hash, _id, __v, createdAt, updatedAt, ...event } = row;
    const computed = crypto.createHash("sha256").update(prev + canonical(event)).digest("hex");
    if (computed !== hash || row.prevHash !== prev) return { valid: false, brokenAt: row.id, checked: rows.indexOf(row) };
    prev = hash;
  }
  return { valid: true, checked: rows.length };
};
