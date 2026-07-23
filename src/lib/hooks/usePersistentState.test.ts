import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePersistentState } from "./usePersistentState";

const KEY = "pp.test.persistent";

afterEach(() => {
  window.localStorage.clear();
});

describe("usePersistentState", () => {
  it("returns the initial value when nothing is stored", () => {
    const { result } = renderHook(() => usePersistentState(KEY, 3));
    expect(result.current[0]).toBe(3);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("persists updates to localStorage and exposes the new value", () => {
    const { result } = renderHook(() => usePersistentState(KEY, 0));
    act(() => result.current[1](5));
    expect(result.current[0]).toBe(5);
    expect(window.localStorage.getItem(KEY)).toBe("5");
  });

  it("supports a functional updater", () => {
    const { result } = renderHook(() => usePersistentState(KEY, 1));
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(2);
  });

  it("hydrates from an existing stored value", () => {
    window.localStorage.setItem(KEY, JSON.stringify("stored"));
    const { result } = renderHook(() => usePersistentState(KEY, "initial"));
    expect(result.current[0]).toBe("stored");
  });

  it("falls back to the initial value when the stored JSON is malformed", () => {
    window.localStorage.setItem(KEY, "{ not json");
    const { result } = renderHook(() => usePersistentState(KEY, "fallback"));
    expect(result.current[0]).toBe("fallback");
  });
});
