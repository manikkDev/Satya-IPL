import { NextResponse, type NextRequest } from "next/server";

// Legacy-route redirects (06 §1). Old screens stay reachable while v2 covers
// them on real data; ops flips NEXT_PUBLIC_APP_V2=1 when the backend pieces
// (B6–B8) are live, and these 308s start sending traffic to /app instead.
// Verify links and legal pages are never redirected.

const REDIRECTS: Record<string, string> = {
  "/dashboard": "/app",
  "/cases": "/app/investigations",
  "/chat": "/app/ask",
  "/inbox": "/app/documents",
  "/records": "/app/documents",
  "/purchase-orders": "/app/orders",
  "/audit": "/app/audit",
};

export function middleware(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_V2 !== "1") return NextResponse.next();
  const { pathname } = request.nextUrl;
  const target = REDIRECTS[pathname];
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/dashboard", "/cases/:path*", "/chat", "/inbox", "/records", "/purchase-orders", "/audit"],
};
