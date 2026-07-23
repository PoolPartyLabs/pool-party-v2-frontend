import { describe, expect, it } from "vitest";
import { securityHeaders } from "./headers";

function value(key: string): string | undefined {
  return securityHeaders.find((header) => header.key === key)?.value;
}

describe("securityHeaders", () => {
  it("disables MIME sniffing and framing", () => {
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("X-Frame-Options")).toBe("DENY");
  });

  // R1: wallet popups must keep working.
  it("uses COOP same-origin-allow-popups, never same-origin", () => {
    expect(value("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
  });

  // R2: COEP require-corp would break wallet SDKs / TradingView.
  it("does not set Cross-Origin-Embedder-Policy", () => {
    expect(value("Cross-Origin-Embedder-Policy")).toBeUndefined();
  });

  it("sets HSTS without preload", () => {
    const hsts = value("Strict-Transport-Security");
    expect(hsts).toContain("max-age=");
    expect(hsts).not.toContain("preload");
  });

  it("locks down referrer and unused browser APIs", () => {
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value("Permissions-Policy")).toContain("geolocation=()");
  });
});
