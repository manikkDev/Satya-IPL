import express from "express";
import { evaluateContractContradictions, seedContractObligations } from "../utils/contractIntelligenceService.js";
import { ContractAgreement, ContractObligation } from "../models/Business.js";
import { protect } from "../middleware/authMiddleware.js";
import { recordAudit } from "../utils/audit.js";

const router = express.Router();
router.use(protect);

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get("/", handle(async (req, res) => {
  const companyId = req.user.companyId;
  const count = await ContractAgreement.countDocuments({ companyId });
  if (count === 0) {
    await seedContractObligations(companyId);
  }
  const result = await evaluateContractContradictions(companyId);
  res.json(result);
}));

router.post("/seed", handle(async (req, res) => {
  const companyId = req.user.companyId;
  await seedContractObligations(companyId);
  const result = await evaluateContractContradictions(companyId);
  res.status(201).json(result);
}));

router.post("/obligations/:id/status", handle(async (req, res) => {
  const companyId = req.user.companyId;
  const { status, notes } = req.body;
  if (!["satisfied", "pending", "waived", "disputed_superseded"].includes(status)) {
    return res.status(422).json({ message: "Invalid status value" });
  }

  const updated = await ContractObligation.findOneAndUpdate(
    { companyId, id: req.params.id },
    { $set: { status, disputeReason: notes || undefined } },
    { returnDocument: "after" }
  );

  if (!updated) return res.status(404).json({ message: "Obligation not found" });
  await recordAudit({ req, action: "contract.obligation_status_update", target: req.params.id, meta: { status, notes } });
  res.json({ obligation: updated });
}));

export default router;
