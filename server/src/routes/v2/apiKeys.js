// /api/v2/import/api-keys — manage import API keys (session-authenticated).
import express from "express";
import ApiKey from "../../models/ApiKey.js";
import { scopeAllows } from "../../auth/rbac.js";
import { createApiKey, keyView } from "../../services/apiKeys.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const actor = (req) => req.user.v2id || String(req.user._id);
const MAX_ACTIVE = 10;

router.get("/", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "import.data")) throw fail(403, "FORBIDDEN", "Your role cannot manage import keys", { reason: "Requires import.data" });
  const keys = await ApiKey.find({ groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items: keys.map(keyView) });
}));

router.post("/", handle(async (req, res) => {
  assertPlainInput(req.body || {});
  const entityId = String(req.body?.entityId || (req.scope.entityIds.length === 1 ? req.scope.entityIds[0] : ""));
  if (!entityId || !req.scope.entityIds.includes(entityId)) throw fail(404, "NOT_FOUND", "Entity not found");
  if (!scopeAllows(req.scope, "import.data", entityId)) throw fail(403, "FORBIDDEN", "Your role cannot create import keys", { reason: "Requires import.data" });
  const name = String(req.body?.name || "").trim();
  if (name.length < 2) throw fail(422, "VALIDATION_FAILED", "Give the key a name, e.g. \"Tally connector — accounts PC\"");
  const active = await ApiKey.countDocuments({ groupId: req.scope.groupId, revokedAt: { $exists: false } });
  if (active >= MAX_ACTIVE) throw fail(422, "VALIDATION_FAILED", `At most ${MAX_ACTIVE} active keys — revoke one first`);
  const { key, apiKey } = await createApiKey({ groupId: req.scope.groupId, entityId, name, createdBy: actor(req) });
  // the plaintext key is returned exactly once
  res.status(201).json({ ...keyView(apiKey), key, note: "Copy this key now — Satya stores only a hash and cannot show it again." });
}));

router.delete("/:id", handle(async (req, res) => {
  const k = await ApiKey.findOne({ groupId: req.scope.groupId, id: req.params.id });
  if (!k || !req.scope.entityIds.includes(k.entityId)) throw fail(404, "NOT_FOUND", "Key not found");
  if (!scopeAllows(req.scope, "import.data", k.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot revoke import keys");
  if (!k.revokedAt) { k.revokedAt = new Date(); k.revokedBy = actor(req); await k.save(); }
  res.json(keyView(k.toObject()));
}));

export default router;
