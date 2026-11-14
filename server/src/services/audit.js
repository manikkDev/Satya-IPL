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
//
// Legacy rows were appended without serialisation, so concurrent requests
// could fork that segment (two rows sharing one prevHash) — that is a known
// artefact, not tampering. The walk therefore reports the two segments
// separately: `legacy` (every break listed, classified as "fork" when the
// row correctly hashes its own prevHash but that prevHash isn't the previous
// row, or "tampered" when the row's own hash doesn't match its content) and
// `sequenced` (rows written since serialisation, anchored at their first
// row's prevHash). Top-level valid/brokenAt/checked keep the old meaning
// (whole chain); `validSinceSequencing` is what to trust going forward.
const rowEvent = (row) => {
  const { id: _id2, hash, _id, __v, createdAt, updatedAt, ...event } = row;
  return event;
};
const describe = (row, index, kind) => ({ id: row.id, index, seq: row.seq ?? null, at: row.at, action: row.action, kind });

export const verifyChain = async (groupId) => {
  const legacy = await Audit.find({ groupId, seq: { $not: { $type: "number" } } }).sort({ createdAt: 1, _id: 1 }).lean();
  const sequenced = await Audit.find({ groupId, seq: { $type: "number" } }).sort({ seq: 1 }).lean();

  const legacyBreaks = [];
  let prev = GENESIS;
  for (const [i, row] of legacy.entries()) {
    const selfOk = hashOf(row.prevHash, rowEvent(row)) === row.hash;
    if (!selfOk) legacyBreaks.push(describe(row, i, "tampered"));
    else if (row.prevHash !== prev) legacyBreaks.push(describe(row, i, "fork"));
    prev = row.hash;
  }

  let seqBreak = null;
  let anchor = sequenced[0]?.prevHash ?? null;
  for (const [i, row] of sequenced.entries()) {
    if (hashOf(row.prevHash, rowEvent(row)) !== row.hash) { seqBreak = describe(row, legacy.length + i, "tampered"); break; }
    if (row.prevHash !== anchor || (i > 0 && row.seq !== sequenced[i - 1].seq + 1)) { seqBreak = describe(row, legacy.length + i, "gap"); break; }
    anchor = row.hash;
  }
  const anchoredOnLegacyHead = !sequenced.length || !legacy.length || sequenced[0].prevHash === legacy[legacy.length - 1].hash;

  const firstBreak = legacyBreaks[0] || seqBreak || (!anchoredOnLegacyHead ? describe(sequenced[0], legacy.length, "gap") : null);
  const total = legacy.length + sequenced.length;
  return {
    valid: !firstBreak,
    checked: firstBreak ? firstBreak.index : total,
    ...(firstBreak ? { brokenAt: firstBreak.id, firstBreak } : {}),
    total,
    validSinceSequencing: !seqBreak,
    legacy: { checked: legacy.length, valid: !legacyBreaks.length, breaks: legacyBreaks.length, forks: legacyBreaks.filter((b) => b.kind === "fork").length, tampered: legacyBreaks.filter((b) => b.kind === "tampered").length, items: legacyBreaks.slice(0, 20) },
    sequenced: { checked: sequenced.length, valid: !seqBreak, anchoredOnLegacyHead, ...(seqBreak ? { brokenAt: seqBreak } : {}) },
    explanation: legacyBreaks.length && !legacyBreaks.some((b) => b.kind === "tampered")
      ? "Rows written before audit appends were serialised contain forks from concurrent requests (each row's own hash is intact). Rows since serialisation verify independently."
      : undefined,
  };
};
