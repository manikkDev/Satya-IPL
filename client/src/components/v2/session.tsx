"use client";

// Session context for /app. With NEXT_PUBLIC_USE_MOCKS=1 it serves the demo
// group (Vishwas Pumps) without touching auth; otherwise it wraps the real
// auth context and resolves entities + permissions from GET /api/v2/me.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { mocksEnabled } from "@/lib/flags";
import { mockEntities, mockUser } from "@/lib/mocks/flagship";
import { v2, type MeResponse } from "@/lib/api/v2";

export type SessionEntity = (typeof mockEntities)[number];

export type SessionValue = {
  user: { name: string; email: string; roles: string[] } | null;
  entities: SessionEntity[];
  activeEntity: SessionEntity | null;
  setActiveEntityId: (id: string) => void;
  permissions: Record<string, string[]>;
  /** True when the user holds `perm` on the active entity (or any entity when
   *  none is selected). Mirrors B's RBAC matrix; server still enforces. */
  hasPermission: (perm: string, entityId?: string) => boolean;
  mocks: boolean;
  loading: boolean;
  logout: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const mocks = mocksEnabled();
  const { user: authUser, isLoading, logout } = useAuth();
  const [activeEntityId, setActiveEntityId] = useState<string>(mockEntities[0].id);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    if (mocks || !authUser) return;
    let live = true;
    v2.me()
      .then((data) => {
        if (!live) return;
        setMe(data);
        setActiveEntityId((current) =>
          data.entities.some((e) => e.id === current) ? current : (data.entities[0]?.id ?? current),
        );
      })
      .catch(() => {
        // /me unavailable (old v1 token or cold start) — shell stays usable.
      });
    return () => {
      live = false;
    };
  }, [mocks, authUser]);

  const value = useMemo<SessionValue>(() => {
    const entities = mocks ? mockEntities : (me?.entities ?? []);
    const activeEntity = entities.find((entity) => entity.id === activeEntityId) ?? entities[0] ?? null;
    const permissions = me?.permissions ?? {};
    const hasPermission = (perm: string, entityId?: string) => {
      const target = entityId ?? activeEntity?.id;
      if (target) return permissions[target]?.includes(perm) ?? false;
      return Object.values(permissions).some((list) => list.includes(perm));
    };
    const roles = mocks
      ? mockUser.roles
      : me?.memberships.flatMap((m) => m.roles) ?? (authUser ? [authUser.role] : []);
    return {
      user: mocks
        ? { name: mockUser.name, email: mockUser.email, roles: mockUser.roles }
        : me
          ? { name: me.user.name, email: me.user.email, roles }
          : authUser
            ? { name: authUser.name || authUser.email, email: authUser.email, roles }
            : null,
      entities,
      activeEntity,
      setActiveEntityId,
      permissions,
      hasPermission,
      mocks,
      loading: !mocks && isLoading,
      logout,
    };
  }, [mocks, authUser, me, isLoading, logout, activeEntityId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
