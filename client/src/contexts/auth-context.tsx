"use client";

// Auth for the whole client, on the v2 identity API only:
//   POST /api/v2/auth/login · POST /api/v2/auth/signup · POST /api/v2/auth/accept-invite
//   → { token, user, memberships, activeGroup }
//   GET  /api/v2/me  → verifies a stored token on load
// The JWT lives in localStorage (read by lib/api/client). A non-secret
// `satya_session` cookie mirrors "signed in" so middleware can redirect
// /app → /login before any workspace UI renders. The API enforces access.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SERVER_URL } from "@/utils/commonHelper";
import { queryClient } from "@/lib/query-client";

/** Legacy single role, derived from v2 roles (kept for older components). */
export type LegacyRole = "ops_analyst" | "ap_manager" | "auditor" | "admin";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  /** v2 roles held in the active workspace (group). */
  roles: string[];
  role: LegacyRole;
  activeGroupId: string | null;
  platformRole?: string;
};

export type SessionPayload = {
  token: string;
  user: { id: string; name: string; email: string; platformRole?: string };
  memberships: { groupId: string; entityId: string; roles: string[] }[];
  activeGroup: string;
};

export type SignupInput = { name: string; email: string; password: string; companyName: string; entityCode?: string };
export type AuthResult = { success: boolean; error?: string; fields?: string[] };

type AuthContextType = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string, redirectTo?: string) => Promise<AuthResult>;
  signup: (input: SignupInput, redirectTo?: string) => Promise<AuthResult>;
  acceptInvite: (token: string, input: { name?: string; password: string }, redirectTo?: string) => Promise<AuthResult>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "token";
const USER_KEY = "user";
export const SESSION_COOKIE = "satya_session";

const legacyRoleFor = (roles: string[]): LegacyRole =>
  roles.includes("group_admin") || roles.includes("entity_admin") || roles.includes("platform_admin")
    ? "admin"
    : roles.includes("ap_manager")
      ? "ap_manager"
      : roles.includes("auditor")
        ? "auditor"
        : "ops_analyst";

const toAuthUser = (
  user: { id: string; name: string; email: string; platformRole?: string },
  memberships: { groupId: string; roles: string[] }[],
  activeGroupId: string | null,
): AuthUser => {
  const roles = [...new Set(memberships.filter((m) => !activeGroupId || m.groupId === activeGroupId).flatMap((m) => m.roles))];
  return { id: user.id, name: user.name || user.email, email: user.email, roles, role: legacyRoleFor(roles), activeGroupId, platformRole: user.platformRole };
};

function setSessionCookie(on: boolean) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = on
    ? `${SESSION_COOKIE}=1; Path=/; Max-Age=${12 * 3600}; SameSite=Lax${secure}`
    : `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AuthUser>) : null;
    return parsed && parsed.email && Array.isArray(parsed.roles) ? (parsed as AuthUser) : null;
  } catch {
    return null;
  }
}

/** v2 errors are {error:{message,details}}; the rate limiter sends {message}. */
async function errorFrom(response: Response, fallback: string): Promise<AuthResult> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string; details?: { fields?: (string | { field: string })[] } }; message?: string }
    | null;
  const fields = (body?.error?.details?.fields ?? []).map((f) => (typeof f === "string" ? f : f.field));
  return { success: false, error: body?.error?.message || body?.message || fallback, fields };
}

const NETWORK_ERROR = "We couldn’t reach Satya. Check your connection and try again — the server may take a few seconds to wake up.";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
    setSessionCookie(false);
    setUser(null);
    setToken(null);
  }, []);

  const establish = useCallback(
    (payload: SessionPayload, redirectTo = "/app") => {
      const next = toAuthUser(payload.user, payload.memberships, payload.activeGroup);
      queryClient.clear();
      localStorage.setItem(TOKEN_KEY, payload.token);
      localStorage.setItem(USER_KEY, JSON.stringify(next));
      setSessionCookie(true);
      setToken(payload.token);
      setUser(next);
      router.replace(redirectTo);
    },
    [router],
  );

  const post = useCallback(
    async (path: string, body: unknown, fallback: string, redirectTo?: string): Promise<AuthResult> => {
      try {
        const response = await fetch(`${SERVER_URL}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) return errorFrom(response, fallback);
        establish((await response.json()) as SessionPayload, redirectTo);
        return { success: true };
      } catch {
        return { success: false, error: NETWORK_ERROR };
      }
    },
    [establish],
  );

  const login = useCallback(
    (email: string, password: string, redirectTo?: string) =>
      post("/api/v2/auth/login", { email: email.trim(), password }, "Check the email and password and try again.", redirectTo),
    [post],
  );

  const signup = useCallback(
    (input: SignupInput, redirectTo = "/app/setup") =>
      post(
        "/api/v2/auth/signup",
        {
          name: input.name.trim(),
          email: input.email.trim(),
          password: input.password,
          groupName: input.companyName.trim(),
          entityLegalName: input.companyName.trim(),
          ...(input.entityCode ? { entityCode: input.entityCode } : {}),
        },
        "We couldn’t create your workspace. Check the details and try again.",
        redirectTo,
      ),
    [post],
  );

  const acceptInvite = useCallback(
    (inviteToken: string, input: { name?: string; password: string }, redirectTo = "/app") =>
      post("/api/v2/auth/accept-invite", { token: inviteToken, ...input }, "We couldn’t accept this invitation.", redirectTo),
    [post],
  );

  const logout = useCallback(() => {
    clear();
    queryClient.clear();
    router.replace("/login");
  }, [clear, router]);

  // Verify a stored token once on load.
  useEffect(() => {
    let live = true;
    const check = async () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(TOKEN_KEY);
      } catch {
        stored = null;
      }
      if (!stored) {
        setSessionCookie(false);
        setIsLoading(false);
        return;
      }
      // Returning visitor: show the workspace straight away from the cached
      // profile and verify the token in the background (401 signs out).
      const cachedAtStart = readCachedUser();
      if (cachedAtStart) {
        setToken(stored);
        setUser(cachedAtStart);
        setIsLoading(false);
      }
      try {
        const response = await fetch(`${SERVER_URL}/api/v2/me`, {
          headers: { Authorization: `Bearer ${stored}`, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!live) return;
        if (response.status === 401 || response.status === 403) {
          clear();
        } else if (response.ok) {
          const me = (await response.json()) as {
            user: { id: string; name: string; email: string; platformRole?: string };
            memberships: { groupId: string; entityId: string; roles: string[] }[];
            activeGroup: { id: string };
          };
          const next = toAuthUser(me.user, me.memberships, me.activeGroup?.id ?? null);
          localStorage.setItem(USER_KEY, JSON.stringify(next));
          setSessionCookie(true);
          setToken(stored);
          setUser(next);
        } else {
          // Server error: keep the cached session; pages show their own errors.
          const cached = readCachedUser();
          if (cached) {
            setToken(stored);
            setUser(cached);
          } else clear();
        }
      } catch {
        // Offline / cold start: keep the cached session rather than signing out.
        if (!live) return;
        const cached = readCachedUser();
        if (cached) {
          setToken(stored);
          setUser(cached);
        } else clear();
      } finally {
        if (live) setIsLoading(false);
      }
    };
    void check();
    return () => {
      live = false;
    };
  }, [clear]);

  const value = useMemo(
    () => ({ user, token, isLoading, login, signup, acceptInvite, logout }),
    [user, token, isLoading, login, signup, acceptInvite, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
