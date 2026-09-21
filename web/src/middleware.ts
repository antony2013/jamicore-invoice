import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin/* and /staff/* routes (+ /login redirect below)
  const isAdminRoute = pathname.startsWith("/admin");
  const isStaffRoute = pathname.startsWith("/staff");
  const isLoginRoute = pathname === "/login";

  if (!isAdminRoute && !isStaffRoute && !isLoginRoute) {
    return NextResponse.next();
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  // The auth route (trustHost:true) names the session cookie from the
  // EXTERNAL protocol (https via x-forwarded-proto). Mirror that here —
  // otherwise the middleware looks for the plain cookie while the browser
  // holds __Secure-, every authed page bounces to /login forever.
  // (Inside the container traffic is plain http; only the header tells truth.)
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isSecure =
    forwardedProto === "https" || request.nextUrl.protocol === "https:";
  const token = await getToken({
    req: request,
    secret: secret || "dev-only-nextauth-secret-do-not-use-in-production-12",
    secureCookie: isSecure,
    cookieName: isSecure
      ? "__Secure-authjs.session-token"
      : "authjs.session-token",
  });

  // Not logged in -> Redirect to login page (but never redirect /login to itself)
  if (!token) {
    if (isLoginRoute) return NextResponse.next();
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  const userRole = token.role as string;

  // Already logged in and visiting /login -> send to role home
  if (isLoginRoute) {
    return NextResponse.redirect(
      new URL(userRole === "admin" ? "/admin/dashboard" : "/staff/dashboard", request.url)
    );
  }

  // Protect /admin routes: only 'admin' allowed (staff go to their home)
  if (isAdminRoute && userRole !== "admin") {
    return NextResponse.redirect(
      new URL(userRole === "staff" ? "/staff/dashboard" : "/login", request.url)
    );
  }

  // Protect /staff routes: only 'staff' allowed. Admin and staff surfaces
  // are fully separate — admins manage via /admin/*, never the staff portal.
  if (isStaffRoute && userRole !== "staff") {
    return NextResponse.redirect(
      new URL(userRole === "admin" ? "/admin/dashboard" : "/login", request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/staff/:path*", "/login"],
};
