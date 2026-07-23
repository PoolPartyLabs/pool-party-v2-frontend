/**
 * @name useVirtualizeGate — tests
 *
 * The single gate every virtualized surface reads (POO-625 [R1]). Windowing engages only when ALL
 * of: the `virtualize` flag is on, the list is past THRESHOLD, and a measurable scroll container
 * exists (`hasLayout`). Any leg false → fall back to the plain `.map()` (identical DOM to today).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  setOverride,
} from "@/lib/features/devOverrides";
import {
  DEFAULT_THRESHOLD,
  parseThreshold,
  THRESHOLD,
  useVirtualizeGate,
} from "./useVirtualizeGate";

/**
 * Fake a laid-out scroll box: the gate measures `clientHeight` off its ref. jsdom reports 0, so we
 * stub the getter to a positive value BEFORE the effect runs, then attach the ref by rendering.
 */
function withMeasuredHeight(px: number) {
  const spy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(px);
  return () => spy.mockRestore();
}

/** Render the gate against a real detached div the effect can measure. */
function renderGate(rowCount: number) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const utils = renderHook(({ count }: { count: number }) => useVirtualizeGate(count), {
    initialProps: { count: rowCount },
  });
  // Attach the ref the hook exposes to our measurable element, then flush the layout effect.
  act(() => {
    utils.result.current.containerRef(el);
  });
  utils.rerender({ count: rowCount });
  return { ...utils, el };
}

describe("useVirtualizeGate", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
    document.body.innerHTML = "";
  });

  it("exports THRESHOLD = 500 (the plain-map-below-this contract from ADR-0001 rule 4)", () => {
    expect(THRESHOLD).toBe(500);
  });

  it("[R1] stays off when the virtualize flag is off, even past threshold with layout", () => {
    const restore = withMeasuredHeight(800);
    const { result } = renderGate(THRESHOLD + 1);
    expect(result.current.enabled).toBe(false);
    restore();
  });

  it("[R1] stays off at or below THRESHOLD even with the flag on and layout present", () => {
    const restore = withMeasuredHeight(800);
    act(() => setOverride("virtualize", true));
    const atThreshold = renderGate(THRESHOLD);
    expect(atThreshold.result.current.enabled).toBe(false);
    restore();
  });

  it("[R1] stays off with the flag on and past threshold but NO layout (hasLayout false)", () => {
    // No height stub → jsdom reports clientHeight 0 → hasLayout stays false → plain-map fallback.
    act(() => setOverride("virtualize", true));
    const { result } = renderGate(THRESHOLD + 1);
    expect(result.current.enabled).toBe(false);
  });

  it("[R1] engages only when flag on AND count > THRESHOLD AND hasLayout all hold", () => {
    const restore = withMeasuredHeight(800);
    act(() => setOverride("virtualize", true));
    const { result } = renderGate(THRESHOLD + 1);
    expect(result.current.enabled).toBe(true);
    restore();
  });

  it("[R1] flips back off when the flag is cleared at runtime", () => {
    const restore = withMeasuredHeight(800);
    act(() => setOverride("virtualize", true));
    const { result } = renderGate(THRESHOLD + 1);
    expect(result.current.enabled).toBe(true);
    act(() => clearOverrides());
    expect(result.current.enabled).toBe(false);
    restore();
  });
});

describe("parseThreshold (POO-660 [R1])", () => {
  it("defaults to DEFAULT_THRESHOLD (500) when unset or empty", () => {
    expect(DEFAULT_THRESHOLD).toBe(500);
    expect(parseThreshold(undefined)).toBe(500);
    expect(parseThreshold("")).toBe(500);
    expect(parseThreshold("   ")).toBe(500);
  });

  it("accepts a non-negative integer override", () => {
    expect(parseThreshold("5")).toBe(5);
    expect(parseThreshold("0")).toBe(0);
    expect(parseThreshold("1000")).toBe(1000);
  });

  it("falls back to the default for negative, float, or non-numeric values", () => {
    expect(parseThreshold("-1")).toBe(500);
    expect(parseThreshold("5.5")).toBe(500);
    expect(parseThreshold("abc")).toBe(500);
    expect(parseThreshold("5px")).toBe(500);
  });

  it("keeps THRESHOLD at the default in the test environment (no override set) so hard-count assertions hold", () => {
    expect(THRESHOLD).toBe(DEFAULT_THRESHOLD);
  });
});
