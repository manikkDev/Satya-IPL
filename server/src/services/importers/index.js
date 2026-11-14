// Import pipeline: one preview/commit flow for every source.
//
//   preview(file, source, options) -> stores the file (GridFS, sha256
//     dedupe), parses + validates + resolves against existing data, saves
//     an ImportRun {summary, issues, sample, canCommit}. Nothing else is
//     written.
//   commit(runId) -> re-reads the SAME stored file, re-resolves (data may
//     have changed since preview), writes idempotently, then schedules the
//     automatic checks (case attachment, ML links, GSTR-2B match, reconcile)
//     and, for bank statements, allocation suggestions / exact
//     auto-allocation. Committing twice returns the first result.
//
// Sources: tally_xml | bank_statement | gstr2b_json | template:<kind>
import crypto from "node:crypto";
import Document from "../../models/Document.js";
import FileDoc from "../../models/FileDoc.js";
import ImportRun from "../../models/ImportRun.js";
import Job from "../../models/Job.js";
import { newId } from "../../lib/ids.js";
import { fyOf, isRealDate } from "../../lib/fy.js";
import { toDecimal, sum } from "../../lib/money.js";
import { putFile, getFileBuffer } from "../storage.js";
import { scheduleAutoCheck } from "../autoChecks.js";
import { runGstr2bMatch } from "../gstr2bMatch.js";
import { parseCsv } from "./csv.js";
import { parseXlsx } from "./xlsx.js";
import { parseTallyXml } from "./tally.js";
import { TEMPLATES, keyedRows, recordsFromTemplate } from "./templates.js";
import { readStatement, planBank, commitBank } from "./bankImport.js";
import { loadContext, planRecords, commitRecords, findSupplier } from "./resolve.js";
import { checkGstin, parseDate } from "./normalize.js";

const MAX_ISSUES = 300;
const MAX_SAMPLE = 200;
export const SOURCES = ["tally_xml", "bank_statement", "gstr2b_json", ...Object.keys(TEMPLATES).map((k) => `template:${k}`)];

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
export const isTemplate = (source) => String(source).startsWith("template:");
export const templateKind = (source) => String(source).slice("template:".length);

const mimeFor = (buffer, fileName) => {
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const ext = String(fileName).toLowerCase().split(".").pop();
  if (ext === "xml") return "application/xml";
  if (ext === "json") return "application/json";
  if (ext === "csv") return "text/csv";
  return "text/plain";
};

/** Sheet rows from CSV or XLSX bytes. */
const sheetRows = (buffer, options = {}) => {
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return { ...parseXlsx(buffer, { sheet: options.sheet }), format: "xlsx" };
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) throw fail(422, "VALIDATION_FAILED", "Old Excel .xls files are not supported — save as .xlsx or CSV");
  return { ...parseCsv(buffer), format: "csv" };
};

// ---------- GSTR-2B JSON ----------
/** Official GSTR-2B (data.docdata.b2b), GSTR-2A-style (doc_det/inum/itms) or {invoices:[...]} -> flat entries. */
export const flattenGstr2b = (json) => {
  const root = json?.data || json || {};
  const period = (() => {
    const p = String(root.rtnprd || json?.rtnprd || json?.period || "");
    if (/^\d{6}$/.test(p)) return `${p.slice(2)}-${p.slice(0, 2)}`; // MMYYYY -> YYYY-MM
    if (/^\d{4}-\d{2}$/.test(p)) return p;
    return null;
  })();
  const docdata = root.docdata || root.doc_det || {};
  const out = [];
  for (const sup of docdata.b2b || []) {
    for (const inv of sup.inv || []) {
      const items = inv.items || inv.itms || [];
      const pick = (it, a, b) => it[a] ?? it[b] ?? it.itm_det?.[a] ?? it.itm_det?.[b];
      out.push({
        gstin: sup.ctin, tradeName: sup.trdnm || null, filedOn: sup.supfildt || null, supplierPeriod: sup.supprd || null,
        number: inv.inum, date: inv.dt || inv.idt, total: inv.val,
        taxable: sum(items, (it) => pick(it, "txval", "txval")), igst: sum(items, (it) => pick(it, "igst", "iamt")),
        cgst: sum(items, (it) => pick(it, "cgst", "camt")), sgst: sum(items, (it) => pick(it, "sgst", "samt")), cess: sum(items, (it) => pick(it, "cess", "csamt")),
        itcAvailable: inv.itcavl ? inv.itcavl === "Y" : null, reverseCharge: inv.rev ? inv.rev === "Y" : null, irn: inv.irn || null, docType: "B2B",
      });
    }
  }
  for (const inv of json?.invoices || []) out.push({ gstin: inv.gstin, tradeName: inv.tradeName || inv.supplierName || null, number: inv.number, date: inv.date, total: inv.total, taxable: inv.taxable, igst: inv.igst, cgst: inv.cgst, sgst: inv.sgst, cess: inv.cess, docType: "B2B" });
  const notes = (docdata.cdnr || []).reduce((s, sup) => s + (sup.nt || []).length, 0);
  return { period, entries: out, skipped: { creditDebitNotes: notes, b2ba: (docdata.b2ba || []).length, impg: (docdata.impg || []).length } };
};

