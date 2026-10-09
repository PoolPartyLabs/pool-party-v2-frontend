/**
 * @id PP-MGR-CMP-059
 * @name useGraphLayout tests
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, a layout hook: nothing here is rendered or tracked.
 *
 * The join between the plan and the pure layout ([L6], [C1], [I9]): the start-here sentence of the
 * active locale is measured and its width feeds `layoutGraph`; the layout is memoised on the plan,
 * so panning and zooming (which re-render the canvas, never the plan) never lay the graph out again;
 * and a draft whose stored plan could not be read lays out the empty canvas (coordinator default
 * D18: the app works with the empty plan, never a guess).
 */
import { act, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enManager from "@/i18n/messages/en/manager.json";
import { canvasC, canvasD } from "@/mocks/data/buildCanvasFixtures";
import type { MandateDraft } from "../../mandateDraft";
import type { LayoutInput } from "../layout/graphTypes";
import { layoutGraph } from "../layout/layoutGraph";
import { toLayoutInput } from "../layout/toLayoutInput";
import { emptySpokePlan, hubPoolPlan, makeTestDraft } from "../plan/planTestKit";
import { START_HERE_FONT, useDraftGraphLayout, useGraphLayout } from "./useGraphLayout";

function Messages({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ manager: enManager }}>
      {children}
    </NextIntlClientProvider>
  );
}

/** A fake OffscreenCanvas whose 2D context measures `width()` px for any text. */
function installCanvas(width: () => number): void {
  const context = { font: "", measureText: () => ({ width: width() }) };
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return context;
      }
    },
  );
}

/** A fake `document.fonts`; the returned function announces a finished web font load. */
function installFontLoad(): () => void {
  const listeners = new Set<() => void>();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: new Promise(() => {}),
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    },
  });
  return () => {
    for (const listener of listeners) listener();
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
});

describe("useGraphLayout", () => {
  // @rule L6
  it("[L6] lays the empty canvas out with the sentence's width: canvas D is 468 x 572 in English", () => {
    const { result } = renderHook(() => useGraphLayout(canvasD.input), { wrapper: Messages });
    expect(result.current).toEqual(layoutGraph(canvasD.input, { startHereWidth: 420 }));
    expect([result.current.width, result.current.height]).toEqual([468, 572]);
  });

  // @rule L6
  it("[L6] feeds the measured width to the layout, which shifts the empty graph by it", () => {
    installCanvas(() => 480);
    const { result } = renderHook(() => useGraphLayout(canvasD.input), { wrapper: Messages });
    expect(result.current.emptyCaptions?.startHere).toMatchObject({ x: 24, w: 480 });
    expect(result.current.width).toBe(528);
  });

  it("measures the Caption/Default face: 12 px regular in the app's sans stack", () => {
    expect(START_HERE_FONT).toBe(
      "400 12px var(--font-poppins), ui-sans-serif, system-ui, sans-serif",
    );
  });

  // @rule I9
  it("[I9] lays out once per plan: a re-render with the same input returns the same layout", () => {
    const { result, rerender } = renderHook(({ input }) => useGraphLayout(input), {
      wrapper: Messages,
      initialProps: { input: canvasC.input },
    });
    const first = result.current;
    rerender({ input: canvasC.input });
    expect(result.current).toBe(first);
    const next: LayoutInput = { ...canvasC.input, spokes: [] };
    rerender({ input: next });
    expect(result.current).not.toBe(first);
  });

  it("never lays a non-empty plan out again because the sentence's measure changed", () => {
    let width = 400;
    installCanvas(() => width);
    const loaded = installFontLoad();
    const { result } = renderHook(() => useGraphLayout(canvasC.input), { wrapper: Messages });
    const first = result.current;
    width = 500;
    act(() => loaded());
    expect(result.current).toBe(first);
  });

  it("lays the empty canvas out again when a web font changes the sentence's measure", () => {
    let width = 400;
    installCanvas(() => width);
    const loaded = installFontLoad();
    const { result } = renderHook(() => useGraphLayout(canvasD.input), { wrapper: Messages });
    expect(result.current.emptyCaptions?.startHere.w).toBe(400);
    width = 440;
    act(() => loaded());
    expect(result.current.emptyCaptions?.startHere.w).toBe(440);
  });
});

describe("useDraftGraphLayout", () => {
  it("opts into Solana contexts from runtime and restores default geometry for the same plan", () => {
    const plan = emptySpokePlan();
    plan.spokes[0] = { network: "solana", sharePct: 0, chains: [] };
    const draft: MandateDraft = { ...makeTestDraft(), runtime: "solana-local", plan };
    const { result, rerender } = renderHook(({ draft }) => useDraftGraphLayout(draft), {
      wrapper: Messages,
      initialProps: { draft },
    });
    expect(result.current.spokeContexts?.[0]?.idle.id).toBe("spoke-idle:solana");
    rerender({ draft: { ...draft, runtime: undefined } });
    expect(result.current).toEqual(layoutGraph(toLayoutInput(plan), { startHereWidth: 0 }));
    expect(result.current.spokeContexts).toBeUndefined();
  });
  it("lays out the draft's plan", () => {
    const draft: MandateDraft = { ...makeTestDraft(), plan: hubPoolPlan() };
    const { result } = renderHook(() => useDraftGraphLayout(draft), { wrapper: Messages });
    expect(result.current).toEqual(
      layoutGraph(toLayoutInput(hubPoolPlan()), { startHereWidth: 420 }),
    );
  });

  // @rule D18
  it("[D18] lays out the empty canvas for a draft whose stored plan could not be read", () => {
    const draft: MandateDraft = { ...makeTestDraft(), planUnreadable: true };
    const { result } = renderHook(() => useDraftGraphLayout(draft), { wrapper: Messages });
    expect(result.current).toEqual(layoutGraph(canvasD.input, { startHereWidth: 420 }));
    expect(result.current.blocks).toEqual([]);
    expect(result.current.emptyCaptions).not.toBeNull();
  });

  // @rule I9
  it("[I9] keeps the layout while the draft changes elsewhere (a name edit is not a re-flow)", () => {
    const plan = hubPoolPlan();
    const { result, rerender } = renderHook(({ draft }) => useDraftGraphLayout(draft), {
      wrapper: Messages,
      initialProps: { draft: { ...makeTestDraft(), plan } as MandateDraft },
    });
    const first = result.current;
    rerender({ draft: { ...makeTestDraft(), name: "Renamed", plan } });
    expect(result.current).toBe(first);
  });
});
