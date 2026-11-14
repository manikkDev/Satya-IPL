// Import API keys: "satk_" + 40 hex chars. Stored as SHA-256 only; the key
// authorises pushing files into the import pipeline for one entity.
import crypto from "node:crypto";
import ApiKey from "../models/ApiKey.js";
import { newId } from "../lib/ids.js";

export const KEY_PREFIX = "satk_";
export const hashKey = (plain) => crypto.createHash("sha256").update(String(plain)).digest("hex");

export const createApiKey = async ({ groupId, entityId, name, createdBy }) => {
  const plain = `${KEY_PREFIX}${crypto.randomBytes(20).toString("hex")}`;
  const doc = await ApiKey.create({ id: newId("key"), groupId, entityId, name: String(name).trim().slice(0, 80), prefix: plain.slice(0, 11), hash: hashKey(plain), scopes: ["import"], createdBy });
  return { key: plain, apiKey: doc.toObject() };
};

/** Resolve a presented key to its record (null when unknown/revoked). */
export const verifyApiKey = async (plain) => {
  if (typeof plain !== "string" || !plain.startsWith(KEY_PREFIX) || plain.length !== KEY_PREFIX.length + 40) return null;
  const rec = await ApiKey.findOne({ hash: hashKey(plain), revokedAt: { $exists: false } }).lean();
  if (!rec) return null;
  ApiKey.updateOne({ _id: rec._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  return rec;
};

export const keyView = (k) => ({ id: k.id, name: k.name, prefix: k.prefix, entityId: k.entityId, scopes: k.scopes, createdBy: k.createdBy, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null, revokedAt: k.revokedAt || null });
