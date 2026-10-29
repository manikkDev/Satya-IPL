import express from "express";
import metaRoutes from "./meta.js";
import authRoutes from "./auth.js";
import meRoutes from "./me.js";
import entitiesRoutes from "./entities.js";
import suppliersRoutes from "./suppliers.js";
import itemsRoutes from "./items.js";
import hsnRoutes from "./hsn.js";
import policiesRoutes from "./policies.js";
import documentsRoutes from "./documents.js";
import verifyRoutes from "./verify.js";
import filesRoutes from "./files.js";
import ingestRoutes from "./ingest.js";
import casesRoutes from "./cases.js";
import Job from "../../models/Job.js";
import { authenticateV2, loadScope } from "../../auth/middleware.js";

const router = express.Router();

// Public: feature flags, health, login/signup/switch-group, document verify.
router.use("/meta", metaRoutes);
router.use("/auth", authRoutes);
router.use("/verify", verifyRoutes);

// Everything below requires a v2 session + resolved group scope.
router.use(authenticateV2, loadScope);
router.use("/me", meRoutes);
router.use("/entities", entitiesRoutes);
router.use("/suppliers", suppliersRoutes);
router.use("/items", itemsRoutes);
router.use("/hsn", hsnRoutes);
router.use("/policies", policiesRoutes);
router.use("/documents", documentsRoutes);
router.use("/files", filesRoutes);
router.use("/ingest", ingestRoutes);
router.use("/cases", casesRoutes);

// GET /api/v2/jobs/:id — job polling (02 §5.5)
router.get("/jobs/:id", async (req, res, next) => {
  try {
    const job = await Job.findOne({ id: req.params.id, groupId: req.scope.groupId }).lean();
    if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    res.json(job);
  } catch (e) { next(e); }
});

export default router;
