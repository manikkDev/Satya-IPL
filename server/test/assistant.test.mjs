// /api/v2/assistant — pure helpers always; DB-backed route tests run against a
// throwaway database on MONGO_TEST_URI and skip when Mongo is unreachable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import { msmeInterestPaise, s43bhScreen, rankPayable } from "../src/routes/v2/assistant.js";

test("MSMED s.16 interest estimate compounds monthly at 3x the bank rate", () => {
  assert.equal(msmeInterestPaise(10_000_000n, 0), 0n);
  assert.equal(msmeInterestPaise(10_000_000n, -5), 0n);
  // ₹1,00,000 overdue ~1 month at 3 x 5.5% = 16.5% p.a. → ~₹1,375
  const oneMonth = msmeInterestPaise(10_000_000n, 365 / 12, "5.50");
  assert.equal(oneMonth, 137_500n);
  // longer delay compounds (more than simple interest for 12 months)
  const year = msmeInterestPaise(10_000_000n, 365, "5.50");
  assert.ok(year > 1_650_000n && year < 1_800_000n, String(year));
});

test("s.43B(h) screen applies to micro/small only and uses the expense share", () => {
  const base = { dueDate: "2026-09-21", outstandingPaise: 1_321_600n, grandPaise: 6_608_000n, taxablePaise: 5_600_000n, today: "2026-11-14" };
  assert.equal(s43bhScreen({ ...base, category: "medium" }), null);
  assert.equal(s43bhScreen({ ...base, category: "unknown" }), null);
  const r = s43bhScreen({ ...base, category: "small" });
  assert.equal(r.fy, "2026-27");
  assert.equal(r.fyEnd, "2027-03-31");
  assert.equal(r.atRisk, true);
  assert.equal(r.deadlinePassed, true);
  assert.equal(r.expenseAtRisk.amount, "11200.00"); // 13216 × 56000/66080
});

test("payables rank MSME overdue first, then MSME due soon, overdue, due soon", () => {
  const row = (extra) => ({ overdueDays: 0, daysToDue: 30, disputed: { amount: "0.00" }, msme: null, s43bh: null, ...extra });
  assert.equal(rankPayable(row({ msme: { daysLeft: -3 }, overdueDays: 3 })).rank, 1);
  assert.equal(rankPayable(row({ msme: { daysLeft: 5 } })).rank, 2);
  assert.equal(rankPayable(row({ overdueDays: 10 })).rank, 3);
  assert.equal(rankPayable(row({ daysToDue: 2 })).rank, 4);
  assert.equal(rankPayable(row({})).rank, 5);
  assert.deepEqual(rankPayable(row({ disputed: { amount: "10.00" } })).reasons, ["disputed"]);
});

/* ------------------------------------------------------------- DB-backed */

const URI = process.env.MONGO_TEST_URI || "mongodb://localhost:27017";
const DB = `satya_assistant_${process.pid}`;
let up = false;
let server;
let base;

