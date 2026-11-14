import express from "express";
import multer from "multer";
import Document from "../../models/Document.js";
import ImportRun from "../../models/ImportRun.js";
import Finding from "../../models/Finding.js";
import Job from "../../models/Job.js";
import { newId } from "../../lib/ids.js";
import { fyOf, isRealDate } from "../../lib/fy.js";
import { toPaise, toDecimal, fromPaise, sum } from "../../lib/money.js";
import { PAYMENT_MODES } from "../../lib/docSchemas.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle, assertPlainInput } from "./util.js";
import { previewImport, commitImport, permissionFor, SOURCES, flattenGstr2b } from "../../services/importers/index.js";
import { TEMPLATES, templateRows } from "../../services/importers/templates.js";
import { toCsv } from "../../services/importers/csv.js";
import { buildXlsx } from "../../services/importers/xlsx.js";
import { detectBankLayout, readBankRows } from "../../services/importers/bank.js";
import { scheduleAutoCheck } from "../../services/autoChecks.js";
import { runGstr2bMatch } from "../../services/gstr2bMatch.js";
import apiKeysRouter from "./apiKeys.js";

const router = express.Router();
const MODE_ALIASES = { CHQ: "CHEQUE", CHECK: "CHEQUE", "CHEQUE/DD": "CHEQUE", DD: "CHEQUE", "NEFT/RTGS": "NEFT", FT: "OTHER", TRANSFER: "OTHER" };
const actor = (req) => req.user.v2id || String(req.user._id);
const canImport = (req) => {
  if (!scopeAllows(req.scope, "doc.upload", req.body?.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot import documents", { reason: "Requires doc.upload" });
};
const MAX_MB = Number(process.env.IMPORT_MAX_MB || 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

const entityFor = (req, entityId) => {
  const id = String(entityId || (req.scope.entityIds.length === 1 ? req.scope.entityIds[0] : ""));
  if (!id) throw fail(422, "VALIDATION_FAILED", "entityId is required");
  if (!req.scope.entityIds.includes(id)) throw fail(404, "NOT_FOUND", "Entity not found");
  return id;
};
const requireImportPerm = (req, source, entityId) => {
  const perm = permissionFor(source);
  if (!scopeAllows(req.scope, perm, entityId)) throw fail(403, "FORBIDDEN", "Your role cannot run this import", { reason: `Requires ${perm}` });
};

// ---------- sources & templates ----------

const SOURCE_INFO = [
  { source: "tally_xml", label: "TallyPrime XML", accepts: [".xml"], help: "Day Book or voucher export (Purchase Order, Receipt Note, Purchase, Rejections Out, Debit Note, Payment) and ledger/stock-item masters." },
  { source: "bank_statement", label: "Bank statement", accepts: [".csv", ".xlsx", ".sta", ".txt", ".940"], help: "CSV/XLSX exports from HDFC, ICICI, SBI, Axis, Kotak and most banks (columns auto-detected) or MT940." },
  { source: "gstr2b_json", label: "GSTR-2B JSON", accepts: [".json"], help: "GST portal > Returns > GSTR-2B > Download JSON. Matched to purchase invoices automatically." },
  ...Object.entries(TEMPLATES).map(([kind, t]) => ({ source: `template:${kind}`, label: t.label, accepts: [".csv", ".xlsx"], template: kind, help: "Use the template headings; extra columns are ignored." })),
];

router.get("/sources", handle(async (req, res) => {
  res.json({ items: SOURCE_INFO, maxUploadMb: MAX_MB });
}));

router.get("/templates", handle(async (req, res) => {
  res.json({ items: Object.entries(TEMPLATES).map(([kind, t]) => ({ kind, label: t.label, columns: t.columns.map((c) => ({ key: c.key, label: c.label, required: Boolean(c.required), example: c.example ?? "", help: c.help ?? null })) })) });
}));

// GET /templates/:kind?format=csv|xlsx — downloadable template with an example row
router.get("/templates/:kind", handle(async (req, res) => {
  const kind = String(req.params.kind).replace(/\.(csv|xlsx)$/, "");
  if (!TEMPLATES[kind]) throw fail(404, "NOT_FOUND", "Unknown template");
  const format = req.query.format === "xlsx" || req.params.kind.endsWith(".xlsx") ? "xlsx" : "csv";
  const rows = templateRows(kind);
  const name = `satya-${kind.replace(/_/g, "-")}-template.${format}`;
  res.set("content-disposition", `attachment; filename="${name}"`);
  if (format === "xlsx") {
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buildXlsx(rows, TEMPLATES[kind].label.slice(0, 31)));
  } else {
    res.type("text/csv; charset=utf-8").send(`﻿${toCsv(rows)}`);
  }
}));

// ---------- preview / commit ----------

const parseOptions = (raw) => {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { const o = JSON.parse(String(raw)); assertPlainInput(o); return o && typeof o === "object" ? o : {}; } catch (e) { if (e.status) throw e; throw fail(422, "VALIDATION_FAILED", "options must be JSON"); }
};
const OPTION_KEYS = ["mapping", "direction", "sheet", "autoAllocate", "period"];
const cleanOptions = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => OPTION_KEYS.includes(k)));

