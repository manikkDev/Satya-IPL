import { NextResponse, type NextRequest } from "next/server";

// Signed-out visitors to /app are sent to /login before any workspace UI is
// rendered (no flash). The `satya_session` cookie is only a hint set by the
// auth context next to the real JWT; the API still authorises every call.
// Mock mode (NEXT_PUBLIC_USE_MOCKS=1) runs without auth.
export function middleware(request: NextRequest) {
  const mocks = process.env.NEXT_PUBLIC_USE_MOCKS;
  if (mocks === "1" || mocks === "true" || mocks === "on") return NextResponse.next();
  if (request.cookies.get("satya_session")?.value) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/login";
  url.search = next && next !== "/app" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app", "/app/:path*"] };
