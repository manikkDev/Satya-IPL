#!/usr/bin/env node
// Curated demo seed — replaces the demo group's business data with ONE
// coherent, fictional company (see docs/DEMO_DATASET.md).
//
//   node src/seed/curated.js                      # wipe demo group + write curated data + enqueue reconcile jobs
//   node src/seed/curated.js --dry-run            # build + validate + show what would be wiped; writes nothing
//   node src/seed/curated.js --reconcile-now      # also run every case through the engine right away
//   node src/seed/curated.js --purge-test-groups  # also delete @example.test junk tenants (listed first)
//
// Env: DB_URI | MONGO_URI, APP_DB_NAME (default "satya"), DEMO_PASSWORD,
// DEMO_RESET_PASSWORDS=1, ENGINE_API_URL + NODE_INTERNAL_TOKEN (--reconcile-now).
//
// Only the demo group (Group.legacyCompanyId = "satya-demo") is touched.
// Other groups and every user's password are left alone.
import "dotenv/config";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import Group from "../models/Group.js";
import Entity from "../models/Entity.js";
import Policy from "../models/Policy.js";
import Job from "../models/Job.js";
import Finding from "../models/Finding.js";
import Case from "../models/Case.js";
import User from "../models/User.js";
import { DEFAULT_NUMBERING, DEFAULT_TERMS } from "../services/policies.js";
import { accountHash } from "../services/bankAccounts.js";
import { newId } from "../lib/ids.js";
import { ENTITY, SUPPLIERS, DEMO_COMPANY_ID, DEMO_USERS } from "./company.js";
import { STORIES } from "./stories.js";
import { buildDataset } from "./build.js";
import { validateDataset, printReport, loadFromDb } from "./validate.js";
import { ensureDemoAccounts } from "./users.js";
import { istDate, istInstant } from "./dates.js";

// Collections holding group-scoped business data (field: groupId).
const GROUP_SCOPED = ["documents", "documentlinks", "cases", "findings", "decisions", "snapshots", "jobs", "suppliers", "items", "audits", "extractiondrafts", "filedocs"];

// Known junk tenants created by contract/e2e test runs. A group is purged only
// if its name is on this list AND every member's email is a test address.
export const TEST_GROUP_NAMES = ["Trial Industries", "Bank Flow Ltd", "Parent Industries"];
const TEST_EMAIL = /@example\.test$/i;

export const connect = async () => {
  const uri = process.env.DB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set DB_URI or MONGO_URI");
  const dbName = process.env.APP_DB_NAME || "satya";
  await mongoose.connect(uri, { dbName });
  return { db: mongoose.connection.db, dbName, close: () => mongoose.disconnect() };
};

export const findDemoGroup = (db) => db.collection("groups").findOne({ legacyCompanyId: DEMO_COMPANY_ID });

// ---------------------------------------------------------------- wipe ----
const countDemoData = async (db, group) => {
  const counts = {};
  for (const c of GROUP_SCOPED) counts[c] = await db.collection(c).countDocuments({ groupId: group.id });
  counts.chatconversations = await db.collection("chatconversations").countDocuments({ companyId: DEMO_COMPANY_ID });
  counts.extraEntities = await db.collection("entities").countDocuments({ groupId: group.id, code: { $ne: ENTITY.code } });
  return counts;
};

