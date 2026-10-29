import express from "express";
import Group from "../../models/Group.js";
import Entity from "../../models/Entity.js";
import { permissionsFor } from "../../auth/rbac.js";

const router = express.Router();

// GET /api/v2/me — identity, memberships and resolved permissions (02 §5.1).
router.get("/", async (req, res, next) => {
  try {
    const { user, scope } = req;
    const [group, entities] = await Promise.all([
      Group.findOne({ id: scope.groupId }).select("id name plan").lean(),
      Entity.find({ id: { $in: scope.entityIds } }).select("id code legalName tradeName stateCode gstin parentEntityId").lean(),
    ]);
    res.json({
      user: { id: user.v2id || String(user._id), name: user.name, email: user.email, platformRole: user.platformRole || undefined },
      memberships: (user.memberships || []).map((m) => ({ groupId: m.groupId, entityId: m.entityId, roles: m.roles })),
      activeGroup: group ? { id: group.id, name: group.name, plan: group.plan } : { id: scope.groupId },
      entities,
      permissions: Object.fromEntries(
        Object.entries(scope.rolesByEntity).map(([entityId, roles]) => [entityId, permissionsFor(roles)])
      ),
    });
  } catch (error) { next(error); }
});

export default router;