before(async () => {
  try {
    await mongoose.connect(URI, { dbName: DB, serverSelectionTimeoutMS: 2000 });
    up = true;
  } catch { up = false; return; }
  // raw inserts: these tests exercise the read model, not document validation
  const db = mongoose.connection.db;
  const Supplier = { create: (rows) => db.collection("suppliers").insertMany(rows) };
  const Document = { create: (rows) => db.collection("documents").insertMany(rows) };
  const Finding = { create: (row) => db.collection("findings").insertOne(row) };
  const g = "grp_t", e = "ent_t";
  await Supplier.create([
    { id: "sup_msme", groupId: g, legalName: "Small Valves", udyam: { number: "UDYAM-MH-01-0000001", category: "small" }, paymentTermsDays: 30 },
    { id: "sup_big", groupId: g, legalName: "Big Motors Ltd", paymentTermsDays: 60 },
  ]);
  const inv = (id, supplierId, name, date, grand, taxable) => ({
    id, groupId: g, entityId: e, type: "INVOICE_IN", number: id.toUpperCase(), date, status: "posted", currency: "INR",
    supplierId, seller: { name, supplierId }, totals: { taxable, grand }, lines: [{ lineNo: 1, qty: "1", rate: taxable, refs: { poId: `po_${id}` } }],
  });
  await Document.create([
    inv("inv_a", "sup_msme", "Small Valves", "2026-08-01", "11800.00", "10000.00"),
    inv("inv_b", "sup_big", "Big Motors Ltd", "2026-11-01", "59000.00", "50000.00"),
    inv("inv_c", "sup_big", "Big Motors Ltd", "2026-06-01", "23600.00", "20000.00"),
  ]);
  await Finding.create({ id: "fnd_1", groupId: g, entityId: e, caseId: "case_c", code: "DUP_EXACT_INVOICE", severity: "high", certainty: "CONFIRMED", status: "open", data: { amount: "23600", evidence: [{ documentId: "inv_c" }] } });
  const { default: assistant } = await import("../src/routes/v2/assistant.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers["x-role"] || "ap_manager";
    req.user = { v2id: "usr_t" };
    req.scope = { groupId: g, entityIds: [e], wildcard: false, rolesByEntity: { [e]: [role] } };
    next();
  });
  app.use("/assistant", assistant);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/assistant`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (up) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});

const get = (path) => fetch(`${base}${path}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test("payables: outstanding, disputed cap, MSME clock and priority order", async (t) => {
  if (!up) return t.skip("mongo unavailable");
  const { status, body } = await get("/payables");
  assert.equal(status, 200);
  assert.equal(body.total, 3);
  assert.equal(body.totals.outstanding.amount, "94400.00");
  assert.equal(body.totals.disputed.amount, "23600.00");
  assert.equal(body.totals.payable.amount, "70800.00");
  const [first] = body.items;
  assert.equal(first.documentId, "inv_a"); // MSME, overdue
  assert.equal(first.priority, 1);
  assert.ok(first.msme && first.msme.daysLeft < 0);
  const c = body.items.find((r) => r.documentId === "inv_c");
  assert.equal(c.payable.amount, "0.00");
  assert.deepEqual(c.findings.map((f) => f.code), ["DUP_EXACT_INVOICE"]);
  const msmeOnly = await get("/payables?status=msme");
  assert.deepEqual(msmeOnly.body.items.map((r) => r.documentId), ["inv_a"]);
  const bad = await get("/payables?status=nope");
  assert.equal(bad.status, 422);
});

test("payment-run proposals validate amounts, budget and permission", async (t) => {
  if (!up) return t.skip("mongo unavailable");
  const ok = await post("/payment-runs", { budget: "20000", items: [{ documentId: "inv_a", amount: "11800.00" }], source: "copilot" });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.total, "11800.00");
  assert.equal(ok.body.status, "proposed");
  const over = await post("/payment-runs", { items: [{ documentId: "inv_a", amount: "99999" }] });
  assert.equal(over.status, 422);
  const budget = await post("/payment-runs", { budget: "100", items: [{ documentId: "inv_a", amount: "11800" }] });
  assert.equal(budget.status, 422);
  const unknown = await post("/payment-runs", { items: [{ documentId: "inv_zzz", amount: "1" }] });
  assert.equal(unknown.status, 404);
  const auditor = await post("/payment-runs", { items: [{ documentId: "inv_a", amount: "1" }] }, { "x-role": "auditor" });
  assert.equal(auditor.status, 403);
  const injected = await post("/payment-runs", { items: [{ documentId: "inv_a", amount: "1", $where: "1" }] });
  assert.equal(injected.status, 422);
  const list = await get("/payment-runs");
  assert.equal(list.body.items.length, 1);
});

test("IMS decisions are recorded with a reason", async (t) => {
  if (!up) return t.skip("mongo unavailable");
  const r = await post("/ims-decisions", { period: "2026-10", decisions: [{ invoice: "INV_B", action: "pending", reason: "Supplier to amend the tax amount" }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.recorded, 1);
  const bad = await post("/ims-decisions", { period: "2026-10", decisions: [{ invoice: "INV_B", action: "approve", reason: "x" }] });
  assert.equal(bad.status, 422);
  const list = await get("/ims-decisions?period=2026-10");
  assert.equal(list.body.items.length, 1);
});

test("spend groups invoiced and paid by month", async (t) => {
  if (!up) return t.skip("mongo unavailable");
  const r = await get("/spend?from=2026-04-01&to=2026-11-30");
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.invoiced.amount, "94400.00");
  assert.deepEqual(r.body.rows.map((x) => x.key), ["2026-06", "2026-08", "2026-11"]);
  const bySup = await get("/spend?groupBy=supplier&from=2026-04-01&to=2026-11-30");
  assert.equal(bySup.body.rows[0].label, "Big Motors Ltd");
});