const wipeDemoGroup = async (db, group, keepEntityId) => {
  const files = await db.collection("filedocs").find({ groupId: group.id }, { projection: { gridfsId: 1 } }).toArray();
  const gridIds = files.map((f) => f.gridfsId).filter(Boolean);
  if (gridIds.length) {
    await db.collection("uploads.chunks").deleteMany({ files_id: { $in: gridIds } });
    await db.collection("uploads.files").deleteMany({ _id: { $in: gridIds } });
  }
  const removed = {};
  for (const c of GROUP_SCOPED) removed[c] = (await db.collection(c).deleteMany({ groupId: group.id })).deletedCount;
  removed.chatconversations = (await db.collection("chatconversations").deleteMany({ companyId: DEMO_COMPANY_ID })).deletedCount;
  const extra = await db.collection("entities").find({ groupId: group.id, id: { $ne: keepEntityId } }).toArray();
  if (extra.length) {
    await db.collection("policies").deleteMany({ entityId: { $in: extra.map((e) => e.id) } });
    await db.collection("entities").deleteMany({ id: { $in: extra.map((e) => e.id) } });
  }
  removed.extraEntities = extra.length;
  removed.policies = (await db.collection("policies").deleteMany({ groupId: group.id })).deletedCount;
  return removed;
};

// ----------------------------------------------------------- test purge ----
export const findTestGroups = async (db) => {
  const groups = await db.collection("groups").find({ name: { $in: TEST_GROUP_NAMES }, legacyCompanyId: { $in: [null] } }).toArray();
  const out = [];
  for (const g of groups) {
    const members = await db.collection("users").find({ "memberships.groupId": g.id }, { projection: { email: 1, memberships: 1 } }).toArray();
    const safe = members.every((u) => TEST_EMAIL.test(u.email));
    out.push({ id: g.id, name: g.name, plan: g.plan, members: members.map((u) => u.email), purgeable: safe });
  }
  return out;
};

const purgeTestGroups = async (db, groups) => {
  let users = 0;
  for (const g of groups.filter((x) => x.purgeable)) {
    for (const c of GROUP_SCOPED) await db.collection(c).deleteMany({ groupId: g.id });
    await db.collection("policies").deleteMany({ groupId: g.id });
    await db.collection("entities").deleteMany({ groupId: g.id });
    // drop the membership; delete the test user only if nothing else is left
    await db.collection("users").updateMany({ "memberships.groupId": g.id }, { $pull: { memberships: { groupId: g.id } } });
    users += (await db.collection("users").deleteMany({ email: TEST_EMAIL, memberships: { $size: 0 } })).deletedCount;
    await db.collection("groups").deleteOne({ id: g.id });
  }
  return { groups: groups.filter((x) => x.purgeable).length, users };
};

// --------------------------------------------------------------- write ----
const supplierRecord = (s, groupId, { analyst, manager }, today) => ({
  id: s.id, groupId, legalName: s.legalName, tradeNames: [],
  gstins: [{ gstin: s.gstin, stateCode: s.stateCode, status: "active" }],
  pan: s.pan,
  ...(s.udyam ? { udyam: { number: s.udyam.number, category: s.udyam.category, verifiedAt: "2026-03-18" } } : {}),
  msme: s.msme,
  bankAccounts: [{
    id: `acc_cur_${s.key}`, accountMasked: s.bankMasked, masked: s.bankMasked, ifsc: s.bank.ifsc, bank: s.bank.bank,
    accountHash: accountHash(s.bank.accountNo, s.bank.ifsc), holderName: s.legalName,
    status: "active", proposedBy: analyst, approvedBy: [manager],
    createdAt: istInstant("2026-03-18"), updatedAt: istInstant("2026-03-20"),
  }],
  paymentTermsDays: s.termsDays,
  contacts: [s.contact],
  tags: [s.msme ? `msme-${s.udyam.category}` : "large-enterprise", s.stateCode === ENTITY.stateCode ? "intra-state" : "inter-state"],
  addresses: [{ label: "Registered office & works", line1: s.address.line1, city: s.address.city, state: stateName(s.stateCode), stateCode: s.stateCode, pin: s.address.pin }],
  provenance: "CONSTRUCTED_DEMO",
  createdAt: istInstant("2026-03-18"), updatedAt: istInstant(today),
});
const stateName = (code) => ({ "06": "Haryana", 24: "Gujarat", 27: "Maharashtra", 29: "Karnataka", 33: "Tamil Nadu" })[code];