const runView = (r) => {
  if (!r) return r;
  const { _id, __v, fingerprint, ...rest } = r;
  return rest;
};

// POST /import/preview — multipart {file, source, entityId, options?}
router.post("/preview", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) return next(err.code === "LIMIT_FILE_SIZE" ? fail(413, "VALIDATION_FAILED", `File exceeds ${MAX_MB} MB — split it (e.g. one month per file)`) : err);
    next();
  });
}, handle(async (req, res) => {
  if (!req.file) throw fail(422, "VALIDATION_FAILED", "Attach the file in the 'file' field");
  const source = String(req.body.source || "");
  if (!SOURCES.includes(source)) throw fail(422, "VALIDATION_FAILED", `source must be one of ${SOURCES.join(", ")}`);
  const entityId = entityFor(req, req.body.entityId);
  requireImportPerm(req, source, entityId);
  const options = cleanOptions(parseOptions(req.body.options));
  const run = await previewImport({ groupId: req.scope.groupId, entityId, actor: actor(req), buffer: req.file.buffer, fileName: req.file.originalname || "upload", source, options });
  res.status(201).json(runView(run));
}));

router.post("/runs/:id/commit", handle(async (req, res) => {
  assertPlainInput(req.body || {});
  const run = await ImportRun.findOne({ groupId: req.scope.groupId, id: req.params.id }, { entityId: 1, source: 1 }).lean();
  if (!run || !req.scope.entityIds.includes(run.entityId)) throw fail(404, "NOT_FOUND", "Import not found");
  requireImportPerm(req, run.source, run.entityId);
  const overrides = cleanOptions(req.body?.options || {});
  const committed = await commitImport({ groupId: req.scope.groupId, runId: req.params.id, actor: actor(req), options: overrides.autoAllocate === false ? { autoAllocate: false } : {} });
  res.status(committed.idempotent ? 200 : 201).json(runView(committed));
}));

// live follow-up numbers for a committed run: open findings on the imported
// documents, payments waiting for allocation review, link suggestions
const liveStats = async (groupId, run) => {
  if (run.status !== "committed") return null;
  const ids = run.createdDocumentIds || [];
  const [findings, pendingJobs, review] = await Promise.all([
    ids.length ? Finding.countDocuments({ groupId, status: "open", "data.evidence.documentId": { $in: ids.slice(0, 2000) } }) : 0,
    Job.countDocuments({ groupId, status: { $in: ["queued", "running"] }, kind: { $in: ["autocheck", "bankallocate", "reconcile"] } }),
    ids.length ? Document.countDocuments({ groupId, id: { $in: ids.slice(0, 2000) }, $or: [{ "source.review.status": "needs_review" }, { "source.pendingRefs": true }] }) : 0,
  ]);
  return { openFindings: findings, waitingForReview: review + (run.checks?.suggestions || 0), linkSuggestions: run.checks?.suggestions || 0, checksRunning: pendingJobs > 0 };
};

