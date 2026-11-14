"use client";

// Session context for /app. With NEXT_PUBLIC_USE_MOCKS=1 it serves the demo
// group (Vishwas Pumps) without touching auth; otherwise it wraps the real
// auth context and resolves entities + permissions from GET /api/v2/me.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { mocksEnabled } from "@/lib/flags";
import { mockEntities, mockUser } from "@/lib/mocks/flagship";
import { v2, type MeResponse } from "@/lib/api/v2";

export type SessionEntity = (typeof mockEntities)[number];

export type SessionValue = {
  user: { name: string; email: string; roles: string[] } | null;
  /** Active workspace (company group); plan "demo" marks the fictional demo company. */
  group: { id: string; name: string; plan?: string } | null;
  entities: SessionEntity[];
  activeEntity: SessionEntity | null;
  setActiveEntityId: (id: string) => void;
  permissions: Record<string, string[]>;
  /** True when the user holds `perm` on the active entity (or any entity when
   *  none is selected). Mirrors B's RBAC matrix; server still enforces. */
  hasPermission: (perm: string, entityId?: string) => boolean;
  mocks: boolean;
  loading: boolean;
  /** Set when GET /me failed — the shell shows a retry banner. */
  meError: string | null;
  retryMe: () => void;
  logout: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const mocks = mocksEnabled();
  const { user: authUser, isLoading, logout } = useAuth();
  const [activeEntityId, setActiveEntityId] = useState<string>(mockEntities[0].id);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const retryMe = useCallback(() => setMeAttempt((n) => n + 1), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (mocks || !authUser) return;
    let live = true;
    setMeError(null);
    v2.me()
      .then((data) => {
        if (!live) return;
        setMe(data);
        setActiveEntityId((current) =>
          data.entities.some((e) => e.id === current) ? current : (data.entities[0]?.id ?? current),
        );
      })
      .catch((error) => {
        if (!live) return;
        setMeError(error instanceof Error ? error.message : "Your workspace details couldn’t be loaded.");
      });
    return () => {
      live = false;
    };
  }, [mocks, authUser, meAttempt]);

  // Switching entity refetches every query so no page shows another entity's data.
  const lastEntity = useRef<string | null>(null);
  useEffect(() => {
    if (lastEntity.current && lastEntity.current !== activeEntityId) void queryClient.invalidateQueries();
    lastEntity.current = activeEntityId;
  }, [activeEntityId, queryClient]);

  const value = useMemo<SessionValue>(() => {
    const entities = mocks ? mockEntities : (me?.entities ?? []);
    const activeEntity = entities.find((entity) => entity.id === activeEntityId) ?? entities[0] ?? null;
    const permissions = me?.permissions ?? {};
    const hasPermission = (perm: string, entityId?: string) => {
      const target = entityId ?? activeEntity?.id;
      if (permissions["*"]?.includes(perm)) return true;
      if (target) return permissions[target]?.includes(perm) ?? false;
      return Object.values(permissions).some((list) => list.includes(perm));
    };
    const roles = mocks
      ? mockUser.roles
      : me?.memberships.filter((m) => m.groupId === me.activeGroup?.id).flatMap((m) => m.roles) ?? authUser?.roles ?? [];
    return {
      user: mocks
        ? { name: mockUser.name, email: mockUser.email, roles: mockUser.roles }
        : me
          ? { name: me.user.name, email: me.user.email, roles }
          : authUser
            ? { name: authUser.name || authUser.email, email: authUser.email, roles }
            : null,
      group: mocks ? { id: "grp_demo", name: "Vishwas Pumps", plan: "demo" } : (me?.activeGroup ?? null),
      entities,
      activeEntity,
      setActiveEntityId,
      permissions,
      hasPermission,
      mocks,
      loading: !mocks && isLoading,
      meError,
      retryMe,
      logout,
    };
  }, [mocks, authUser, me, isLoading, logout, activeEntityId, meError, retryMe]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
