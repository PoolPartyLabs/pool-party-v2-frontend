/**
 * @id PP-CORE-LIB-011
 * @name feature flags public API — tests
 * Behavior: isFeatureEnabled / getFeatureFlags reflect defaults + env overrides; requireFeature
 * triggers notFound() only when a flag is off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFeatureFlags, isFeatureEnabled } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isFeatureEnabled / getFeatureFlags", () => {
  it("reflects the v1 defaults", () => {
    expect(isFeatureEnabled("rewards")).toBe(true);
    expect(isFeatureEnabled("cards")).toBe(false);

    const all = getFeatureFlags();
    expect(all.home).toBe(true);
    expect(all.perps).toBe(false);
    // The map covers every registered flag.
    expect(Object.keys(all)).toContain("predictions");
  });

  it("honors an env override", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CARDS", "on");
    expect(isFeatureEnabled("cards")).toBe(true);
    expect(getFeatureFlags().cards).toBe(true);
  });
});

describe("requireFeature", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("next/navigation");
    vi.unstubAllEnvs();
  });

  async function loadGuard() {
    vi.resetModules();
    const notFound = vi.fn();
    vi.doMock("next/navigation", () => ({ notFound }));
    const { requireFeature } = await import("./requireFeature");
    return { requireFeature, notFound };
  }

  it("calls notFound() when the flag is off", async () => {
    const { requireFeature, notFound } = await loadGuard();
    requireFeature("cards"); // off by default
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("does not call notFound() when the flag is on", async () => {
    const { requireFeature, notFound } = await loadGuard();
    requireFeature("rewards"); // on by default
    expect(notFound).not.toHaveBeenCalled();
  });

  it("respects an env override when guarding", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CARDS", "on");
    const { requireFeature, notFound } = await loadGuard();
    requireFeature("cards");
    expect(notFound).not.toHaveBeenCalled();
  });
});
