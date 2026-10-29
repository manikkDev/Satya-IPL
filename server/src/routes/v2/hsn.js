import express from "express";
import HsnMaster from "../../models/HsnMaster.js";
import { handle } from "./util.js";

const router = express.Router();

// GET /api/v2/hsn/search?q=&date= (02 §5.2): code prefix or description text;
// returns the effective rate by walking longest matching prefix rules for
// the requested date. Engine remains authoritative inside tax compute.
router.get("/search", handle(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
  if (!q) return res.json({ items: [] });
  const isCode = /^\d{2,8}$/.test(q);
  const filter = isCode ? { code: { $regex: `^${q}` } } : { description: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } };
  const docs = await HsnMaster.find(filter).sort({ code: 1 }).limit(15).lean();

  const items = docs.map((doc) => {
    // effective rate for this code on the date: its own rules, else walk
    // shorter prefixes — longest first is handled by the caller when the
    // prefix doc itself is fetched; here we surface the doc's own rules.
    const effective = (doc.rates || []).filter((r) => (!date || (r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo > date))));
    const best = effective.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    return {
      code: doc.code, description: doc.description, chapter: doc.chapter,
      rate: best?.rate ?? null, cessRate: best?.cessRate ?? null,
      effectiveFrom: best?.effectiveFrom ?? null, notificationRef: best?.notificationRef ?? null,
      conditional: best?.conditional ?? false,
    };
  });
  res.json({ items });
}));

export default router;
