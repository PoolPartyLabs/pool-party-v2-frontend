/**
 * @id PP-MGR-CMP-045
 * @name BuildStepLayout
 * @implements-rules-version v1 (POO-2287 and POO-2236 rules v1); v1 (POO-2152 and POO-2202 rules v1)
 * @analytics-events none, the layout reports presses through its props; the Build screen
 *   (PP-MGR-SCR-002, S7) decides what a press meant and owns every event
 *
 * The frame of the fund builder's Build step (handoff v1.2 [AN2], [AN3], [AN4]): the heading and
 * subtitle, the three-column grid (palette 220, canvas flexible, panel 360, gap 24, with height measured from the available screen) and the
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
 *    sideways (A7). Build measures the available canvas height above navigation (POO-2236). The palette and
 *    configuration panel scroll independently, keeping leave notices and errors reachable.
 * 4. **The title is an H2 in the H3 style.** The shell already renders the page's H1, so the step
 *    is the next level in the outline; visually it is the app's Heading/H3, as the Mandate's step
 *    title is.
 */
"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
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
  const gridRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>();
  useLayoutEffect(() => {
    const measure = () => {
      if (!gridRef.current || !barRef.current) return;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const top = gridRef.current.getBoundingClientRect().top + window.scrollY;
      const barHeight = barRef.current.getBoundingClientRect().height;
      const clearance = window.innerWidth < 1024 ? 80 : 24;
      // Exceptionally short screens retain a usable canvas and let the outer page scroll.
      setHeight(Math.max(240, viewportHeight - top - barHeight - 24 - clearance));
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (gridRef.current) observer?.observe(gridRef.current);
    if (barRef.current) observer?.observe(barRef.current);
    if (stepRef.current) observer?.observe(stepRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={stepRef} data-build-step="" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground text-xl">{t("fundBuilder.canvas.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("fundBuilder.canvas.subtitle")}</p>
      </div>

      <div
        ref={gridRef}
        data-build-grid=""
        style={{ height }}
        className="grid min-h-0 grid-cols-[180px_minmax(0,1fr)_360px] gap-4 xl:grid-cols-[220px_minmax(0,1fr)_360px] xl:gap-6"
      >
        <div className="scrollbar-dark min-h-0 min-w-0 overflow-y-auto">{palette}</div>
        <div className="h-full min-h-0 min-w-0">{canvas}</div>
        <div className="scrollbar-dark min-h-0 min-w-0 overflow-y-auto">{panel}</div>
      </div>

      {/* The Mandate bar's markup contract (BuilderActionBar), with phase labels and a notice. */}
      <div
        ref={barRef}
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
