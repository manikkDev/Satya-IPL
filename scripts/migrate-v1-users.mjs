// Idempotent v1 -> v2 identity migration (04 P1-B2).
// Every user with a legacy companyId gets: a Group (legacyCompanyId key),
// one Entity, and a membership mapped via LEGACY_ROLE_MAP. Safe to re-run.
// Usage: node --env-file=server/.env scripts/migrate-v1-users.mjs
import mongoose from "../server/node_modules/mongoose/index.js";

const { default: User } = await import("../server/src/models/User.js");
const { ensureMemberships } = await import("../server/src/services/identity.js");

const uri = process.env.MONGO_URI || process.env.DB_URI;
if (!uri) {
  console.error("DB_URI/MONGO_URI not set — run with node --env-file=server/.env");
  process.exit(1);
}
await mongoose.connect(uri, { dbName: process.env.APP_DB_NAME || "satya" });

const users = await User.find({ companyId: { $exists: true, $ne: null } });
let migrated = 0;
let skipped = 0;
for (const user of users) {
  const had = (user.memberships || []).length > 0;
  await ensureMemberships(user);
  had ? skipped++ : migrated++;
}
console.log(`migrate-v1-users: ${migrated} migrated, ${skipped} already had memberships (${users.length} total)`);
await mongoose.disconnect();
