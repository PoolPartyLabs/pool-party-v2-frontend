/**
 * @id PP-STR-HOK-022
 * @name useStickyFooterShadow — tests
 * @implements-rules-version v1 (POO-1525 rules v1)
 *
 * POO-1525 [M3.5]: the pinned CTA footer's shadow is the ONE conditional piece of its styling (the
 * background and top border are always on, since the footer must stay opaque while it floats above
 * scrolled content). The shadow means "there is more below the fold", so it tracks the footer's own
 * scrolling ancestor, not the footer's own size.
 *
 * Bare jsdom lays nothing out (`scrollHeight`/`clientHeight`/`scrollTop` all read `0`), the same
 * constraint `useVirtualizeGate` documents for `clientHeight`. These tests build the DOM by hand and
 * stub the three metrics directly, the only way to drive this hook's math under jsdom.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStickyFooterShadow } from "./useStickyFooterShadow";

/** A scroll ancestor plus a footer node inside it, both detached at the end of every test. */
function buildTree(overflowY: string | null = "auto") {
  const scrollEl = document.createElement("div");
  if (overflowY) scrollEl.style.overflowY = overflowY;
  const footer = document.createElement("div");
  scrollEl.appendChild(footer);
  document.body.appendChild(scrollEl);
  return { scrollEl, footer };
}

/** jsdom reports 0 for all three; this is the only way to drive the math under test. */
function stubMetrics(
  el: HTMLElement,
  { scrollHeight, clientHeight, scrollTop }: Record<string, number>,
) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true, writable: true });
}

let cleanupNodes: HTMLElement[] = [];
afterEach(() => {
  for (const node of cleanupNodes) node.remove();
  cleanupNodes = [];
});

describe("useStickyFooterShadow", () => {
  it("stays false with no measurable scroll ancestor, the safe default (precedent: useVirtualizeGate)", () => {
    const { footer } = buildTree(null);
    cleanupNodes.push(footer);
    const ref = { current: footer };

    const { result } = renderHook(() => useStickyFooterShadow(ref));

    expect(result.current).toBe(false);
  });

  it("stays false when the container has nothing below the visible viewport", () => {
    const { scrollEl, footer } = buildTree();
    cleanupNodes.push(scrollEl);
    stubMetrics(scrollEl, { scrollHeight: 500, clientHeight: 500, scrollTop: 0 });
    const ref = { current: footer };

    const { result } = renderHook(() => useStickyFooterShadow(ref));

    expect(result.current).toBe(false);
  });

  it("turns true when content remains below the fold", () => {
    const { scrollEl, footer } = buildTree();
    cleanupNodes.push(scrollEl);
    stubMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
    const ref = { current: footer };

    const { result } = renderHook(() => useStickyFooterShadow(ref));

    expect(result.current).toBe(true);
  });

  it("turns false again once a scroll event reports the container reached its true end", () => {
    const { scrollEl, footer } = buildTree();
    cleanupNodes.push(scrollEl);
    stubMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
    const ref = { current: footer };

    const { result } = renderHook(() => useStickyFooterShadow(ref));
    expect(result.current).toBe(true);

    act(() => {
      Object.defineProperty(scrollEl, "scrollTop", { value: 500, configurable: true });
      scrollEl.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe(false);
  });

  it("walks past a non-scrolling ancestor to find the real scroll container", () => {
    const scrollEl = document.createElement("div");
    scrollEl.style.overflowY = "auto";
    const passthrough = document.createElement("div");
    // No overflow style at all: jsdom's computed `overflowY` for it is "visible", which must be
    // skipped rather than mistaken for the scroll container.
    const footer = document.createElement("div");
    scrollEl.appendChild(passthrough);
    passthrough.appendChild(footer);
    document.body.appendChild(scrollEl);
    cleanupNodes.push(scrollEl);
    stubMetrics(scrollEl, { scrollHeight: 900, clientHeight: 400, scrollTop: 0 });
    const ref = { current: footer };

    const { result } = renderHook(() => useStickyFooterShadow(ref));

    expect(result.current).toBe(true);
  });

  it("also accepts an overflow-y: scroll ancestor, not only auto", () => {
    const { scrollEl, footer } = buildTree("scroll");
    cleanupNodes.push(scrollEl);
    stubMetrics(scrollEl, { scrollHeight: 900, clientHeight: 400, scrollTop: 0 });
    const ref = { current: footer };

    const { result } = renderHook(() => useStickyFooterShadow(ref));

    expect(result.current).toBe(true);
  });

  it("detaches its scroll listener on unmount, so a later dispatch cannot update unmounted state", () => {
    const { scrollEl, footer } = buildTree();
    cleanupNodes.push(scrollEl);
    stubMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
    const ref = { current: footer };

    const { result, unmount } = renderHook(() => useStickyFooterShadow(ref));
    expect(result.current).toBe(true);
    unmount();

    // No React "state update on an unmounted component" warning is the assertion: dispatching after
    // unmount must be a no-op, not a leak.
    expect(() => {
      Object.defineProperty(scrollEl, "scrollTop", { value: 500, configurable: true });
      scrollEl.dispatchEvent(new Event("scroll"));
    }).not.toThrow();
  });
});
