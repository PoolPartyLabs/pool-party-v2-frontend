/**
 * @name feature-flag dev/QA overrides — tests
 *
 * Behaviour: the client override store layers on top of env/registry resolution, persists to
 * localStorage, is reactive, exposes a stable client snapshot for useSyncExternalStore, and is
 * fully inert in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  getClientFlags,
  getOverrides,
  getServerFlags,
  isDevPanelEnabled,
  setOverride,
  subscribeOverrides,
} from "./devOverrides";

describe("feature-flag dev overrides", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    __resetDevOverridesForTests();
  });

  it("defaults to the env/registry resolution (no overrides)", () => {
    expect(getClientFlags().home).toBe(true);
    expect(getClientFlags().cards).toBe(false);
    expect(getOverrides()).toEqual({});
  });

  it("forces a flag on and reflects it in the client snapshot + overrides", () => {
    setOverride("cards", true);
    expect(getClientFlags().cards).toBe(true);
    expect(getOverrides().cards).toBe(true);
  });

  it("keeps the server snapshot env-only (overrides never affect SSR/hydration)", () => {
    setOverride("cards", true);
    expect(getServerFlags().cards).toBe(false);
    expect(getClientFlags().cards).toBe(true);
  });

  it("clears a single override with null and all with clearOverrides", () => {
    setOverride("cards", true);
    setOverride("savings", true);
    setOverride("cards", null);
    expect(getOverrides()).toEqual({ savings: true });
    expect(getClientFlags().cards).toBe(false);

    clearOverrides();
    expect(getOverrides()).toEqual({});
    expect(getClientFlags().savings).toBe(false);
  });

  it("persists to localStorage and rehydrates after a reset", () => {
    setOverride("cards", true);
    expect(localStorage.getItem("pp:ff-overrides")).toContain("cards");

    __resetDevOverridesForTests();
    expect(getOverrides().cards).toBe(true);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOverrides(listener);

    setOverride("cards", true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setOverride("savings", true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns a stable client-snapshot reference until an override changes", () => {
    const first = getClientFlags();
    expect(getClientFlags()).toBe(first);

    setOverride("cards", true);
    expect(getClientFlags()).not.toBe(first);
  });

  it("is inert in production (panel disabled, mutators no-op)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    __resetDevOverridesForTests();

    expect(isDevPanelEnabled()).toBe(false);
    setOverride("cards", true);
    expect(getOverrides().cards).toBeUndefined();
    expect(getClientFlags().cards).toBe(false);
  });
});
