import express from "express";
import { allFlags } from "../../lib/flags.js";

const router = express.Router();

// Public: the client reads resolved flags once at boot to gate v2 UI.
router.get("/flags", (_req, res) => res.json({ flags: allFlags() }));

export default router;