const plan2b = async (ctx, flat, period) => {
  const issues = [];
  const rows = [];
  const keys = flat.filter((e) => e.gstin && e.number).map((e) => `gstr2b:${String(e.gstin).toUpperCase()}:${e.number}`);
  const existing = new Set((await Document.find({ groupId: ctx.groupId, externalRef: { $in: keys } }, { externalRef: 1 }).lean()).map((d) => d.externalRef));
  const seen = new Set();
  for (const [i, e] of flat.entries()) {
    const date = parseDate(e.date);
    const g = checkGstin(e.gstin);
    const ref = `entry ${i + 1}`;
    if (!e.gstin || !e.number || !date || !isRealDate(date)) {
      issues.push({ ref, severity: "error", field: "inv", message: `Entry ${e.number || "(no number)"}: missing GSTIN, invoice number or valid date` });
      rows.push({ ref, kind: "GSTR2B_ENTRY", label: `${e.number || "?"} from ${e.gstin || "?"}`, action: "error" });
      continue;
    }
    if (!g.ok) issues.push({ ref, severity: "warning", field: "ctin", message: `Supplier GSTIN ${e.gstin}: ${g.reason}` });
    const key = `gstr2b:${String(e.gstin).toUpperCase()}:${e.number}`;
    const sup = findSupplier(ctx, { gstin: String(e.gstin).toUpperCase(), name: e.tradeName }).supplier;
    const action = existing.has(key) || seen.has(key) ? "duplicate" : "create";
    seen.add(key);
    rows.push({ ref, kind: "GSTR2B_ENTRY", label: `${e.number} — ${sup?.legalName || e.tradeName || e.gstin}`, number: e.number, date, party: sup?.legalName || e.tradeName || e.gstin, amount: toDecimal(e.total), action, entry: { ...e, date, gstin: String(e.gstin).toUpperCase(), supplierId: sup?.id || null, supplierName: sup?.legalName || null } });
  }
  const summary = { create: rows.filter((r) => r.action === "create").length, duplicate: rows.filter((r) => r.action === "duplicate").length, error: rows.filter((r) => r.action === "error").length, period, byType: { GSTR2B_ENTRY: {} } };
  summary.byType.GSTR2B_ENTRY = { create: summary.create, duplicate: summary.duplicate, error: summary.error };
  return { summary, rows, issues, canCommit: summary.create > 0 };
};

const commit2b = async (ctx, rows, period) => {
  const created = [];
  for (const r of rows) {
    if (r.action !== "create") continue;
    const e = r.entry;
    try {
      const doc = await Document.create({
        id: newId("doc"), groupId: ctx.groupId, entityId: ctx.entityId, type: "GSTR2B_ENTRY",
        number: String(e.number), externalRef: `gstr2b:${e.gstin}:${e.number}`, date: e.date, fy: fyOf(e.date), status: "posted", revision: 0,
        seller: { name: e.supplierName || e.tradeName || e.gstin, gstin: e.gstin, ...(e.supplierId ? { supplierId: e.supplierId } : {}) },
        ...(e.supplierId ? { supplierId: e.supplierId } : {}),
        buyer: ctx.buyer, currency: "INR", lines: [],
        gst: { gstr2bPeriod: period || e.date.slice(0, 7), ...(e.itcAvailable !== null && e.itcAvailable !== undefined ? { itcAvailable: e.itcAvailable } : {}), ...(e.reverseCharge !== null && e.reverseCharge !== undefined ? { reverseCharge: e.reverseCharge } : {}), ...(e.irn ? { irn: e.irn } : {}), ...(e.filedOn ? { supplierFiledOn: e.filedOn } : {}) },
        totals: { taxable: toDecimal(e.taxable), cgst: toDecimal(e.cgst), sgst: toDecimal(e.sgst), igst: toDecimal(e.igst), cess: toDecimal(e.cess), roundOff: "0.00", grand: toDecimal(e.total) },
        source: { channel: "gstr2b_json", ...(ctx.importRunId ? { importRunId: ctx.importRunId } : {}) }, provenance: "SYSTEM_GENERATED",
        observedAt: new Date().toISOString(), createdBy: ctx.actor,
      });
      created.push(doc.toObject());
    } catch (err) { if (err?.code !== 11000) throw err; }
  }
  return created;
};

