import express from "express";
import metaRoutes from "./meta.js";

const router = express.Router();
router.use("/meta", metaRoutes);

export default router;
