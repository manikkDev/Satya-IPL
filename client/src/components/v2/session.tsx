"use client";

// Session context for /app. With NEXT_PUBLIC_USE_MOCKS=1 it serves the demo
// group (Vishwas Pumps) without touching auth; otherwise it wraps the real
// auth context. Entities beyond mocks come from GET /api/v2/me (Agent B) — the
// switcher hides itself when only one/no entity is known.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { mocksEnabled } from "@/lib/flags";
import { mockEntities, mockUser } from "@/lib/mocks/flagship";

export type SessionEntity = (typeof mockEntities)[number];

export type SessionValue = {
  user: { name: string; email: string; roles: string[] } | null;
  entities: SessionEntity[];
  activeEntity: SessionEntity | null;
  setActiveEntityId: (id: string) => void;
  mocks: boolean;
  loading: boolean;
  logout: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const mocks = mocksEnabled();
  const { user: authUser, isLoading, logout } = useAuth();
  const [activeEntityId, setActiveEntityId] = useState<string>(mockEntities[0].id);

  const value = useMemo<SessionValue>(() => {
    const entities = mocks ? mockEntities : [];
    const activeEntity = entities.find((entity) => entity.id === activeEntityId) ?? entities[0] ?? null;
    return {
      user: mocks
        ? { name: mockUser.name, email: mockUser.email, roles: mockUser.roles }
        : authUser
          ? { name: authUser.name || authUser.email, email: authUser.email, roles: [authUser.role] }
          : null,
      entities,
      activeEntity,
      setActiveEntityId,
      mocks,
      loading: !mocks && isLoading,
      logout,
    };
  }, [mocks, authUser, isLoading, logout, activeEntityId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
