import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import {
  ADMIN_PATH_SEGMENT,
  adminHostGate,
  isAdminHost,
  isAdminPath,
  isLocalHost,
} from "./lib/admin/host";
import { buildContentSecurityPolicy } from "./lib/security/csp";

const handleI18nRouting = createMiddleware(routing);

// PP-SECURITY (POO-81): compose next-intl locale routing with the CSP. Shipped as Report-Only first;
// promote to enforce after reviewing reports.
//
// v2 nonce flow: App Router inline scripts (bootstrap + Flight stream) can't be hash-allowlisted
// per build, so we mint a per-request nonce. Next.js reads it from the request's
// `content-security-policy[-report-only]` header (server/app-render → getScriptNonceFromHeader) and
// stamps it onto its inline <script> tags. next-intl forwards the header because its next()/rewrite
// clone `new Headers(request.headers)`, so we set it on the request BEFORE routing, then echo the
// same policy on the response for the browser. `x-nonce` is exposed for any app code that needs it.
export default function middleware(request: NextRequest) {
  // PP-SECURITY (POO-144 R2): Admin Console host gate. The `adm.` host serves ONLY the `/admin`
  // surface, and every other host serves NONE of it. Local dev hosts are exempt so the console is
  // reachable at localhost/<locale>/admin. Defense-in-depth; the real authz is the layout guard.
  const host = request.headers.get("host");
  if (!isLocalHost(host)) {
    const { pathname } = request.nextUrl;
    if (isAdminHost(host)) {
      // Convenience: land the bare adm. host on the console instead of a 404.
      const segments = pathname.split("/").filter(Boolean);
      const firstSegment = segments[0];
      if (segments.length === 0) {
        return NextResponse.redirect(new URL(`/${ADMIN_PATH_SEGMENT}`, request.url));
      }
      if (
        segments.length === 1 &&
        firstSegment &&
        (routing.locales as readonly string[]).includes(firstSegment)
      ) {
        return NextResponse.redirect(
          new URL(`/${firstSegment}/${ADMIN_PATH_SEGMENT}`, request.url),
        );
      }
    }
    if (adminHostGate(host, pathname) === "block") {
      return new NextResponse("Not found", { status: 404 });
    }
  }

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildContentSecurityPolicy(nonce);

  // Forwarded to the render so Next.js can extract the nonce.
  request.headers.set("content-security-policy-report-only", csp);
  request.headers.set("x-nonce", nonce);

  const response = handleI18nRouting(request);
  response.headers.set("Content-Security-Policy-Report-Only", csp);
  // Defines the `csp-endpoint` group referenced by the CSP `report-to` directive (modern reporting).
  response.headers.set("Reporting-Endpoints", 'csp-endpoint="/api/csp-report"');
  // PP-SECURITY (POO-144): never cache authenticated admin responses (no shared/proxy/disk copies).
  if (isAdminPath(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }
  return response;
}

export const config = {
  // Run on all paths except API routes, Next internals, and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
