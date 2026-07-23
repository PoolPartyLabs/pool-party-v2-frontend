/**
 * @name virtualization jsdom layout shim - self-test
 *
 * Guards the contract of {@link setupVirtualizationLayout}: while active it gives jsdom a fake
 * layout tall/wide enough for @tanstack/react-virtual to compute a window, and it auto-restores
 * every original when the current test finishes so it can never leak into unrelated tests, even
 * when the caller forgets the returned teardown. Critically it must NOT clobber per-instance
 * `getBoundingClientRect` spies (e.g. PerformanceChart.test.tsx): an own-property spy has to keep
 * winning over the shimmed prototype getter, and un-spying has to fall back cleanly.
 */
import { describe, expect, it, vi } from "vitest";
import { setupVirtualizationLayout } from "./virtualizationLayout";

describe("setupVirtualizationLayout", () => {
  it("gives jsdom a tall, wide layout and a ResizeObserver while active, then restores it all", () => {
    const beforeResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    const beforeClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    const beforeGetRect = HTMLElement.prototype.getBoundingClientRect;

    const teardown = setupVirtualizationLayout();

    // Active: a fresh element reports the shimmed box (jsdom otherwise returns 0 for all of these).
    const el = document.createElement("div");
    expect(el.clientHeight).toBe(10000);
    expect(el.scrollHeight).toBe(10000);
    expect(el.offsetHeight).toBe(10000);
    expect(el.clientWidth).toBe(1000);
    expect(el.scrollWidth).toBe(1000);
    expect(el.offsetWidth).toBe(1000);
    const rect = el.getBoundingClientRect();
    expect(rect.height).toBe(10000);
    expect(rect.width).toBe(1000);
    expect(typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe("function");

    teardown();

    // Restored: descriptors and the global are exactly what they were before setup ran.
    expect((globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe(beforeResizeObserver);
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")).toEqual(
      beforeClientHeight,
    );
    expect(HTMLElement.prototype.getBoundingClientRect).toBe(beforeGetRect);
    // After teardown jsdom is back to its layout-less self.
    expect(document.createElement("div").clientHeight).toBe(0);
  });

  it("does not clobber a per-instance getBoundingClientRect spy (PerformanceChart pattern)", () => {
    const teardown = setupVirtualizationLayout();
    const el = document.createElement("div");

    // An own-property spy on the instance must win over the shimmed prototype getter...
    const spy = vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 160,
      left: 0,
      top: 0,
      right: 300,
      bottom: 160,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(el.getBoundingClientRect().height).toBe(160);

    // ...and restoring the spy falls back to the shimmed prototype value, not a throw.
    spy.mockRestore();
    expect(el.getBoundingClientRect().height).toBe(10000);

    teardown();
  });

  it("is idempotent-safe: teardown restores even after a second element is created", () => {
    const teardown = setupVirtualizationLayout();
    document.createElement("div");
    expect(() => teardown()).not.toThrow();
    expect(document.createElement("div").clientHeight).toBe(0);
  });
});

// The forgotten-teardown contract: the header promises the shim is leak-safe even when the caller
// never invokes the returned teardown. These two tests run in file order - the first deliberately
// drops the teardown, the second asserts the auto-restore already put jsdom back to layout-less.
// This is the exact path the epic's windowed-list tests would hit; a leaked 10000px layout would
// otherwise make later layout-dependent assertions silently pass. It must fail if the auto-restore
// is registered via a hook (e.g. afterEach) that Vitest ignores when added during the run phase.
describe("forgotten-teardown auto-restore (leak safety)", () => {
  it("installs the fake layout and deliberately does NOT keep the teardown", () => {
    setupVirtualizationLayout();
    expect(document.createElement("div").clientHeight).toBe(10000);
    // no teardown() call, no returned handle retained: the shim must clean up after itself.
  });

  it("sees a clean, layout-less jsdom in the very next test", () => {
    expect(document.createElement("div").clientHeight).toBe(0);
    expect((globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBeUndefined();
  });
});
