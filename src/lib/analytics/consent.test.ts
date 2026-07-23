/**
 * @id PP-CORE (SETUP-014) — consent state — tests
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONSENT_COOKIE, readConsent, updateConsentMode, writeConsent } from "./consent";

afterEach(() => {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
  vi.unstubAllGlobals();
});

describe("readConsent", () => {
  it("returns 'unknown' when no choice is stored", () => {
    expect(readConsent()).toBe("unknown");
  });

  it("returns the stored choice", () => {
    document.cookie = `${CONSENT_COOKIE}=granted; Path=/`;
    expect(readConsent()).toBe("granted");
  });

  it("treats an unrecognized cookie value as 'unknown'", () => {
    document.cookie = `${CONSENT_COOKIE}=maybe; Path=/`;
    expect(readConsent()).toBe("unknown");
  });
});

describe("updateConsentMode", () => {
  it("forwards a granted choice to gtag", () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    updateConsentMode(true);
    expect(gtag).toHaveBeenCalledWith("consent", "update", {
      ad_storage: "granted",
      analytics_storage: "granted",
    });
  });

  it("forwards a denied choice to gtag", () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    updateConsentMode(false);
    expect(gtag).toHaveBeenCalledWith("consent", "update", {
      ad_storage: "denied",
      analytics_storage: "denied",
    });
  });

  it("is a no-op when gtag is absent", () => {
    expect(() => updateConsentMode(true)).not.toThrow();
  });

  // POO-164: a banner choice signals in-page listeners (AnalyticsIdentify re-syncs).
  it("dispatches pp:consent when a choice is written", () => {
    const heard: string[] = [];
    const listener = (event: Event) => heard.push(String((event as CustomEvent).detail));
    window.addEventListener("pp:consent", listener);
    writeConsent("granted");
    writeConsent("denied");
    window.removeEventListener("pp:consent", listener);
    expect(heard).toEqual(["granted", "denied"]);
  });
});
