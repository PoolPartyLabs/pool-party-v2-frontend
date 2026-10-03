/**
 * @id PP-MGR-CMP-059
 * @name useGraphLayout
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, a layout hook: nothing here is rendered or tracked.
 *
 * The join between a plan and the pure layout, for the graph renderer ({@link BuildGraph}):
 *
 * - [L6] the empty canvas's "Start here" sentence is measured in the active locale with
 *   {@link useTextWidth}, in the Caption/Default face ({@link START_HERE_FONT}), and that width
 *   feeds `layoutGraph`, which shifts the empty graph by it (the layout rounds it up to an even
 *   integer itself);
 * - [C1], [I9] the layout is a pure function of the plan, so it is memoised on the plan (and on the
 *   width, only while the canvas is empty). Pan and zoom live in the viewport and never reach here:
 *   moving the view never lays the graph out again;
 * - D18: {@link useDraftGraphLayout} reads the draft's plan as `planOf` does, so a draft with no plan,
 *   or one the store marked `planUnreadable` (its stored plan could not be read and was left out),
 *   lays out the empty canvas. The renderer never guesses at a plan it cannot read.
 */
"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { MandateDraft } from "../../mandateDraft";
import type { GraphLayout, LayoutInput } from "../layout/graphTypes";
import { layoutGraph } from "../layout/layoutGraph";
import { toLayoutInput } from "../layout/toLayoutInput";
import { createEmptyPlan } from "../plan/buildPlan";
import { useTextWidth } from "./useTextWidth";

/**
 * Caption/Default: 12 px regular, in the same family stack as the `--font-sans` token
 * (`src/app/globals.css`). `--font-poppins` is the brand face `next/font` loads under a hashed name;
 * {@link useTextWidth} resolves it against the page before measuring.
 */
export const START_HERE_FONT = "400 12px var(--font-poppins), ui-sans-serif, system-ui, sans-serif";

function isEmpty(input: LayoutInput): boolean {
  return input.hub.chains.length === 0 && input.spokes.length === 0;
}

/** The graph of a layout input, with the start-here sentence measured in the active locale. */
export function useGraphLayout(input: LayoutInput): GraphLayout {
  const t = useTranslations("manager");
  const measured = useTextWidth(t("fundBuilder.canvas.empty.startHere"), START_HERE_FONT);
  // The width is read only by the empty canvas, so a plan with blocks never re-lays out for it.
  const startHereWidth = isEmpty(input) ? measured : 0;
  return useMemo(() => layoutGraph(input, { startHereWidth }), [input, startHereWidth]);
}

/** The graph of a draft's plan; no plan, or an unreadable one, is the empty canvas (D18). */
export function useDraftGraphLayout(draft: MandateDraft): GraphLayout {
  const plan = draft.plan;
  const input = useMemo(() => toLayoutInput(plan ?? createEmptyPlan()), [plan]);
  return useGraphLayout(input);
}
