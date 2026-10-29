import express from "express";
import { calculatePredictiveRiskAndSurvival } from "../utils/predictiveRiskService.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(protect);

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get("/", handle(async (req, res) => {
  const companyId = req.user.companyId;
  const result = await calculatePredictiveRiskAndSurvival(companyId);
  res.json(result);
}));

export default router;