router.get("/runs", handle(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const filter = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.source) filter.source = String(req.query.source);
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
  const runs = await ImportRun.find(filter, { issues: 0, sample: 0, fingerprint: 0 }).sort({ createdAt: -1 }).limit(limit).lean();
  const items = await Promise.all(runs.map(async (r) => ({ ...runView(r), createdDocumentIds: undefined, createdCount: (r.createdDocumentIds || []).length, live: await liveStats(req.scope.groupId, r) })));
  res.json({ items, nextBefore: runs.length === limit ? runs.at(-1).createdAt : null });
}));

router.get("/runs/:id", handle(async (req, res) => {
  const run = await ImportRun.findOne({ groupId: req.scope.groupId, id: req.params.id }).lean();
  if (!run || !req.scope.entityIds.includes(run.entityId)) throw fail(404, "NOT_FOUND", "Import not found");
  const live = await liveStats(req.scope.groupId, run);
  const ids = (run.createdDocumentIds || []).slice(0, 500);
  const [docs, findings] = await Promise.all([
    ids.length ? Document.find({ groupId: req.scope.groupId, id: { $in: ids } }, { id: 1, type: 1, number: 1, date: 1, "seller.name": 1, caseId: 1, "totals.grand": 1, "payment.amount": 1, "payment.allocations": 1, "source.review": 1, "source.pendingRefs": 1, "gst.gstr2b.status": 1, "gst.match.status": 1 }).lean() : [],
    ids.length ? Finding.find({ groupId: req.scope.groupId, status: "open", "data.evidence.documentId": { $in: ids } }, { id: 1, caseId: 1, code: 1, title: 1, severity: 1, "data.message": 1, "data.evidence": 1 }).limit(100).lean() : [],
  ]);
  res.json({
    ...runView(run), live,
    documents: docs.map((d) => ({
      id: d.id, type: d.type, number: d.number, date: d.date, party: d.seller?.name || null, caseId: d.caseId || null,
      amount: d.totals?.grand ?? d.payment?.amount ?? null,
      allocated: (d.payment?.allocations || []).length > 0,
      review: d.source?.review?.status || (d.source?.pendingRefs ? "waiting_for_reference" : null),
      reviewReason: d.source?.review?.reason || null,
      gstr2b: d.gst?.gstr2b?.status || d.gst?.match?.status || null,
    })),
    findings: findings.map((f) => ({ id: f.id, caseId: f.caseId, code: f.code, title: f.title, severity: f.severity, message: f.data?.message || null, documentIds: (f.data?.evidence || []).map((e) => e.documentId) })),
  });
}));

// ---------- GSTR-2B match status ----------

