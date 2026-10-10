import crypto from "node:crypto";
import User from "./models/User.js";
import { BusinessCase, BusinessRecord } from "./models/Business.js";
import { engine, inputFor, publish } from "./utils/businessService.js";

export default async function seedDemoUsers() {
  if (process.env.DEMO_MODE !== "1") return;
  if (process.env.SEED_DEMO_USERS !== "0") {
    for (const user of [
      { name: "Finance Manager", email: "manager@satya.demo", role: "ap_manager", companyId: "satya-demo" },
      { name: "Operations Analyst", email: "analyst@satya.demo", role: "ops_analyst", companyId: "satya-demo" },
      { name: "Independent Auditor", email: "auditor@satya.demo", role: "auditor", companyId: "satya-demo" },
      { name: "Other Company Auditor", email: "isolated@satya.demo", role: "auditor", companyId: "isolated-demo" },
      { name: "Contract Test Manager", email: "tester@satya.demo", role: "ap_manager", companyId: "satya-contract-tests" },
    ]) {
      if (!(await User.exists({ email: user.email }))) await User.create({ ...user, password: process.env.DEMO_PASSWORD || "SatyaDemo@123", active: true });
    }
  }
  const bundle = await engine("demo");
  for (const item of bundle.cases) {
    if (await BusinessCase.exists({ companyId: bundle.company.id, id: item.id })) continue;
    for (const record of item.records) {
      await BusinessRecord.updateOne({ companyId: bundle.company.id, id: record.id }, { $setOnInsert: { caseId: item.id, kind: record.type, data: record, ...(record.amount ? { amount: record.amount } : {}), sourceChecksum: crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex") } }, { upsert: true });
    }
    const businessCase = await BusinessCase.create({ companyId: bundle.company.id, id: item.id, title: item.title, sector: item.sector, poId: item.poId, supplier: item.supplier, recordIds: item.records.map((record) => record.id), demoClock: bundle.clock });
    const input = await inputFor(businessCase);
    await publish(businessCase, input, await engine("reconcile", input));
  }
}
