/**
 * @id PP-MGR-CMP-059
 * @name useTextWidth tests
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, a measuring hook: nothing here is rendered or tracked.
 *
 * The width of one line of text in a font ([L6], [BB6]): the renderer measures the empty canvas's
 * start-here sentence with it, and the layout shifts the empty graph by that width in every locale.
 * jsdom has no canvas, so the tests stand a fake `OffscreenCanvas` in for the browser's and check
 * what the hook asks of it: the font (with its CSS variables resolved against the page), the text,
 * and when it measures again.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateTextWidth, resolveFontVariables, useTextWidth } from "./useTextWidth";

const SENTENCE = "Start here: add a protocol on Arbitrum (circle), or add a network (box).";
const FONT = "400 12px var(--font-poppins), ui-sans-serif, system-ui, sans-serif";

interface FakeContext {
  font: string;
  measureText: ReturnType<typeof vi.fn>;
}

/** Installs a fake OffscreenCanvas whose 2D context measures `perChar` px per character. */
function installCanvas(perChar: () => number): FakeContext {
  const context: FakeContext = {
    font: "10px sans-serif",
    measureText: vi.fn((text: string) => ({ width: text.length * perChar() })),
  };
  class FakeOffscreenCanvas {
    getContext(kind: string) {
      return kind === "2d" ? context : null;
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  return context;
}

/** Installs a fake `document.fonts` that can announce a finished font load. */
function installFonts(): { finishLoading: () => void } {
  const listeners = new Set<() => void>();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: new Promise(() => {}),
      addEventListener: (type: string, listener: () => void) => {
        if (type === "loadingdone") listeners.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === "loadingdone") listeners.delete(listener);
      },
    },
  });
  return {
    finishLoading: () => {
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.style.removeProperty("--font-poppins");
  Reflect.deleteProperty(document, "fonts");
});

describe("estimateTextWidth", () => {
  it("estimates 420 px for the English start-here sentence (72 characters), the drawn width", () => {
    expect(SENTENCE).toHaveLength(72);
    expect(estimateTextWidth(SENTENCE)).toBe(420);
  });

  it("grows with the text and is 0 for no text", () => {
    expect(estimateTextWidth("")).toBe(0);
    expect(estimateTextWidth("abcdef")).toBe(35);
  });
});

describe("resolveFontVariables", () => {
  it("replaces each CSS variable with its value on the page", () => {
    expect(
      resolveFontVariables(FONT, (name) => (name === "--font-poppins" ? "'Poppins x'" : "")),
    ).toBe("400 12px 'Poppins x', ui-sans-serif, system-ui, sans-serif");
  });

  it("drops a variable the page does not define, keeping the fallbacks", () => {
    expect(resolveFontVariables(FONT, () => "")).toBe(
      "400 12px ui-sans-serif, system-ui, sans-serif",
    );
  });
});

describe("useTextWidth", () => {
  // @rule L6
  it("[L6] returns the estimate where no canvas can measure (the server, jsdom)", () => {
    const { result } = renderHook(() => useTextWidth(SENTENCE, FONT));
    expect(result.current).toBe(420);
  });

  // @rule L6
  it("[L6] measures the text in the font, its variables resolved against the page", () => {
    document.body.style.setProperty("--font-poppins", "TestSans");
    const context = installCanvas(() => 6);
    const { result } = renderHook(() => useTextWidth(SENTENCE, FONT));
    expect(result.current).toBe(72 * 6);
    expect(context.font).toBe("400 12px TestSans, ui-sans-serif, system-ui, sans-serif");
    expect(context.measureText).toHaveBeenCalledWith(SENTENCE);
  });

  it("measures again when the text changes (another locale)", () => {
    installCanvas(() => 6);
    const { result, rerender } = renderHook(({ text }) => useTextWidth(text, FONT), {
      initialProps: { text: SENTENCE },
    });
    expect(result.current).toBe(432);
    rerender({ text: "Comece aqui." });
    expect(result.current).toBe(12 * 6);
  });

  it("measures again when a web font finishes loading", () => {
    let perChar = 5;
    installCanvas(() => perChar);
    const fonts = installFonts();
    const { result } = renderHook(() => useTextWidth(SENTENCE, FONT));
    expect(result.current).toBe(360);
    perChar = 6;
    act(() => fonts.finishLoading());
    expect(result.current).toBe(432);
  });

  it("keeps the estimate when the canvas answers no usable width", () => {
    installCanvas(() => Number.NaN);
    const { result } = renderHook(() => useTextWidth(SENTENCE, FONT));
    expect(result.current).toBe(420);
  });
});
