/**
 * @id PP-MGR-CMP-045
 * @name BuildStepLayout
 * @implements-rules-version v1 (POO-2152 and POO-2202 rules v1)
 * @analytics-events none, the layout reports presses through its props; the Build screen
 *   (PP-MGR-SCR-002, S7) decides what a press meant and owns every event
 *
 * The frame of the fund builder's Build step (handoff v1.2 [AN2], [AN3], [AN4]): the heading and
 * subtitle, the three-column grid (palette 220, canvas flexible, panel 360, gap 24, at least 640 high) and the
 * sticky Back / Next bar. It owns no state: the palette, the canvas and the panel arrive as nodes.
 *
 * Decisions worth stating:
 *
 * 1. **The bar copies the Mandate bar's markup, not the component.** `BuilderActionBar` is built
 *    around the Mandate's step keys ("Next: Tokens"); the Build bar names phases ("Back: Mandate",
 *    "Next: Review") and carries a notice. Reusing the same `data-builder-action-bar` contract and
 *    classes keeps the two bars identical on screen and lets the shell find either one, without
 *    widening a component the Mandate steps depend on.
 * 2. **Next: Review is never disabled** (R6 of the Mandate handoff, design rule P36). A disabled
 *    button generates no click, no error and no event; the press always lands, and the screen
 *    answers it with the inline `notice` (S7 owns the checks and their copy).
 * 3. **The canvas column can shrink, the panel column hugs its content.** `minmax(0, 1fr)` plus
 *    `min-w-0` lets the canvas give way on a narrow content column instead of pushing the page
 *    sideways (A7). The canvas stays 640 high; the top-aligned panel reserves its full intrinsic
 *    height in the grid (POO-2202), including leave notices and errors, above the navigation bar.
 * 4. **The title is an H2 in the H3 style.** The shell already renders the page's H1, so the step
 *    is the next level in the outline; visually it is the app's Heading/H3, as the Mandate's step
 *    title is.
 */
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

/** Public props for {@link BuildStepLayout}. */
export interface BuildStepLayoutProps {
  /** Left column, 220 wide: the block palette (S5). */
  palette: ReactNode;
  /** Centre column, flexible: the canvas ({@link CanvasViewport} with the graph). */
  canvas: ReactNode;
  /** Right column, 360 wide: the panel ({@link BuildPanelSlot} with its body). */
  panel: ReactNode;
  /** Back: Mandate. */
  onBack: () => void;
  /** Next: Review. Never disabled; the screen answers a refused press with `notice`. */
  onNext: () => void;
  /** An inline notice shown in the bar before Next, or nothing. */
  notice?: ReactNode;
}

/** Heading, three-column grid and sticky bar of the Build step. */
export function BuildStepLayout({
  palette,
  canvas,
  panel,
  onBack,
  onNext,
  notice,
}: BuildStepLayoutProps) {
  const t = useTranslations("manager");

  return (
    <div data-build-step="" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground text-xl">{t("fundBuilder.canvas.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("fundBuilder.canvas.subtitle")}</p>
      </div>

      <div
        data-build-grid=""
        className="grid min-h-[640px] grid-cols-[220px_minmax(0,1fr)_360px] gap-6"
      >
        <div className="min-h-0">{palette}</div>
        <div className="h-[640px] min-h-0 min-w-0 self-start">{canvas}</div>
        <div className="self-start">{panel}</div>
      </div>

      {/* The Mandate bar's markup contract (BuilderActionBar), with phase labels and a notice. */}
      <div
        data-builder-action-bar=""
        className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-border border-t bg-background py-4"
      >
        <Button variant="ghost" size="md" onClick={onBack}>
          {t("fundBuilder.canvas.bar.back")}
        </Button>
        <div className="flex min-w-0 items-center gap-4">
          {notice ? (
            <div role="alert" data-build-notice="" className="min-w-0 text-destructive text-sm">
              {notice}
            </div>
          ) : null}
          <Button variant="primary" size="md" onClick={onNext}>
            {t("fundBuilder.canvas.bar.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
