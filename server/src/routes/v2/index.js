import express from "express";
import metaRoutes from "./meta.js";
import authRoutes from "./auth.js";
import meRoutes from "./me.js";
import entitiesRoutes from "./entities.js";
import suppliersRoutes from "./suppliers.js";
import itemsRoutes from "./items.js";
import hsnRoutes from "./hsn.js";
import policiesRoutes from "./policies.js";
import { authenticateV2, loadScope } from "../../auth/middleware.js";

const router = express.Router();

// Public: feature flags, health, login/signup/switch-group.
router.use("/meta", metaRoutes);
router.use("/auth", authRoutes);

// Everything below requires a v2 session + resolved group scope.
router.use(authenticateV2, loadScope);
router.use("/me", meRoutes);
router.use("/entities", entitiesRoutes);
router.use("/suppliers", suppliersRoutes);
router.use("/items", itemsRoutes);
router.use("/hsn", hsnRoutes);
router.use("/policies", policiesRoutes);

export default router;