// ---------- parse per source ----------
const parseSource = (source, buffer, fileName, options) => {
  if (source === "tally_xml") {
    const parsed = parseTallyXml(buffer);
    return { format: "xml", records: [...parsed.suppliers, ...parsed.items, ...parsed.documents], detected: { tally: parsed.stats } };
  }
  if (source === "gstr2b_json") {
    let json;
    try { json = JSON.parse(buffer.toString("utf8").replace(/^﻿/, "")); } catch { throw fail(422, "VALIDATION_FAILED", "The GSTR-2B file is not valid JSON — download the JSON from the GST portal (Returns > GSTR-2B > Download JSON)"); }
    const flat = flattenGstr2b(json);
    if (!flat.entries.length) throw fail(422, "VALIDATION_FAILED", "No B2B invoices found in this GSTR-2B file");
    if (flat.entries.length > 20000) throw fail(422, "VALIDATION_FAILED", "At most 20,000 invoices per GSTR-2B import");
    const period = options.period && /^\d{4}-\d{2}$/.test(options.period) ? options.period : flat.period;
    return { format: "json", flat: flat.entries, period, detected: { period, gstin: json?.data?.gstin || null, skipped: flat.skipped } };
  }
  if (source === "bank_statement") {
    const statement = readStatement(buffer, fileName, { mapping: options.mapping });
    if (statement.lines.length > 5000) throw fail(422, "VALIDATION_FAILED", "At most 5,000 statement lines per import — split the file by month");
    return { format: statement.format, statement, detected: { ...statement.detected, bank: statement.bank, account: statement.account ? `****${String(statement.account).slice(-4)}` : null, lines: statement.lines.length } };
  }
  if (isTemplate(source)) {
    const kind = templateKind(source);
    if (!TEMPLATES[kind]) throw fail(422, "VALIDATION_FAILED", `Unknown template ${kind}`);
    const { rows, format, sheets } = sheetRows(buffer, options);
    const keyed = keyedRows(kind, rows);
    if (keyed.missing.length) throw fail(422, "VALIDATION_FAILED", `Missing required column(s): ${keyed.missing.join(", ")}. Download the template to see the expected headings.`, { missing: keyed.missing, found: rows[keyed.headerIndex] || [] });
    if (keyed.rows.length > 5000) throw fail(422, "VALIDATION_FAILED", "At most 5,000 rows per import — split the file");
    const records = recordsFromTemplate(kind, keyed.rows, format === "xlsx" ? "excel" : "csv");
    return { format, records, detected: { template: kind, headerRow: keyed.headerIndex + 1, mapping: keyed.mapping, ignoredColumns: keyed.unknown, sheets } };
  }
  throw fail(422, "VALIDATION_FAILED", `Unknown import source "${source}"`);
};

const permissionFor = (source) => (source === "template:suppliers" || source === "template:items" ? "master.manage" : "import.data");
export { permissionFor };

const capIssues = (issues) => issues.slice(0, MAX_ISSUES).map((i) => ({ ...i, message: String(i.message).slice(0, 300) }));

