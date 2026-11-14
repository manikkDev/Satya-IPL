import crypto from "node:crypto";
import Audit from "../models/Audit.js";
import { newId } from "../lib/ids.js";

const GENESIS = "0".repeat(64);
const MAX_APPEND_ATTEMPTS = 12;

// deterministic JSON: sort object keys recursively
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
};
const canonical = (e) => JSON.stringify(canon(e));
const hashOf = (prevHash, event) => crypto.createHash("sha256").update(prevHash + canonical(event)).digest("hex");

// Head of a group's chain: highest sequenced row, else newest legacy
// (pre-sequence) row, else genesis.
const headOf = async (groupId) => {
  const last = await Audit.findOne({ groupId, seq: { $type: "number" } }).sort({ seq: -1 }).select("seq hash").lean();
  if (last) return { seq: last.seq, hash: last.hash };
  const legacy = await Audit.findOne({ groupId }).sort({ createdAt: -1 }).select("hash").lean();
  return { seq: 0, hash: legacy?.hash || GENESIS };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Append a hash-chained audit event (04 P3-B9). Appends are serialised per
// group by a monotonically increasing `seq` with a unique (groupId, seq)
// index: concurrent writers that read the same head race for the same seq,
// the loser gets E11000 and re-reads the head — the chain can't fork.
// Never breaks the request.
export const writeAudit = async ({ groupId, entityId, actor, actorRole, action, target, statusCode, ip }) => {
  try {
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const head = await headOf(groupId);
      // JSON round-trip = exactly what Mongo stores (undefined keys dropped)
      const event = JSON.parse(JSON.stringify({ groupId, entityId, actor, actorRole, action, target, statusCode, ip, seq: head.seq + 1, prevHash: head.hash, at: new Date().toISOString() }));
      try {
        await Audit.create({ id: newId("evd"), ...event, hash: hashOf(head.hash, event) });
        return true;
      } catch (error) {
        if (error?.code !== 11000) throw error;
        await sleep(5 + Math.floor(Math.random() * 20 * (attempt + 1)));
      }
    }
    console.warn(`audit write skipped: ${groupId} chain contended for ${MAX_APPEND_ATTEMPTS} attempts`);
    return false;
  } catch (e) {
    console.warn("audit write skipped:", e.message);
    return false;
  }
};

// Re-walk the chain: legacy rows (no seq) by time, then sequenced rows by
// seq. Each hash must equal sha256(prevHash | event) and link to the previous.
export const verifyChain = async (groupId) => {
  const legacy = await Audit.find({ groupId, seq: { $not: { $type: "number" } } }).sort({ createdAt: 1, _id: 1 }).lean();
  const sequenced = await Audit.find({ groupId, seq: { $type: "number" } }).sort({ seq: 1 }).lean();
  const rows = [...legacy, ...sequenced];
  let prev = GENESIS;
  for (const [i, row] of rows.entries()) {
    const { id: _id2, hash, _id, __v, createdAt, updatedAt, ...event } = row;
    if (hashOf(prev, event) !== hash || row.prevHash !== prev) return { valid: false, brokenAt: row.id, checked: i };
    prev = hash;
  }
  return { valid: true, checked: rows.length };
};
