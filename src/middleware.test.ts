/**
 * @id PP-SECURITY (POO-81 / POO-352)
 * @name middleware security headers
 * Behavior: the composed middleware attaches the CSP (Report-Only) with a per-request nonce and the
 * Reporting-Endpoints header to the ACTUAL response (not just the builder's string). Guards against a
 * composition regression (e.g. next-intl dropping the header) that the csp.ts unit tests can't catch.
 * next-intl is stubbed to a passthrough so the test isolates the security-header wiring.
 */
import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => NextResponse.next(),
}));

import middleware from "./middleware";

function request(path = "/en"): NextRequest {
  return new NextRequest(new URL(`https://app.test${path}`));
}

function nonceOf(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([a-f0-9]+)'/)?.[1];
}

describe("middleware security headers", () => {
  it("sets CSP Report-Only (with a nonce) + Reporting-Endpoints on the response", () => {
    const res = middleware(request());
    const csp = res.headers.get("Content-Security-Policy-Report-Only");
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[a-f0-9]+'/);
    expect(csp).toContain("report-to csp-endpoint");
    expect(res.headers.get("Reporting-Endpoints")).toBe('csp-endpoint="/api/csp-report"');
    // The enforcing header must NOT be present yet (Report-Only rollout).
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("mints a fresh per-request nonce", () => {
    const a = nonceOf(middleware(request()).headers.get("Content-Security-Policy-Report-Only"));
    const b = nonceOf(middleware(request()).headers.get("Content-Security-Policy-Report-Only"));
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
