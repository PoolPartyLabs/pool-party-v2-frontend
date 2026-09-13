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

  // R2: COEP require-corp would break wallet SDKs, the Paybis widget and remote token logos.
  // POO-1451 removed TradingView from this justification; the app never loaded it.
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

/**
 * POO-1405. `payment=()` denied the Payment Request API to the whole document including our own
 * origin, so the embedded fiat checkout died inside the vendor's bundle with a `SecurityError` that
 * surfaced to users as a generic ONRAMP_ERROR. A document cannot delegate a feature it does not
 * itself hold, so `allow="payment"` on the iframe could never have rescued it.
 */
describe("[POO-1405] the payment delegation the embedded checkout needs", () => {
  const policy = () => securityHeaders.find((h) => h.key === "Permissions-Policy")?.value ?? "";

  it("grants payment to self and the widget origin, so the browser payment sheet can open", () => {
    expect(policy()).toContain(
      'payment=(self "https://widget.paybis.com" "https://widget.sandbox.paybis.com")',
    );
  });

  it("is NOT an empty allowlist, which is the exact regression that caused the outage", () => {
    expect(policy()).not.toContain("payment=()");
  });

  it("delegates to exactly one origin, never a wildcard", () => {
    expect(policy()).not.toContain("payment=*");
    expect(policy().match(/payment=\([^)]*\)/)?.[0]).not.toContain("*");
  });
});

/**
 * POO-1496. The same line denied `camera` and `microphone`, which the vendor needs for identity
 * verification INSIDE the embedded checkout: their KYC provider is Sumsub and the flow is document
 * capture plus a selfie. An empty allowlist denies the feature to the whole document and therefore to
 * every child frame, so the delegation could never resolve.
 *
 * The iframe half needs nothing from us. POO-1496 read the live vendor bundle and the SDK sets
 * `allow="clipboard-read; clipboard-write *; payment *; camera *; microphone *"` on the element it
 * builds, while still detached and before the load. The document half is the only one we own.
 *
 * The deny-guard below is NARROWED, not deleted. `geolocation` and `usb` are still denied and still
 * deserve the guard that stops a typo re-enabling them; `camera` and `microphone` leave it because
 * they are now granted deliberately.
 *
 * Compliance posture, recorded rather than implied: `CR-CORE-011` asks whether we should delegate
 * biometric capture through a frame we embed at all, and it is still OPEN with Legal as owner. This
 * ships ahead of that answer on Rafael's explicit authorization (2026-08-10), logged in
 * `docs/COMPLIANCE_REGISTER.md` as `ACCEPTED RISK`, which is what the register calls shipping with
 * the reasoning on the record. It is not a Legal clearance and must not be read as one.
 */
describe("[POO-1496] the camera and microphone delegation in-frame KYC needs", () => {
  const policy = () => securityHeaders.find((h) => h.key === "Permissions-Policy")?.value ?? "";

  it("grants camera to self and both widget origins, so Sumsub can capture in-frame", () => {
    expect(policy()).toContain(
      'camera=(self "https://widget.paybis.com" "https://widget.sandbox.paybis.com")',
    );
  });

  it("grants microphone on the same terms, because the vendor's recipe requires both", () => {
    expect(policy()).toContain(
      'microphone=(self "https://widget.paybis.com" "https://widget.sandbox.paybis.com")',
    );
  });

  it("is NOT an empty allowlist for either, which is the defect POO-1496 found", () => {
    expect(policy()).not.toContain("camera=()");
    expect(policy()).not.toContain("microphone=()");
  });

  it("never grants either as a wildcard, however the vendor writes its own allow string", () => {
    for (const feature of ["camera", "microphone"]) {
      expect(policy()).not.toContain(`${feature}=*`);
      expect(policy().match(new RegExp(`${feature}=\\([^)]*\\)`))?.[0]).not.toContain("*");
    }
  });

  it("keeps geolocation and usb denied: this delegates two capabilities, not a posture", () => {
    for (const denied of ["geolocation=()", "usb=()"]) {
      expect(policy()).toContain(denied);
    }
  });
});

/**
 * POO-1405 security review. The dangerous failure is not a bad ITEM (the spec skips those, giving a
 * narrower policy) but bad DICTIONARY syntax anywhere in the value: the browser discards the whole
 * header and every feature reverts to its DEFAULT allowlist, which is `self` for all five. A stray
 * quote three features earlier would silently re-enable geolocation and usb for our own origin while
 * every substring assertion above still passed.
 *
 * POO-1496 makes this guard MORE load-bearing, not less. Camera and microphone are now granted on
 * purpose, so they no longer sit behind the deny-guard, and a discarded header would hand our own
 * origin `self` on geolocation and usb with nothing above catching it.
 */
describe("[POO-1405] the Permissions-Policy value must be structurally valid", () => {
  it("parses as an RFC 8941 dictionary, so a typo cannot re-enable geolocation and usb", () => {
    const value = securityHeaders.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    const feature = /^[a-z-]+=(\(\)|\((self)?( ?"https:\/\/[a-z0-9.-]+")*\))$/;
    const parts = value.split(", ");
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(part).toMatch(feature);
  });

  it("covers BOTH widget origins, or the fix is unverifiable outside production", () => {
    const value = securityHeaders.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    expect(value).toContain('"https://widget.paybis.com"');
    expect(value).toContain('"https://widget.sandbox.paybis.com"');
  });
});
