/**
 * @id PP-MGR-CMP-046
 * @name canvasStorySupport
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, Storybook support only; nothing here ships in a route
 *
 * Shared by the stories of the Build step scaffold (BuildStepLayout, CanvasViewport,
 * BuildPanelSlot):
 *
 * - {@link withManagerMessages}: the global Storybook preview only loads the `common` namespace, so
 *   these stories supply `manager` through a scoped provider (as `AllocationCard.stories` does).
 * - {@link PlaceholderGraph}: a stand-in graph of a given size. The real pieces arrive with slices
 *   S4 (cards, pills, ports) and S6 (the renderer); until then the canvas is shown with neutral
 *   boxes that carry the same attributes the real pieces will: the boxes standing for cards are
 *   `data-canvas-interactive` (a press on them never pans), the group outline is background.
 *   The boxes carry no text, so there is no copy to translate.
 */
import type { Decorator } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/i18n/messages/en/common.json";
import enManager from "@/i18n/messages/en/manager.json";
import type { Size } from "./viewportMath";

/** Supplies the `manager` messages the scaffold reads. */
export const withManagerMessages: Decorator = (Story) => (
  <NextIntlClientProvider locale="en" messages={{ common: enCommon, manager: enManager }}>
    <Story />
  </NextIntlClientProvider>
);

/** Worked example 1 of the handoff (reference canvas C): fits at 87% in a 656 x 640 canvas. */
export const CANVAS_C_SIZE: Size = { width: 608, height: 674 };
/** Reference canvas A as a plan: fits at 30%, below the 25% floor of the controls' range. */
export const CANVAS_A_SIZE: Size = { width: 2080, height: 772 };
/** Reference canvas D (empty canvas, templates only): fits at 100%. */
export const CANVAS_D_SIZE: Size = { width: 468, height: 572 };

const CARD_W = 176;
const CARD_H = 62;
const SPINE_W = 236;

/** A neutral stand-in for a card. Interactive, like the real cards (S4). */
function Box({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <div
      data-canvas-interactive=""
      className="absolute rounded-xl border border-border bg-surface"
      style={{ left: x, top: y, width: w, height: h }}
    />
  );
}

/**
 * A stand-in graph: the graph bounds as a dashed outline (background), the spine centred on top,
 * and one row of cards across the whole width, so panning and zooming have something to show.
 */
export function PlaceholderGraph({ width, height }: Size) {
  const centre = width / 2;
  const columns = Math.max(1, Math.floor((width - 48 + 32) / (CARD_W + 32)));
  return (
    <div className="relative" style={{ width, height }}>
      <div className="absolute inset-0 rounded-lg border border-border border-dashed" />
      <Box x={centre - SPINE_W / 2} y={24} w={SPINE_W} h={CARD_H} />
      <Box x={centre - SPINE_W / 2} y={110} w={SPINE_W} h={CARD_H} />
      {Array.from({ length: columns }, (_, index) => (
        <Box
          // The boxes are positional stand-ins with no identity of their own.
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder row
          key={index}
          x={24 + index * (CARD_W + 32)}
          y={244}
          w={CARD_W}
          h={CARD_H}
        />
      ))}
      <Box x={centre - SPINE_W / 2} y={height - 24 - CARD_H} w={SPINE_W} h={CARD_H} />
    </div>
  );
}
