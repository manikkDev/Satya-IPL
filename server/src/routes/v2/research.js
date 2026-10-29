import express from "express";
import mongoose from "mongoose";
import { engineGet } from "../../services/engine.js";
import { fail, handle } from "./util.js";

const router = express.Router();

const EvalRun = mongoose.model("EvalRun", new mongoose.Schema({
  id: { type: String, required: true }, groupId: { type: String, required: true },
  kind: String, datasetRef: String, result: mongoose.Schema.Types.Mixed,
  ranBy: String, note: String,
}, { timestamps: true }));

// GET /research/model-info — engine's published model card, proxied.
router.get("/model-info", handle(async (req, res) => {
  try {
    res.json(await engineGet("/v2/model-info"));
  } catch {
    res.json({
      model: "satya-reconciliation", status: "unavailable",
      note: "Engine model card unavailable — service may be restarting.",
    });
  }
}));

// POST /research/evaluations — record an eval run (group-scoped).
router.post("/evaluations", handle(async (req, res) => {
  const { kind, datasetRef, result, note } = req.body || {};
  if (!kind) throw fail(422, "VALIDATION_FAILED", "kind is required");
  const run = await EvalRun.create({ id: `eval_${Date.now()}`, groupId: req.scope.groupId, kind, datasetRef, result, note, ranBy: req.user.v2id || String(req.user._id) });
  res.status(201).json(run);
}));

router.get("/evaluations", handle(async (req, res) => {
  const items = await EvalRun.find({ groupId: req.scope.groupId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items });
}));

export default router;
