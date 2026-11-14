"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { LogoMark } from "@/components/brand/logo";

/** Client-side guard behind the middleware redirect: while the stored session
 *  is verified it shows a quiet splash (never workspace content), and sends
 *  signed-out visitors to /login with a return path. */
export default function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const denied = Boolean(user && allowedRoles && !allowedRoles.some((r) => r === user.role || user.roles.includes(r)));

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace(pathname && pathname !== "/app" ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
    else if (denied) router.replace("/app");
  }, [isLoading, user, denied, router, pathname]);

  if (isLoading || !user || denied) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--paper)]" aria-busy="true" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-[15px] text-[var(--muted)]">
          <LogoMark size={36} />
          <span>{isLoading ? "Opening your workspace…" : "Redirecting to sign in…"}</span>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
