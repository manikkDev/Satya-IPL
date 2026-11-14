// First-run setup API (server/src/routes/v2/onboarding.js).
//   authenticated: /api/v2/onboarding/{status,company,dismiss,invites}
//   public:        /api/v2/auth/{invites/:token,accept-invite}
// When the onboarding routes are not deployed yet (404), status is derived
// from existing endpoints so the checklist still works read-only.

import { ApiError, fetchJson } from "./client";
import { mocksEnabled } from "@/lib/flags";

export type OnboardingEntity = {
  id: string; code: string; legalName: string; tradeName: string | null;
  gstin: string | null; pan: string | null; stateCode: string | null; stateName: string | null;
  address: { line1?: string; line2?: string; city?: string; pin?: string; state?: string } | null;
};

export type OnboardingStatus = {
  groupId: string;
  groupName: string | null;
  plan: string | null;
  steps: {
    company: { done: boolean; entity: OnboardingEntity | null };
    data: { done: boolean; documents: number; files: number; suppliers: number };
    team: { done: boolean; members: number; pendingInvites: number };
    firstCheck: { done: boolean; cases: number };
  };
  completed: number;
  total: number;
  isNew: boolean;
  dismissedAt: string | null;
  canManage: boolean;
  canInvite: boolean;
  /** true when derived on the client because the server routes are missing */
  derived?: boolean;
};

export type TeamMember = { id: string; name: string; email: string; roles: string[] };
export type Invite = { id: string; email: string; roles: string[]; entityId: string; status: string; invitedByName: string | null; expiresAt: string; createdAt: string };
export type InviteLookup = { email: string; roles: string[]; groupName: string; invitedByName: string | null; expiresAt: string; hasAccount: boolean };

const MOCK_STATUS: OnboardingStatus = {
  groupId: "grp_demo", groupName: "Vishwas Pumps", plan: "demo",
  steps: {
    company: { done: true, entity: { id: "ent_vppl", code: "VPPL", legalName: "Vishwas Pumps Pvt Ltd", tradeName: null, gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F", stateCode: "27", stateName: "Maharashtra", address: null } },
    data: { done: true, documents: 24, files: 6, suppliers: 5 },
    team: { done: false, members: 1, pendingInvites: 0 },
    firstCheck: { done: true, cases: 3 },
  },
  completed: 3, total: 4, isNew: false, dismissedAt: null, canManage: true, canInvite: true,
};

type MeLite = { entities: { id: string; code: string; legalName: string; tradeName?: string; gstin?: string; stateCode?: string }[]; activeGroup: { id: string; name: string; plan?: string }; permissions: Record<string, string[]> };

/** Fallback when /onboarding/status is not mounted: derive from /me, /documents, /cases. */
async function deriveStatus(): Promise<OnboardingStatus> {
  const [me, docs, cases] = await Promise.all([
    fetchJson<MeLite>("/api/v2/me"),
    fetchJson<{ items: unknown[] }>("/api/v2/documents?limit=1").catch(() => ({ items: [] })),
    fetchJson<{ items: { latestSnapshotId?: string | null }[] }>("/api/v2/cases?limit=20").catch(() => ({ items: [] })),
  ]);
  const entity = me.entities[0];
  const perms = Object.values(me.permissions ?? {}).flat();
  const steps: OnboardingStatus["steps"] = {
    company: {
      done: Boolean(entity?.gstin),
      entity: entity ? { id: entity.id, code: entity.code, legalName: entity.legalName, tradeName: entity.tradeName ?? null, gstin: entity.gstin ?? null, pan: null, stateCode: entity.stateCode ?? null, stateName: null, address: null } : null,
    },
    data: { done: docs.items.length > 0, documents: docs.items.length, files: 0, suppliers: 0 },
    team: { done: false, members: 1, pendingInvites: 0 },
    firstCheck: { done: cases.items.some((c) => c.latestSnapshotId), cases: cases.items.length },
  };
  return {
    groupId: me.activeGroup.id, groupName: me.activeGroup.name, plan: me.activeGroup.plan ?? null, steps,
    completed: Object.values(steps).filter((s) => s.done).length, total: 4,
    isNew: docs.items.length === 0, dismissedAt: null,
    canManage: perms.includes("entity.manage"), canInvite: perms.includes("user.manage"), derived: true,
  };
}

export const onboarding = {
  status: async (): Promise<OnboardingStatus> => {
    if (mocksEnabled()) return structuredClone(MOCK_STATUS);
    try {
      return await fetchJson<OnboardingStatus>("/api/v2/onboarding/status");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return deriveStatus();
      throw error;
    }
  },
  saveCompany: (body: { entityId?: string; legalName: string; tradeName?: string; gstin: string; address?: { line1: string; line2?: string; city: string; pin: string } }) =>
    fetchJson<{ entity: OnboardingEntity }>("/api/v2/onboarding/company", { method: "PATCH", body }),
  dismiss: (dismissed: boolean) =>
    fetchJson<{ dismissedAt: string | null }>("/api/v2/onboarding/dismiss", { method: "PATCH", body: { dismissed } }),
  team: () => fetchJson<{ members: TeamMember[]; invites: Invite[] }>("/api/v2/onboarding/invites"),
  invite: (body: { email: string; role: string; entityId?: string }) =>
    fetchJson<{ invite: Invite; token: string; joinPath: string }>("/api/v2/onboarding/invites", { method: "POST", body }),
  revokeInvite: (id: string) => fetchJson<{ invite: Invite }>(`/api/v2/onboarding/invites/${encodeURIComponent(id)}`, { method: "DELETE" }),
  lookupInvite: (token: string) => fetchJson<InviteLookup>(`/api/v2/auth/invites/${encodeURIComponent(token)}`, { auth: false }),
};

/** Per-browser "hide setup" memory, used when the server can't store it. */
export const setupDismissKey = (groupId: string) => `satya.setup.dismissed.${groupId}`;
