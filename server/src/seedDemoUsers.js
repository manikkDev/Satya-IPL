import crypto from "node:crypto";
import { BusinessCase, BusinessRecord } from "./models/Business.js";
import { engine, inputFor, publish } from "./utils/businessService.js";
import { ensureDemoAccounts } from "./seed/users.js";
import { DEMO_USERS, DEMO_COMPANY_ID } from "./seed/company.js";

// Boot-time demo provisioning (DEMO_MODE=1). Fast and never throws:
//  - ensures the demo accounts exist WITH v2 memberships (no login needed);
//    existing passwords are untouched unless DEMO_RESET_PASSWORDS=1
//  - does NOT write v2 business data — the curated company comes only from
//    `node src/seed/curated.js` (docs/DEMO_DATASET.md)
//  - the legacy v1 engine fixtures (/internal/demo, used by the v1 /cases
//    pages) are loaded in the background: one attempt, short timeout,
//    failures logged and ignored.
const TEST_ACCOUNTS = [
  { name: "Other Company Auditor", email: "isolated@satya.demo", role: "auditor", companyId: "isolated-demo" },
  { name: "Contract Test Manager", email: "tester@satya.demo", role: "ap_manager", companyId: "satya-contract-tests" },
  { name: "Contract Test Analyst", email: "test-analyst@satya.demo", role: "ops_analyst", companyId: "satya-contract-tests" },
];

const loadLegacyV1Fixtures = async () => {
  const bundle = await Promise.race([
    engine("demo"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 8s")), 8000)),
  ]);
  let loaded = 0;
  for (const item of bundle.cases) {
    if (await BusinessCase.exists({ companyId: bundle.company.id, id: item.id })) continue;
    for (const record of item.records) {
      await BusinessRecord.updateOne({ companyId: bundle.company.id, id: record.id }, { $setOnInsert: { caseId: item.id, kind: record.type, data: record, ...(record.amount ? { amount: record.amount } : {}), sourceChecksum: crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex") } }, { upsert: true });
    }
    const businessCase = await BusinessCase.create({ companyId: bundle.company.id, id: item.id, title: item.title, sector: item.sector, poId: item.poId, supplier: item.supplier, recordIds: item.records.map((record) => record.id), demoClock: bundle.clock });
    const input = await inputFor(businessCase);
    await publish(businessCase, input, await engine("reconcile", input));
    loaded++;
  }
  return loaded;
};

export default async function seedDemoUsers() {
  if (process.env.DEMO_MODE !== "1") return;
  try {
    if (process.env.SEED_DEMO_USERS !== "0") {
      const accounts = [
        ...DEMO_USERS.map(({ name, email, role, roles }) => ({ name, email, role, roles, companyId: DEMO_COMPANY_ID })),
        ...TEST_ACCOUNTS,
      ];
      const result = await ensureDemoAccounts(accounts);
      const created = result.filter((r) => r.created).map((r) => r.email);
      console.log(`Demo accounts ready (${result.length})${created.length ? `; created ${created.join(", ")}` : ""}`);
    }
  } catch (error) {
    console.warn(`Demo account provisioning skipped: ${error.message}`);
  }
  // v1 fixtures: background, single attempt — never blocks or crashes boot.
  if (process.env.SEED_V1_FIXTURES !== "0") {
    loadLegacyV1Fixtures()
      .then((n) => n && console.log(`Legacy v1 demo fixtures loaded: ${n} case(s)`))
      .catch((error) => console.warn(`Legacy v1 demo fixtures skipped: ${error.message}`));
  }
}