/** Preview: store file, parse, plan, save the run. */
export const previewImport = async ({ groupId, entityId, actor, buffer, fileName = "upload", source, options = {}, via = "ui" }) => {
  if (!SOURCES.includes(source)) throw fail(422, "VALIDATION_FAILED", `Unknown import source "${source}"`);
  if (!buffer?.length) throw fail(422, "VALIDATION_FAILED", "The file is empty");
  const parsed = parseSource(source, buffer, fileName, options);
  const { file } = await putFile({ buffer, filename: fileName, mime: mimeFor(buffer, fileName), groupId, entityId, uploadedBy: actor });
  const fingerprint = crypto.createHash("sha256").update(`${file.sha256}|${source}|${JSON.stringify(options || {})}|${entityId}`).digest("hex");
  const ctx = await loadContext({ groupId, entityId, actor });
  let plan;
  if (source === "bank_statement") {
    const rows = await planBank(ctx, parsed.statement, { direction: options.direction || "both" });
    const summary = {
      create: rows.filter((r) => r.action === "create").length, duplicate: rows.filter((r) => r.action === "duplicate").length,
      error: parsed.statement.issues.filter((i) => i.severity === "error").length,
      debits: rows.filter((r) => r.direction === "debit").length, credits: rows.filter((r) => r.direction === "credit").length,
      withUtr: rows.filter((r) => r.utr).length, counterpartyResolved: rows.filter((r) => r.supplierId).length,
      byType: { PAYMENT_OUT: { create: rows.filter((r) => r.action === "create" && r.direction === "debit").length }, PAYMENT_IN: { create: rows.filter((r) => r.action === "create" && r.direction === "credit").length } },
    };
    plan = {
      summary, canCommit: summary.create > 0,
      issues: parsed.statement.issues.map((i) => ({ ...i, ref: `line ${i.line}` })),
      rows: rows.map((r) => ({ ref: `line ${r.line}`, kind: r.direction === "debit" ? "PAYMENT_OUT" : "PAYMENT_IN", label: r.narration?.slice(0, 90) || "(no narration)", date: r.date, amount: r.amount, direction: r.direction, utr: r.utr, mode: r.mode, party: r.supplierName || r.counterparty || null, matchedBy: r.matchedBy, action: r.action, existingId: r.existingId })),
    };
  } else if (source === "gstr2b_json") {
    plan = await plan2b(ctx, parsed.flat, parsed.period);
    plan.rows = plan.rows.map(({ entry, ...r }) => r);
  } else {
    plan = await planRecords(ctx, parsed.records);
  }
  const previous = await ImportRun.findOne({ groupId, fingerprint, status: "committed" }, { id: 1, committedAt: 1 }).lean();
  const run = await ImportRun.create({
    id: newId("imp"), groupId, entityId, source, format: parsed.format,
    fileId: file.id, fileName, sha256: file.sha256, fingerprint, options, status: "previewed",
    canCommit: plan.canCommit, detected: { ...parsed.detected, ...(previous ? { previouslyCommitted: previous.id } : {}) },
    summary: plan.summary, issues: capIssues(plan.issues), issueCount: plan.issues.length,
    sample: plan.rows.slice(0, MAX_SAMPLE), via, createdBy: actor,
  });
  return run.toObject();
};

