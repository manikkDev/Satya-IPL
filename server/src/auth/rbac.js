// RBAC per 01 §8 — the authoritative matrix. Roles are assigned per entity
// inside a membership; group_admin/platform_admin apply group-wide.

export const ROLES = [
  "platform_admin", "group_admin", "entity_admin", "requester", "buyer",
  "stores", "quality", "ap_clerk", "ap_manager", "treasury", "auditor",
];

export const PERMISSIONS = [
  "group.manage", "entity.manage", "user.manage", "policy.manage",
  "pr.raise", "po.create", "po.approve",
  "grn.record", "qc.record", "doc.upload", "import.data",
  "finding.decide",
  "payment.release.maker", "payment.release.checker",
  "supplier.bank.maker", "supplier.bank.checker",
  "evidence.export", "audit.read", "copilot.use",
];

const EVERYONE = [...ROLES];

const ROLE_PERMISSIONS = {
  platform_admin: [...PERMISSIONS],
  group_admin: [
    "group.manage", "entity.manage", "user.manage", "policy.manage",
    "po.approve", "supplier.bank.maker", "evidence.export", "audit.read", "copilot.use",
  ],
  entity_admin: [
    "entity.manage", "user.manage", "policy.manage",
    "po.approve", "supplier.bank.maker", "evidence.export", "audit.read", "copilot.use",
  ],
  requester: ["pr.raise", "copilot.use"],
  buyer: ["pr.raise", "po.create", "doc.upload", "copilot.use"],
  stores: ["grn.record", "doc.upload", "copilot.use"],
  quality: ["qc.record", "copilot.use"],
  ap_clerk: ["doc.upload", "import.data", "copilot.use"],
  ap_manager: [
    "po.approve", "doc.upload", "import.data", "finding.decide",
    "payment.release.maker", "supplier.bank.checker",
    "evidence.export", "audit.read", "copilot.use",
  ],
  treasury: ["import.data", "payment.release.checker", "supplier.bank.checker", "copilot.use"],
  auditor: ["evidence.export", "audit.read", "copilot.use"],
};

const sets = Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, new Set(perms)]));

export const can = (role, permission) => sets[role]?.has(permission) ?? false;
export const permissionsFor = (roles = []) => [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role] || []))];

// req.scope is built by loadScope (auth/middleware.js):
// { groupId, entityIds, wildcard, rolesByEntity: {"*"|entityId: [roles]}, isPlatformAdmin }
export const scopeAllows = (scope, permission, entityId) => {
  if (!scope) return false;
  if (scope.isPlatformAdmin) return true;
  const roles = new Set(scope.rolesByEntity["*"] || []);
  if (entityId) (scope.rolesByEntity[entityId] || []).forEach((role) => roles.add(role));
  if (!entityId && !scope.wildcard) {
    // collection-level check: allowed if held on any in-scope entity
    Object.values(scope.rolesByEntity).flat().forEach((role) => roles.add(role));
  }
  return [...roles].some((role) => can(role, permission));
};

export const requirePermission = (permission, { entityFrom } = {}) => (req, res, next) => {
  const entityId = typeof entityFrom === "function"
    ? entityFrom(req)
    : req.params?.entityId || req.body?.entityId || req.query?.entityId;
  if (scopeAllows(req.scope, permission, entityId)) return next();
  return res.status(403).json({
    error: {
      code: "FORBIDDEN",
      message: "Your role does not allow this action",
      details: { reason: `Requires ${permission} on this entity` },
      requestId: req.id,
    },
  });
};