const policyRecord = (entityId, groupId, nextSeq) => {
  const prefixType = { PO: "PO", GRN: "GRN", QC: "QC", RTN: "RETURN", PV: "PAYMENT_OUT" };
  const series = Object.entries(nextSeq).map(([key, seq]) => {
    const [prefix, fy] = key.split("|");
    return { docType: prefixType[prefix], pattern: `{ENT}/${prefix}/{FY}/{SEQ:6}`, nextSeq: seq, fy };
  });
  return {
    entityId, groupId,
    tolerance: { priceAbs: "100.00", pricePct: "2", qtyPctByUom: { EA: "0", SET: "0", NOS: "0" } },
    doa: [
      { docType: "PO", maxAmount: "1000000.00", roles: ["ap_manager", "entity_admin"] },
      { docType: "PO", maxAmount: "10000000.00", roles: ["group_admin"] },
    ],
    numbering: [...DEFAULT_NUMBERING.map((n) => ({ ...n, nextSeq: 1 })), ...series],
    msme: { defaultDays: 45 },
    approvals: { requireMakerChecker: true },
    termsTemplates: DEFAULT_TERMS,
    autoConfirmHighConfidence: false,
    createdAt: new Date(), updatedAt: new Date(),
  };
};

const entityPatch = () => ({
  legalName: ENTITY.legalName, tradeName: ENTITY.tradeName, gstin: ENTITY.gstin, pan: ENTITY.pan, cin: ENTITY.cin,
  stateCode: ENTITY.stateCode, aatoBand: ENTITY.aatoBand, einvoiceApplicable: ENTITY.einvoiceApplicable,
  addresses: { billing: { ...ENTITY.address }, shipping: [{ ...ENTITY.shipping }] },
  lut: [{ ...ENTITY.lut }],
  bankAccounts: [{ masked: `****${ENTITY.bank.accountNo.slice(-4)}`, accountMasked: `****${ENTITY.bank.accountNo.slice(-4)}`, ifsc: ENTITY.bank.ifsc, bank: ENTITY.bank.bank, status: "active" }],
  "letterhead.footerText": `Registered office: ${ENTITY.address.line1}, ${ENTITY.address.city} ${ENTITY.address.pin} · CIN ${ENTITY.cin} · GSTIN ${ENTITY.gstin}`,
});

// ------------------------------------------------------------ reconcile ----
const enqueueReconciles = async (groupId, caseIds) => {
  const now = new Date();
  const jobs = caseIds.map((caseId) => ({
    id: newId("job"), groupId, kind: "reconcile", status: "queued", progress: 0,
    payload: { caseId }, attempts: 0, maxAttempts: 5, runAfter: now, createdAt: now, updatedAt: now,
  }));
  if (jobs.length) await Job.collection.insertMany(jobs);
  return jobs;
};

// Run the server's own reconcile service in-process, marking each job as the
// runner would. Requires the engine (ENGINE_API_URL, NODE_INTERNAL_TOKEN).
const reconcileNow = async (jobs, log) => {
  const { runReconcile } = await import("../services/reconcile.js");
  let ok = 0;
  for (const job of jobs) {
    await Job.updateOne({ id: job.id }, { $set: { status: "running" }, $inc: { attempts: 1 } });
    try {
      const result = await runReconcile(job.payload, job);
      await Job.updateOne({ id: job.id }, { $set: { status: "completed", result, progress: 100 } });
      ok++;
    } catch (e) {
      await Job.updateOne({ id: job.id }, { $set: { status: "queued", error: e.message, runAfter: new Date(Date.now() + 5000) } });
      log(`  reconcile ${job.payload.caseId} failed: ${e.message} (left queued for the server's job runner)`);
    }
  }
  return ok;
};