/** Commit a previewed run (idempotent). */
export const commitImport = async ({ groupId, runId, actor, options: overrides = {} }) => {
  const existing = await ImportRun.findOne({ groupId, id: runId }).lean();
  if (!existing) throw fail(404, "NOT_FOUND", "Import not found");
  if (existing.status === "committed") return { ...existing, idempotent: true };
  if (existing.status === "committing") throw fail(409, "CONFLICT", "This import is already being committed");
  if (!existing.canCommit) throw fail(422, "VALIDATION_FAILED", "Nothing to import — every row is a duplicate or has an error");
  const run = await ImportRun.findOneAndUpdate({ groupId, id: runId, status: { $in: ["previewed", "failed"] } }, { $set: { status: "committing" } }, { returnDocument: "after" }).lean();
  if (!run) throw fail(409, "CONFLICT", "This import is already being committed");
  try {
    const file = await FileDoc.findOne({ groupId, id: run.fileId });
    if (!file) throw fail(410, "GONE", "The uploaded file is no longer available — upload it again");
    const buffer = await getFileBuffer(file);
    const options = { ...(run.options || {}), ...overrides };
    const parsed = parseSource(run.source, buffer, run.fileName, options);
    const ctx = await loadContext({ groupId, entityId: run.entityId, actor, importRunId: run.id, provenance: run.source === "bank_statement" ? "SYSTEM_GENERATED" : "USER_PROVIDED" });
    let result;
    let createdIds = [];
    const after = {};
    if (run.source === "bank_statement") {
      const rows = await planBank(ctx, parsed.statement, { direction: options.direction || "both" });
      const created = await commitBank(ctx, parsed.statement, rows);
      createdIds = created.map((d) => d.id);
      const outIds = created.filter((d) => d.type === "PAYMENT_OUT").map((d) => d.id);
      result = { created: created.length, duplicate: rows.filter((r) => r.action === "duplicate").length, payments: { out: outIds.length, in: created.length - outIds.length }, counterpartyResolved: created.filter((d) => d.supplierId).length, allocation: { status: outIds.length ? "queued" : "none" } };
      // allocation suggestions + exact auto-allocation run as a job, then the auto-checks
      if (outIds.length) {
        await Job.create({ id: newId("job"), kind: "bankallocate", groupId, status: "queued", runAfter: new Date(), payload: { paymentIds: outIds, allIds: createdIds, importRunId: run.id, autoAllocate: options.autoAllocate !== false } });
      } else if (createdIds.length) {
        await scheduleAutoCheck({ groupId, documentIds: createdIds, reason: "import:bank", importRunId: run.id });
      }
    } else if (run.source === "gstr2b_json") {
      const plan = await plan2b(ctx, parsed.flat, parsed.period);
      const created = await commit2b(ctx, plan.rows, parsed.period);
      createdIds = created.map((d) => d.id);
      const match = await runGstr2bMatch({ groupId, entityId: run.entityId });
      result = { created: created.length, duplicate: plan.summary.duplicate, error: plan.summary.error, period: parsed.period, gstr2b: match.stats };
      after.extraIds = match.changedInvoiceIds;
      await scheduleAutoCheck({ groupId, documentIds: [...createdIds, ...match.changedInvoiceIds], reason: "import:gstr2b", importRunId: run.id });
    } else {
      const out = await commitRecords(ctx, parsed.records);
      createdIds = out.createdDocumentIds;
      result = { ...out.summary, rows: undefined };
      after.rows = out.rows;
      after.issues = out.issues;
      if (createdIds.length) await scheduleAutoCheck({ groupId, documentIds: createdIds, reason: `import:${run.source}`, importRunId: run.id });
    }
    const updated = await ImportRun.findOneAndUpdate({ groupId, id: run.id }, {
      $set: {
        status: "committed", committedAt: new Date(), result, createdDocumentIds: createdIds.slice(0, 5000),
        ...(after.rows ? { sample: after.rows.slice(0, MAX_SAMPLE) } : {}),
        ...(after.issues ? { issues: capIssues(after.issues), issueCount: after.issues.length } : {}),
      },
    }, { returnDocument: "after" }).lean();
    return updated;
  } catch (e) {
    await ImportRun.updateOne({ groupId, id: run.id }, { $set: { status: "failed", error: String(e.message).slice(0, 500) } });
    throw e;
  }
};

/** Job handler: allocation suggestions + exact auto-allocation for imported bank debits. */
export const runBankAllocate = async (payload, job) => {
  const { processNewPayments } = await import("../allocation.js");
  const { ensureCaseForPo } = await import("../documents.js");
  const groupId = job?.groupId || payload.groupId;
  const caseFor = async (invoiceId) => {
    const inv = await Document.findOne({ groupId, id: invoiceId }, { lines: 1 }).lean();
    const poId = inv?.lines?.map((l) => l.refs?.poId).find(Boolean);
    if (!poId) return null;
    const po = await Document.findOne({ groupId, id: poId }).lean();
    return po ? ensureCaseForPo(po) : null;
  };
  const out = await processNewPayments({ groupId, paymentIds: payload.paymentIds || [], autoAllocate: payload.autoAllocate !== false, caseFor });
  if (payload.importRunId) {
    await ImportRun.updateOne({ groupId, id: payload.importRunId }, { $set: { "result.allocation": { status: "done", autoAllocated: out.autoAllocated, suggested: out.suggested, review: out.review, engineUnavailable: out.engineUnavailable, details: out.details.slice(0, 200) } } });
  }
  await scheduleAutoCheck({ groupId, documentIds: payload.allIds || payload.paymentIds || [], reason: "import:bank", importRunId: payload.importRunId || null });
  return { autoAllocated: out.autoAllocated, review: out.review, suggested: out.suggested };
};
