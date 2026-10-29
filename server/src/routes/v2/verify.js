import express from "express";
import Document from "../../models/Document.js";
import Entity from "../../models/Entity.js";

const router = express.Router();

// GET /api/v2/verify/:hash — PUBLIC (02 §5.3): lets anyone holding a Satya
// PDF confirm it is genuine. Returns minimal non-sensitive fields only.
router.get("/:hash", async (req, res) => {
  const hash = String(req.params.hash);
  if (!/^[a-f0-9]{64}$/.test(hash)) return res.json({ valid: false });
  const doc = await Document.findOne({ contentHash: hash }).lean();
  if (!doc) return res.json({ valid: false });
  const entity = await Entity.findOne({ id: doc.entityId }).select("legalName tradeName").lean();
  res.json({
    valid: true,
    type: doc.type,
    number: doc.number,
    entityName: entity?.legalName || entity?.tradeName || null,
    date: doc.date,
    grandTotal: doc.totals?.grand ?? null,
    status: doc.status === "cancelled" ? "cancelled" : "issued",
  });
});

export default router;
