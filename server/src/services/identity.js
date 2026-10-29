import Group from "../models/Group.js";
import Entity from "../models/Entity.js";
import { newId } from "../lib/ids.js";

// Legacy role -> v2 roles (04 P1-B2 mapping, frozen).
export const LEGACY_ROLE_MAP = {
  ops_analyst: ["buyer", "ap_clerk"],
  ap_manager: ["ap_manager"],
  auditor: ["auditor"],
  admin: ["group_admin"],
};

const entityCodeFor = (companyId) => {
  const code = String(companyId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return code || "ENT";
};

const companyNameFor = (companyId) =>
  companyId === "satya-demo"
    ? "Satya Equipment Distribution"
    : `${String(companyId).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;

// Idempotent: a legacy companyId maps to exactly one Group + one Entity.
// Called lazily on v2 login and eagerly by scripts/migrate-v1-users.mjs.
export const ensureLegacyTenant = async (companyId) => {
  let group = await Group.findOne({ legacyCompanyId: companyId });
  if (!group) {
    group = await Group.create({
      id: newId("grp"),
      name: companyNameFor(companyId),
      legalName: companyNameFor(companyId),
      plan: companyId === "satya-demo" ? "demo" : "internal",
      legacyCompanyId: companyId,
    }).catch(async (err) => {
      if (err?.code !== 11000) throw err;
      return Group.findOne({ legacyCompanyId: companyId });
    });
  }
  let entity = await Entity.findOne({ groupId: group.id });
  if (!entity) {
    entity = await Entity.create({
      id: newId("ent"),
      groupId: group.id,
      code: entityCodeFor(companyId),
      legalName: group.legalName || group.name,
      tradeName: group.name,
    });
  }
  return { group, entity };
};

// Ensure a legacy companyId user has v2 memberships; mutates+ saves user once.
export const ensureMemberships = async (user) => {
  if (user.memberships?.length || !user.companyId) return user;
  const { group } = await ensureLegacyTenant(user.companyId);
  const roles = LEGACY_ROLE_MAP[user.role] || ["buyer"];
  user.memberships = [{ groupId: group.id, entityId: "*", roles }];
  if (!user.activeGroupId) user.activeGroupId = group.id;
  if (!user.v2id) user.v2id = newId("usr");
  await user.save();
  return user;
};

// Trial signup: a fresh group + first entity + the caller as group_admin.
export const createTenant = async ({ groupName, entityCode, entityLegalName, stateCode }) => {
  const group = await Group.create({
    id: newId("grp"),
    name: groupName,
    legalName: entityLegalName || groupName,
    plan: "trial",
  });
  const entity = await Entity.create({
    id: newId("ent"),
    groupId: group.id,
    code: entityCode || "ENT",
    legalName: entityLegalName || groupName,
    stateCode,
  });
  return { group, entity };
};