// GET /import/gstr2b/status?entityId=&period=&status= — per-invoice match
// outcome from the stored GSTR-2B matching (books vs supplier filings)
router.get("/gstr2b/status", handle(async (req, res) => {
  const filter = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (req.query.entityId) filter.entityId = entityFor(req, req.query.entityId);
  const entries = await Document.find({ ...filter, type: "GSTR2B_ENTRY" }, { id: 1, number: 1, date: 1, seller: 1, totals: 1, gst: 1 }).lean();
  const periods = [...new Set(entries.map((e) => e.gst?.gstr2bPeriod).filter(Boolean))].sort();
  const period = req.query.period && periods.includes(String(req.query.period)) ? String(req.query.period) : null;
  const invoices = await Document.find({ ...filter, type: "INVOICE_IN", "gst.gstr2b.status": { $exists: true } }, { id: 1, number: 1, date: 1, seller: 1, totals: 1, gst: 1, caseId: 1 }).lean();
  const inPeriod = (d) => !period || String(d.date).slice(0, 7) === period || d.gst?.gstr2b?.period === period;
  const rows = [
    ...invoices.filter(inPeriod).map((d) => ({ documentId: d.id, kind: "invoice", number: d.number, date: d.date, supplier: d.seller?.name || null, gstin: d.seller?.gstin || null, amount: d.totals?.grand ?? null, tax: sum(["cgst", "sgst", "igst", "cess"], (k) => d.totals?.[k]), status: d.gst.gstr2b.status, basis: d.gst.gstr2b.basis || null, diff: d.gst.gstr2b.diff || null, entryId: d.gst.gstr2b.entryId || null, caseId: d.caseId || null })),
    ...entries.filter((e) => e.gst?.match?.status === "only_in_2b" && (!period || e.gst?.gstr2bPeriod === period)).map((e) => ({ documentId: e.id, kind: "gstr2b_entry", number: e.number, date: e.date, supplier: e.seller?.name || null, gstin: e.seller?.gstin || null, amount: e.totals?.grand ?? null, tax: sum(["cgst", "sgst", "igst", "cess"], (k) => e.totals?.[k]), status: "only_in_2b", basis: null, diff: null, entryId: e.id, caseId: null })),
  ];
  const wanted = req.query.status ? String(req.query.status) : null;
  const counts = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  const atRisk = rows.filter((r) => r.status === "only_in_books").reduce((s, r) => s + toPaise(r.tax), 0n) + rows.filter((r) => r.status === "amount_differs").reduce((s, r) => { const t = toPaise(r.diff?.tax); return s + (t < 0n ? -t : t); }, 0n);
  res.json({
    periods, period, counts, itcAtRisk: fromPaise(atRisk),
    items: (wanted ? rows.filter((r) => r.status === wanted) : rows).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 500),
    note: "Matched on supplier GSTIN + invoice number + financial year with a ₹1 tolerance on tax and value. Screening only — confirm ITC positions with your CA.",
  });
}));

router.post("/gstr2b/rematch", handle(async (req, res) => {
  const entityId = entityFor(req, req.body?.entityId);
  if (!scopeAllows(req.scope, "import.data", entityId)) throw fail(403, "FORBIDDEN", "Your role cannot run GSTR-2B matching", { reason: "Requires import.data" });
  const { stats, changedInvoiceIds } = await runGstr2bMatch({ groupId: req.scope.groupId, entityId });
  if (changedInvoiceIds.length) await scheduleAutoCheck({ groupId: req.scope.groupId, documentIds: changedInvoiceIds, reason: "gstr2b:rematch" });
  res.json({ stats, changed: changedInvoiceIds.length });
}));

// ---------- API keys (connector) ----------
router.use("/api-keys", apiKeysRouter);

// ---------- legacy endpoints (payments + compliance pages) ----------

const legacyRun = async (req, source, summary, createdIds, extra = {}) => ImportRun.create({
  id: newId("imp"), groupId: req.scope.groupId, entityId: String(req.body.entityId), source, format: "json",
  fileName: extra.fileName || `${source}.json`, status: "committed", canCommit: true, summary, result: { ...summary, ...(extra.result || {}) },
  createdDocumentIds: createdIds.slice(0, 5000), via: "legacy", createdBy: actor(req), committedAt: new Date(),
}).catch(() => null);

