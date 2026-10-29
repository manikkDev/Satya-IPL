import express from "express";
import { evaluateContractContradictions, seedContractObligations } from "../utils/contractIntelligenceService.js";
import { ContractAgreement, ContractObligation } from "../models/Business.js";
import { protect } from "../middleware/authMiddleware.js";
import { recordAudit } from "../utils/audit.js";
import { generateExecutiveReportPdf } from "../utils/pdfReportService.js";

const router = express.Router();
router.use(protect);

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get("/report/pdf", handle(async (req, res) => {
  const companyId = req.user.companyId;
  const result = await evaluateContractContradictions(companyId);
  const pdfBuffer = await generateExecutiveReportPdf({
    title: "BPCI Legal Clause Contradiction & Compliance Brief",
    subtitle: "Formal Contract Supersession Analysis — BPCI-MOU-2026-ENG & ADDENDUM-BPCI-2026-01",
    contractData: result,
    companyName: req.user.companyId === "satya-demo" ? "Bharat Petroleum Procurement & Infrastructure (BPCI)" : req.user.companyId
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="BPCI_Legal_MOU_Clearance_Report_${Date.now()}.pdf"`);
  res.send(pdfBuffer);
}));

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
