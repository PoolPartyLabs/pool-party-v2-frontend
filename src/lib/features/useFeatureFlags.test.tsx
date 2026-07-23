/**
 * @name useFeatureFlags — tests
 *
 * Behaviour: returns the env/registry resolution by default, and re-renders reactively when a
 * dev/QA override is set or cleared (the hook subscribes to the override store).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetDevOverridesForTests, clearOverrides, setOverride } from "./devOverrides";
import { useFeatureFlags } from "./useFeatureFlags";

describe("useFeatureFlags", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });

  it("reflects the env/registry defaults", () => {
    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current.isEnabled("home")).toBe(true);
    expect(result.current.isEnabled("cards")).toBe(false);
    expect(result.current.flags.rewards).toBe(true);
  });

  it("re-renders reactively when a dev override is set, then cleared", () => {
    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current.isEnabled("cards")).toBe(false);

    act(() => {
      setOverride("cards", true);
    });
    expect(result.current.isEnabled("cards")).toBe(true);

    act(() => {
      clearOverrides();
    });
    expect(result.current.isEnabled("cards")).toBe(false);
  });
});