// POST /api/v2/import/bank-csv — {entityId, mapping:{date,utr,amount,payeeName,mode?,direction}, rows:[{...headers}]}
// UTR dedupe: a row whose UTR already exists in the group is skipped, not re-created (04 P2-B5).
// mapping may be omitted: the bank's column layout is then auto-detected
// from the row keys (HDFC/ICICI/SBI/Axis/Kotak exports) and the UTR read from
// the narration. New debits get allocation suggestions + exact auto-allocation.
router.post("/bank-csv", handle(async (req, res) => {
  assertPlainInput(req.body);
  canImport(req);
  const { entityId, rows = [] } = req.body;
  let mapping = req.body.mapping || {};
  if (!entityId || !Array.isArray(rows) || !rows.length) throw fail(422, "VALIDATION_FAILED", "rows[] and entityId are required");
  if (!req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
  if (rows.length > 5000) throw fail(422, "VALIDATION_FAILED", "At most 5000 rows per import");

  // auto-detected layout when the caller did not map date/utr/amount
  let detected = null;
  if (!mapping.utr || !mapping.date || !mapping.amount) {
    const headers = Object.keys(rows[0] || {});
    const layout = detectBankLayout([headers]);
    if (!layout) throw fail(422, "VALIDATION_FAILED", "mapping needs date, utr and amount column names (or bank statement headings we can recognise)");
    const { lines } = readBankRows([headers, ...rows.map((r) => headers.map((h) => r[h]))], layout);
    detected = { bank: layout.bank, columns: Object.fromEntries(Object.entries(layout.columns).map(([k, i]) => [k, headers[i]])) };
    mapping = { __lines: lines };
  }

  const created = [], deduped = [], errors = [];
  const rowsToRead = mapping.__lines
    ? mapping.__lines.map((l) => ({ utr: l.utr || "", date: l.date, amount: l.amount, payee: l.counterparty || "Counterparty", mode: l.mode, direction: l.direction === "debit" ? "out" : "in", narration: l.narration, row: l.line - 2 }))
    : rows.map((row, i) => ({
      utr: String(row[mapping.utr] || "").trim().toUpperCase(), date: String(row[mapping.date] || "").trim().slice(0, 10),
      amount: String(row[mapping.amount] || "").replace(/[₹,\s]/g, ""), payee: String(row[mapping.payeeName] || "Counterparty"),
      rawMode: mapping.mode ? String(row[mapping.mode] || "").trim().toUpperCase() : "", direction: mapping.direction ? String(row[mapping.direction] || "") : "out", row: i,
    }));
  for (const r of rowsToRead) {
    const i = r.row;
    const utr = String(r.utr || "").toUpperCase();
    if (!/^[A-Z0-9]{6,35}$/.test(utr) || !isRealDate(r.date) || !/^\d{1,13}(\.\d{1,2})?$/.test(String(r.amount)) || toPaise(r.amount) <= 0n) {
      errors.push({ row: i, reason: "missing/invalid utr, date or amount" });
      continue;
    }
    const mode = r.mode || (r.rawMode ? MODE_ALIASES[r.rawMode] || (PAYMENT_MODES.includes(r.rawMode) ? r.rawMode : null) : "OTHER");
    if (!mode) {
      errors.push({ row: i, reason: `payment mode "${r.rawMode}" is not one of ${PAYMENT_MODES.join(", ")}` });
      continue;
    }
    const dup = await Document.exists({ groupId: req.scope.groupId, "payment.utr": utr });
    if (dup) { deduped.push({ row: i, utr }); continue; }
    const type = String(r.direction).toLowerCase().startsWith("in") ? "PAYMENT_IN" : "PAYMENT_OUT";
    const doc = await Document.create({
      id: newId("doc"), groupId: req.scope.groupId, entityId, type,
      externalRef: `bankcsv:${utr}`, date: r.date, fy: fyOf(r.date), status: "posted", revision: 0,
      seller: { name: String(r.payee).slice(0, 200) },
      buyer: { name: "Bank account" }, currency: "INR", lines: [],
      payment: { utr, amount: toDecimal(r.amount), mode, valueDate: r.date, allocations: [] },
      source: { channel: "bank_csv", ...(r.narration ? { narration: String(r.narration).slice(0, 300) } : {}) }, provenance: "SYSTEM_GENERATED",
      observedAt: new Date().toISOString(), createdBy: actor(req),
    });
    created.push({ row: i, documentId: doc.id, utr, type });
  }
  const run = await legacyRun(req, "bank_csv_legacy", { create: created.length, duplicate: deduped.length, error: errors.length }, created.map((c) => c.documentId), { fileName: "bank-csv (payments page)" });
  const outIds = created.filter((c) => c.type === "PAYMENT_OUT").map((c) => c.documentId);
  if (outIds.length) {
    await Job.create({ id: newId("job"), kind: "bankallocate", groupId: req.scope.groupId, status: "queued", runAfter: new Date(), payload: { paymentIds: outIds, allIds: created.map((c) => c.documentId), importRunId: run?.id || null, autoAllocate: true } }).catch(() => {});
  } else if (created.length) {
    await scheduleAutoCheck({ groupId: req.scope.groupId, documentIds: created.map((c) => c.documentId), reason: "import:bank-csv", importRunId: run?.id || null });
  }
  res.status(201).json({ created: created.length, deduped: deduped.length, errors: errors.length, detail: { created, deduped, errors }, ...(detected ? { detected } : {}), importRunId: run?.id || null });
}));

// POST /api/v2/import/gstr2b — official nested shape OR flat invoices array.
// Dedupe by supplier-GSTIN + invoice number per group. After storing, entries
// are matched to purchase invoices (GSTIN + number + FY, ₹1 tolerance).
router.post("/gstr2b", handle(async (req, res) => {
  assertPlainInput(req.body);
  canImport(req);
  const { entityId, gstr2b } = req.body;
  if (!entityId || !gstr2b) throw fail(422, "VALIDATION_FAILED", "entityId and gstr2b payload required");
  const flatResult = flattenGstr2b(gstr2b);
  const period = String(req.body.period || flatResult.period || gstr2b.period || "").slice(0, 7) || null;
  const flat = flatResult.entries;
  if (!flat.length) throw fail(422, "VALIDATION_FAILED", "No b2b invoices found — pass the GSTR-2B JSON or an {invoices:[...]} array");

  if (!req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
  if (flat.length > 20000) throw fail(422, "VALIDATION_FAILED", "At most 20000 invoices per import");

  // 2B entries are stored as GSTR2B_ENTRY (they are the supplier's filing,
  // not a second copy of the purchase invoice) — as INVOICE_IN they doubled
  // payables, dashboards and supplier balances. Official dates are DD-MM-YYYY.
  const created = [], deduped = [], errors = [];
  for (const [i, inv] of flat.entries()) {
    const rawDate = String(inv.date || "").trim();
    const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(rawDate);
    const date = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : rawDate.slice(0, 10);
    if (!inv.gstin || !inv.number || !isRealDate(date)) { errors.push({ row: i, reason: "missing GSTIN, invoice number or valid date" }); continue; }
    const externalRef = `gstr2b:${inv.gstin}:${inv.number}`;
    const existing = await Document.findOne({ groupId: req.scope.groupId, externalRef }, { _id: 1 }).lean();
    if (existing) { deduped.push({ number: inv.number }); continue; }
    const doc = await Document.create({
      id: newId("doc"), groupId: req.scope.groupId, entityId, type: "GSTR2B_ENTRY",
      number: String(inv.number), externalRef, date, fy: fyOf(date), status: "posted", revision: 0,
      seller: { name: inv.tradeName || inv.gstin, gstin: inv.gstin }, buyer: { name: "Own entity" },
      currency: "INR", lines: [],
      gst: { gstr2bPeriod: period || date.slice(0, 7) },
      totals: { taxable: toDecimal(inv.taxable), cgst: toDecimal(inv.cgst), sgst: toDecimal(inv.sgst), igst: toDecimal(inv.igst), cess: toDecimal(inv.cess), roundOff: "0.00", grand: toDecimal(inv.total) },
      source: { channel: "gstr2b_json" }, provenance: "SYSTEM_GENERATED",
      observedAt: new Date().toISOString(), createdBy: actor(req),
    });
    created.push({ number: inv.number, documentId: doc.id });
  }
  let match = null;
  try { match = await runGstr2bMatch({ groupId: req.scope.groupId, entityId: String(entityId) }); } catch (e) { console.warn(`[import] gstr2b match failed: ${e.message}`); }
  const run = await legacyRun(req, "gstr2b_legacy", { create: created.length, duplicate: deduped.length, error: errors.length }, created.map((c) => c.documentId), { fileName: "gstr2b (compliance page)", result: { gstr2b: match?.stats || null, period } });
  await scheduleAutoCheck({ groupId: req.scope.groupId, documentIds: [...created.map((c) => c.documentId), ...(match?.changedInvoiceIds || [])], reason: "import:gstr2b", importRunId: run?.id || null });
  res.status(201).json({ created: created.length, deduped: deduped.length, errors: errors.length, detail: { created, deduped, errors }, match: match?.stats || null, importRunId: run?.id || null });
}));

export default router;