// Expected vs actual engine findings per story.
export const storyReport = async (groupId, ds) => {
  const rows = [];
  for (const story of STORIES) {
    const caseId = `case_cur_${story.id.toLowerCase()}`;
    const chain = new Set(ds.documents.filter((d) => d.caseId === caseId).map((d) => d.id));
    const findings = await Finding.find({ groupId, caseId }).lean();
    const own = [], leaked = [];
    for (const f of findings) {
      const ev = (f.data?.evidence || []).map((e) => e.documentId).filter(Boolean);
      (ev.length && ev.every((id) => !chain.has(id)) ? leaked : own).push(f.code);
    }
    const ownSet = [...new Set(own)].sort();
    rows.push({
      id: story.id, title: story.title, expected: [...story.expected].sort(), actual: ownSet,
      missing: story.expected.filter((c) => !ownSet.includes(c)),
      extra: ownSet.filter((c) => !story.expected.includes(c)),
      leaked: [...new Set(leaked)].sort(), reconciled: findings.length > 0 || Boolean((await Case.findOne({ id: caseId }).lean())?.latestSnapshotId),
    });
  }
  return rows;
};

// ---------------------------------------------------------------- main ----
export const seedCurated = async ({ dryRun = false, reconcile = false, purgeTests = false, log = console.log } = {}) => {
  const today = istDate();
  const conn = await connect();
  const { db } = conn;
  try {
    log(`Curated demo seed → database "${conn.dbName}", today (IST) ${today}${dryRun ? " — DRY RUN, nothing is written" : ""}`);
    let group = await findDemoGroup(db);
    const existingEntity = group ? await db.collection("entities").findOne({ groupId: group.id, code: ENTITY.code }) : null;

    // Build with real ids when they exist (dry-run on an empty DB uses placeholders).
    const users = await db.collection("users").find({ email: { $in: DEMO_USERS.map((u) => u.email) } }).toArray();
    const v2 = (email) => users.find((u) => u.email === email)?.v2id || `usr_pending_${email.split("@")[0]}`;
    let actors = { analyst: v2("analyst@satya.demo"), manager: v2("manager@satya.demo") };
    let ds = buildDataset({ today, groupId: group?.id || "grp_pending", entityId: existingEntity?.id || "ent_pending", actors });
    const pre = validateDataset({ ...ds, today });
    printReport(pre, log);
    if (!pre.ok) throw new Error("Curated dataset failed validation — nothing written");

    const counts = {
      suppliers: SUPPLIERS.length, items: ds.items.length, purchaseOrders: ds.cases.length, documents: ds.documents.length, links: ds.links.length,
      byType: ds.documents.reduce((m, d) => ({ ...m, [d.type]: (m[d.type] || 0) + 1 }), {}),
    };
    log(`\nDataset: ${JSON.stringify(counts)}`);

    const tests = purgeTests ? await findTestGroups(db) : [];
    if (purgeTests) {
      log(`\nTest groups matching ${JSON.stringify(TEST_GROUP_NAMES)}: ${tests.length} (${tests.filter((t) => t.purgeable).length} purgeable)`);
      for (const t of tests) log(`  ${t.purgeable ? "purge" : "KEEP "} ${t.id} ${t.name} [${t.members.join(", ") || "no members"}]`);
    }

    if (dryRun) {
      if (group) log(`\nWould wipe demo group ${group.id}: ${JSON.stringify(await countDemoData(db, group))}`);
      else log("\nNo demo group yet — it would be created.");
      return { ok: true, dryRun: true, counts };
    }

    // 1. accounts + tenant (memberships exist without anyone logging in)
    const accounts = await ensureDemoAccounts(DEMO_USERS.map((u) => ({ ...u, companyId: DEMO_COMPANY_ID })));
    log(`\nDemo users: ${accounts.map((a) => `${a.email}${a.created ? " (created)" : ""}`).join(", ")}`);
    group = await findDemoGroup(db);
    actors = { analyst: accounts.find((a) => a.email === "analyst@satya.demo").v2id, manager: accounts.find((a) => a.email === "manager@satya.demo").v2id };
    let entity = await db.collection("entities").findOne({ groupId: group.id, code: ENTITY.code }) || await db.collection("entities").findOne({ groupId: group.id });
    if (!entity) throw new Error("Demo entity missing after ensureLegacyTenant");

    // 2. wipe
    const removed = await wipeDemoGroup(db, group, entity.id);
    log(`Wiped demo group ${group.id}: ${JSON.stringify(removed)}`);
    if (purgeTests) log(`Purged test tenants: ${JSON.stringify(await purgeTestGroups(db, tests))}`);

    // 3. write
    await Group.updateOne({ id: group.id }, { $set: { name: "Satya Equipment Distribution", legalName: ENTITY.legalName, plan: "demo" } });
    await Entity.updateOne({ id: entity.id }, { $set: { ...entityPatch(), code: ENTITY.code } });
    ds = buildDataset({ today, groupId: group.id, entityId: entity.id, actors });
    const final = validateDataset({ ...ds, today });
    if (!final.ok) { printReport(final, log); throw new Error("Dataset with real ids failed validation"); }

    await db.collection("suppliers").insertMany(SUPPLIERS.map((s) => supplierRecord(s, group.id, actors, today)));
    await db.collection("items").insertMany(ds.items.map((i) => ({ ...i, createdAt: istInstant("2026-03-18"), updatedAt: istInstant("2026-03-18") })));
    await Policy.collection.insertOne(policyRecord(entity.id, group.id, ds.nextSeq));
    await db.collection("documents").insertMany(ds.documents);
    await db.collection("documentlinks").insertMany(ds.links.map((l) => {
      const at = new Date(ds.documents.find((d) => d.id === l.fromId).observedAt);
      return { ...l, createdAt: at, updatedAt: at };
    }));
    await db.collection("cases").insertMany(ds.cases);
    const { writeAudit } = await import("../services/audit.js");
    await writeAudit({ groupId: group.id, entityId: entity.id, actor: "system:curated-seed", actorRole: "system", action: "SEED curated demo dataset", target: { purchaseOrders: ds.cases.length, documents: ds.documents.length }, statusCode: 201 });
    log(`Wrote ${SUPPLIERS.length} suppliers, ${ds.items.length} items, ${ds.documents.length} documents, ${ds.links.length} links, ${ds.cases.length} cases`);

    // 4. reconcile
    const jobs = await enqueueReconciles(group.id, ds.cases.map((c) => c.id));
    log(`Enqueued ${jobs.length} reconcile jobs (the server's job runner picks them up)`);
    if (reconcile) {
      const done = await reconcileNow(jobs, log);
      log(`Reconciled ${done}/${jobs.length} cases in-process`);
      const rows = await storyReport(group.id, ds);
      log("\nStory | expected | actual (own chain) | extra | missing | leaked from other cases");
      for (const r of rows) log(`${r.id} | ${r.expected.join(",") || "—"} | ${r.actual.join(",") || "—"} | ${r.extra.join(",") || "—"} | ${r.missing.join(",") || "—"} | ${r.leaked.join(",") || "—"}`);
    }

    // 5. validate what is actually stored
    const stored = validateDataset({ ...(await loadFromDb(db, group.id)), today });
    log("\nValidation of stored data:");
    printReport(stored, log);
    if (!stored.ok) throw new Error("Stored dataset failed validation");
    return { ok: true, groupId: group.id, entityId: entity.id, counts };
  } finally {
    await conn.close();
  }
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = new Set(process.argv.slice(2));
  seedCurated({ dryRun: args.has("--dry-run"), reconcile: args.has("--reconcile-now"), purgeTests: args.has("--purge-test-groups") })
    .then(() => process.exit(0))
    .catch((e) => { console.error(`\nCurated seed failed: ${e.message}`); process.exit(1); });
}
