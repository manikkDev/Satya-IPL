// Demo account provisioning shared by the curated seed and server boot
// (seedDemoUsers.js). Accounts get v2 memberships immediately — nobody has
// to log in first for the group/entity/roles to exist. Existing passwords are
// never touched unless DEMO_RESET_PASSWORDS=1.
import User from "../models/User.js";
import { ensureLegacyTenant, LEGACY_ROLE_MAP } from "../services/identity.js";
import { newId } from "../lib/ids.js";

export const demoPassword = () => process.env.DEMO_PASSWORD || "SatyaDemo@123";

// accounts: [{email, name, role, companyId, roles?}] — roles default from the
// legacy role map. Returns [{email, created, v2id, groupId}].
export const ensureDemoAccounts = async (accounts, { resetPasswords = process.env.DEMO_RESET_PASSWORDS === "1" } = {}) => {
  const out = [];
  for (const account of accounts) {
    const { group } = await ensureLegacyTenant(account.companyId);
    const roles = account.roles || LEGACY_ROLE_MAP[account.role] || ["buyer"];
    let user = await User.findOne({ email: account.email });
    let created = false;
    if (!user) {
      user = await User.create({
        name: account.name, email: account.email, password: demoPassword(), role: account.role,
        companyId: account.companyId, active: true, v2id: newId("usr"),
        memberships: [{ groupId: group.id, entityId: "*", roles }], activeGroupId: group.id,
      });
      created = true;
    } else {
      const memberships = (user.memberships || []).map((m) => ({ groupId: m.groupId, entityId: m.entityId, roles: m.roles }));
      const existing = memberships.find((m) => m.groupId === group.id && m.entityId === "*");
      if (existing) existing.roles = [...new Set([...existing.roles, ...roles])];
      else memberships.push({ groupId: group.id, entityId: "*", roles });
      const set = {
        name: account.name, role: account.role, companyId: account.companyId, active: true, memberships,
        activeGroupId: user.activeGroupId && memberships.some((m) => m.groupId === user.activeGroupId) ? user.activeGroupId : group.id,
        ...(user.v2id ? {} : { v2id: newId("usr") }),
      };
      await User.updateOne({ _id: user._id }, { $set: set });
      if (resetPasswords) {
        const fresh = await User.findById(user._id);
        fresh.password = demoPassword(); // pre-save hook re-hashes
        await fresh.save();
      }
      user = await User.findById(user._id).lean();
    }
    out.push({ email: account.email, created, v2id: user.v2id, groupId: group.id });
  }
  return out;
};
