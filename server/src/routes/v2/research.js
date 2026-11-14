import express from "express";
import mongoose from "mongoose";
import { engineGet } from "../../services/engine.js";
import { fail, handle } from "./util.js";

const router = express.Router();

const EvalRun = mongoose.models.EvalRun || mongoose.model("EvalRun", new mongoose.Schema({
  id: { type: String, required: true }, groupId: { type: String, required: true },
  kind: String, datasetRef: String, result: mongoose.Schema.Types.Mixed,
  ranBy: String, note: String,
}, { timestamps: true }));

// GET /research/model-info — real committed artifacts (engine /v2/models/card:
// model cards + evaluation.json per task), not hard-coded figures. `status`
// is kept for older clients.
router.get("/model-info", handle(async (req, res) => {
  try {
    const [card, status] = await Promise.all([
      engineGet("/v2/models/card", { timeoutMs: 15000 }),
      engineGet("/v2/models/status").catch(() => null),
    ]);
    res.json({
      status: "available", source: "ml-fl-service/models/*/ (committed evaluation artifacts)",
      generatedAt: card.generatedAt, honesty: card.honesty,
      models: card.models, allocation: card.allocation, extraction: card.extraction,
      anomaly: card.anomaly, supplierDedupe: card.supplierDedupe, references: card.references,
      legacyStatus: status?.models ?? null,
    });
  } catch {
    res.json({
      model: "satya-reconciliation", status: "unavailable",
      note: "Engine model card unavailable — service may be restarting.",
    });
  }
}));

// GET /research/evaluation/:task — one task's committed evaluation report.
router.get("/evaluation/:task", handle(async (req, res) => {
  const task = String(req.params.task);
  if (!/^[a-zA-Z_]{3,40}$/.test(task)) throw fail(422, "VALIDATION_FAILED", "Unknown task");
  res.json(await engineGet(`/v2/evaluation/report?task=${encodeURIComponent(task)}`));
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
