/**
 * @name virtualization jsdom layout shim (opt-in test support)
 *
 * Test-support helper (no artifact ID, like `tests/utils/renderWithProviders.tsx`). POO-624,
 * preflight for the POO-623 windowed-virtualization epic.
 *
 * jsdom has no layout engine: every element reports `clientHeight`/`scrollHeight`/`offsetHeight` and
 * the width equivalents as `0`, and there is no `ResizeObserver`. @tanstack/react-virtual reads those
 * to size its scroll window, so under a bare jsdom it renders zero windowed rows and windowed-list
 * tests can't assert anything. This helper fakes a tall/wide viewport for the duration of one test.
 *
 * OPT-IN BY DESIGN. It is deliberately NOT wired into tests/setup.ts: a test that wants a real
 * windowed layout imports and calls it explicitly; every other test keeps the honest layout-less
 * jsdom. It also never overrides `Element.prototype` globally. A global override would clobber the
 * per-instance `vi.spyOn(el, "getBoundingClientRect")` mocks that layout-sensitive component tests
 * rely on (e.g. `PerformanceChart.test.tsx`). Instead it installs restorable getters on
 * `HTMLElement.prototype`; an own-property instance spy still shadows (and wins over) the prototype
 * getter, and un-spying falls back to the shim cleanly. Every original is captured up front and
 * restored by the returned teardown, which is also registered via `onTestFinished` so nothing can
 * leak even if the caller forgets to tear down.
 *
 * @example
 *   import { beforeEach } from "vitest";
 *   import { setupVirtualizationLayout } from "../../tests/virtualizationLayout";
 *
 *   // Auto-restores when the test finishes; keep the handle only if you want to tear down early.
 *   beforeEach(() => { setupVirtualizationLayout(); });
 */
import { onTestFinished } from "vitest";

/** The fake scroll box the shim reports while active. Tall/wide enough to force a real window. */
const LAYOUT = {
  height: 10000,
  width: 1000,
} as const;

/** A no-op `ResizeObserver`: react-virtual constructs one but never needs real callbacks here. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type Descriptor = PropertyDescriptor | undefined;

/**
 * Install the fake layout on `HTMLElement.prototype` + a global `ResizeObserver`, returning a
 * teardown that restores every original. The teardown is also auto-registered via `onTestFinished`,
 * so calling `setupVirtualizationLayout()` in a `beforeEach` (or once in a test body) is leak-safe
 * even if the caller forgets to tear down. `onTestFinished` (not `afterEach`) is required: this runs
 * during the collected test, and Vitest ignores `afterEach`/`beforeEach` hooks registered after
 * collection, so an `afterEach` here would never fire and the fake layout would leak forward.
 */
export function setupVirtualizationLayout(): () => void {
  const proto = HTMLElement.prototype;

  // Capture originals so teardown is an exact restore (deleting a prop we added, or re-defining a
  // prop we overrode). getOwnPropertyDescriptor returns `undefined` for props jsdom doesn't define.
  const original: Record<string, Descriptor> = {
    clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
    scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
    offsetHeight: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
    clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    scrollWidth: Object.getOwnPropertyDescriptor(proto, "scrollWidth"),
    offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
  };
  const originalGetRect = Object.getOwnPropertyDescriptor(proto, "getBoundingClientRect");

  const defineDimension = (name: string, value: number): void => {
    Object.defineProperty(proto, name, { configurable: true, get: () => value });
  };
  defineDimension("clientHeight", LAYOUT.height);
  defineDimension("scrollHeight", LAYOUT.height);
  defineDimension("offsetHeight", LAYOUT.height);
  defineDimension("clientWidth", LAYOUT.width);
  defineDimension("scrollWidth", LAYOUT.width);
  defineDimension("offsetWidth", LAYOUT.width);

  // A tall rect on the PROTOTYPE only. A per-instance `vi.spyOn(el, "getBoundingClientRect")`
  // installs an own property that shadows this, so instance mocks keep working; restoring the spy
  // (mockRestore) deletes that own prop and falls back here rather than to a jsdom zero-rect.
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: function getBoundingClientRect(this: HTMLElement): DOMRect {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: LAYOUT.width,
        bottom: LAYOUT.height,
        width: LAYOUT.width,
        height: LAYOUT.height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });

  // ResizeObserver is absent in jsdom; only override (and later restore) the global if we set it.
  const scope = globalThis as { ResizeObserver?: typeof ResizeObserver };
  const originalResizeObserver = scope.ResizeObserver;
  scope.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;

  const restore = (): void => {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
    if (originalGetRect) Object.defineProperty(proto, "getBoundingClientRect", originalGetRect);
    else delete (proto as unknown as Record<string, unknown>).getBoundingClientRect;
    scope.ResizeObserver = originalResizeObserver;
  };

  // Belt-and-suspenders: auto-restore when the current test finishes, even if the caller never
  // invokes the returned teardown. `restore` is idempotent (re-defining the captured descriptor or
  // deleting an already-absent prop is a no-op), so an extra explicit teardown before this fires is
  // harmless.
  onTestFinished(restore);
  return restore;
}
