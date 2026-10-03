/**
 * @id PP-MGR-CMP-047
 * @name BuildPanelSlot
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a presentational frame; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The right-hand column of the Build step (handoff v1.2 [AN9]): a 360 wide frame with the
 * "Configure block" overline, and a body that is whatever it is handed.
 *
 * It is a SLOT on purpose (panel heads-up HU1). This batch hands it the panel stub (slice S5:
 * "Nothing selected", or the head of the selected block and Remove block); the next batch hands it
 * the configuration fields. Keeping the frame here and the body outside means the configuration
 * batch replaces one child and never touches the canvas around it.
 *
 * The overline is a heading and names the region, so a screen-reader user can jump to the panel.
 * Its key holds natural case and the capitals come from CSS, so CJK locales are unaffected.
 *
 * The slot hugs its content: the grid column that holds it is top aligned (BuildStepLayout), so the
 * frame never stretches to the 640 of the canvas.
 */
"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

/** Public props for {@link BuildPanelSlot}. */
export interface BuildPanelSlotProps {
  /** The panel body: the stub in this batch, the configuration fields in the next. */
  children?: ReactNode;
}

/** The Configure block frame of the Build step. */
export function BuildPanelSlot({ children }: BuildPanelSlotProps) {
  const t = useTranslations("manager");
  const overlineId = useId();

  return (
    <section
      aria-labelledby={overlineId}
      data-build-panel-slot=""
      className="flex w-[360px] max-w-full flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <h3
        id={overlineId}
        className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
      >
        {t("fundBuilder.canvas.panel.overline")}
      </h3>
      {children}
    </section>
  );
}
