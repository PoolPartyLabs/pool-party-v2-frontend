import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { setConsentCookie, setSecureCookie } from "./cookies";

function setCookieHeader(response: NextResponse): string {
  return (response.headers.get("set-cookie") ?? "").toLowerCase();
}

describe("secure cookies", () => {
  it("sets HttpOnly, Secure and SameSite by default", () => {
    const response = new NextResponse(null);
    setSecureCookie(response, "pp_session", "abc");
    const header = setCookieHeader(response);
    expect(header).toContain("httponly");
    expect(header).toContain("secure");
    expect(header).toContain("samesite=lax");
  });

  // pp_consent must be readable by the client banner: Secure but NOT HttpOnly.
  it("consent cookie is Secure but not HttpOnly", () => {
    const response = new NextResponse(null);
    setConsentCookie(response, "granted");
    const header = setCookieHeader(response);
    expect(header).toContain("pp_consent=granted");
    expect(header).toContain("secure");
    expect(header).not.toContain("httponly");
  });
});
