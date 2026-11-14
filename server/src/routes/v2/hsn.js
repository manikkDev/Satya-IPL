import express from "express";
import HsnMaster from "../../models/HsnMaster.js";
import { handle } from "./util.js";

const router = express.Router();

// Same resolution as the engine's HsnMaster.lookup (satya_engine/india/
// hsn_master.py): rules whose prefix is a prefix of the code and that are
// effective on the date; the LONGEST matching prefix wins; several rules at
// that length, or a conditional one, return rate null + candidates rather
// than an arbitrary pick. The rules hang off the HsnMaster doc whose code
// equals the rule prefix, so ancestors are fetched in one query.
export const resolveRate = (code, rulesByPrefix, date) => {
  const when = date || new Date().toISOString().slice(0, 10);
  const active = [];
  for (let len = code.length; len >= 2; len--) {
    for (const r of rulesByPrefix.get(code.slice(0, len)) || []) {
      if (r.effectiveFrom <= when && (!r.effectiveTo || when < r.effectiveTo)) active.push(r);
    }
  }
  if (!active.length) return null;
  const longest = Math.max(...active.map((r) => r.prefix.length));
  const matches = active.filter((r) => r.prefix.length === longest);
  const uncertain = matches.length !== 1 || matches.some((r) => r.conditional);
  const chosen = matches[0];
  return {
    rate: uncertain ? null : chosen.rate,
    cessRate: uncertain ? null : chosen.cessRate ?? null,
    effectiveFrom: chosen.effectiveFrom,
    notificationRef: chosen.notificationRef ?? null,
    conditional: uncertain,
    matchedPrefix: chosen.prefix,
    schedule: uncertain ? null : chosen.schedule ?? null,
    ...(uncertain ? {
      warning: "Rate depends on product details or overlapping rules - confirm against the notification",
      candidates: matches.map((r) => ({ prefix: r.prefix, rate: r.rate, schedule: r.schedule, sNo: r.sNo, conditional: Boolean(r.conditional) })),
    } : {}),
  };
};

const prefixesOf = (code) => {
  const out = [];
  for (let len = code.length; len >= 2; len--) out.push(code.slice(0, len));
  return out;
};

// GET /api/v2/hsn/search?q=&date= (02 §5.2): code prefix or description text;
// each item carries the effective rate resolved like the engine does.
router.get("/search", handle(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
  if (!q) return res.json({ items: [] });
  const isCode = /^\d{2,8}$/.test(q);
  const filter = isCode ? { code: { $regex: `^${q}` } } : { description: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } };
  filter.ruleOnly = { $ne: true };
  const docs = await HsnMaster.find(filter, { code: 1, description: 1, chapter: 1 }).sort({ code: 1 }).limit(15).lean();
  const ancestors = [...new Set(docs.flatMap((d) => prefixesOf(d.code)))];
  const ruleDocs = await HsnMaster.find({ code: { $in: ancestors }, "rates.0": { $exists: true } }, { code: 1, rates: 1 }).lean();
  const rulesByPrefix = new Map(ruleDocs.map((d) => [d.code, (d.rates || []).map((r) => ({ ...r, prefix: r.prefix || d.code }))]));

  const items = docs.map((doc) => {
    const r = resolveRate(doc.code, rulesByPrefix, date);
    return {
      code: doc.code, description: doc.description, chapter: doc.chapter,
      rate: r?.rate ?? null, cessRate: r?.cessRate ?? null,
      effectiveFrom: r?.effectiveFrom ?? null, notificationRef: r?.notificationRef ?? null,
      conditional: r?.conditional ?? false,
      // additive fields
      matchedPrefix: r?.matchedPrefix ?? null,
      ...(r?.candidates ? { candidates: r.candidates, warning: r.warning } : {}),
    };
  });
  res.json({ items });
}));

export default router;
