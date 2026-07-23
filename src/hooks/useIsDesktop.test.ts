/**
 * @id PP-CORE-HOK-023
 * @name useIsDesktop tests
 * @implements-rules-version v1 (POO-847 rules v1)
 *
 * Reports whether the viewport is at/above the app's lg (1024px) split: the measured boolean after
 * mount, live on matchMedia changes, and null when matchMedia is unavailable (SSR-shaped).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsDesktop } from "./useIsDesktop";

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(initialMatches: boolean) {
  const listeners: Listener[] = [];
  const mq = {
    matches: initialMatches,
    addEventListener: (_: string, listener: Listener) => listeners.push(listener),
    removeEventListener: (_: string, listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mq));
  return {
    fire(matches: boolean) {
      mq.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
    listeners,
  };
}

describe("useIsDesktop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves to the measured boolean after mount (desktop)", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it("resolves to false below the breakpoint", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });

  it("tracks live matchMedia changes and unsubscribes on unmount", () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
    act(() => media.fire(true));
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners).toHaveLength(0);
  });

  it("stays null when matchMedia is unavailable (SSR-shaped environment)", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBeNull();
  });
});
