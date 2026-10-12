/**
 * @id PP-MGR-CMP-040
 * @name BuilderActionBar
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @implements-rules-version v1 (POO-2332 rules v1: the cap_zero state of Next)
 * @analytics-events none, the bar reports a press through its props; the shell decides what the
 *   press meant and owns every mandate event (PP-MGR-SCR-002)
 *
 * The sticky Back / Next bar at the foot of the fund builder's content column (R5).
 *
 * Two decisions are worth stating, because both look like details and are not:
 *
 * 1. **The labels name the destination, not the direction.** "Next: Tokens" rather than "Next".
 *    The Mandate is five screens of list-picking that all look alike, and a bare "Next" gives the
 *    manager no way to tell how far along they are without reading the header again.
 * 2. **Next is never disabled** (R6, design rule P36). A disabled CTA generates no click, no error
 *    and no event, so a manager stuck on a step the product refuses leaves no trace at all. The
 *    press always lands; the shell answers it with an inline reason and a `builder_mandate_blocked`.
 *
 * 3. **A blocked Next looks off and still takes the press** (POO-2332 R12, R13). When an enabled 0%
 *    cap stops the step, Next is `aria-disabled` and muted, and it names the reason in its label. It
 *    is NOT natively disabled, so the press still lands and the shell blinks the control.
 *
 * The bar is sticky INSIDE the content column rather than fixed to the viewport, so the app footer
 * scrolls below it instead of being covered by it.
 */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import type { MandateStepKey } from "../mandateDraft";
import { useMandateStepTitles } from "./mandateStepTitles";

/** Public props for {@link BuilderActionBar}. */
export interface BuilderActionBarProps {
  /** The step Back returns to, or null on the first step, where there is no Back at all. */
  previous: MandateStepKey | null;
  /** The step Next advances to, or null on the last one, where Next leaves the Mandate. */
  next: MandateStepKey | null;
  /**
   * POO-2332 R12: why Next is off, or null when it is on. Only `cap_zero` exists today. The button
   * stays clickable: the press is how the manager is taken to the control that needs a value.
   */
  nextBlockedReason?: "cap_zero" | null;
  onBack: () => void;
  onNext: () => void;
}

/** Sticky Back / Next bar for the Mandate steps. */
export function BuilderActionBar({
  previous,
  next,
  nextBlockedReason = null,
  onBack,
  onNext,
}: BuilderActionBarProps) {
  const t = useTranslations("manager");
  const titles = useMandateStepTitles();

  return (
    <div
      data-builder-action-bar=""
      className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-border border-t bg-background py-4"
    >
      {previous ? (
        <Button variant="ghost" size="md" onClick={onBack}>
          {t("fundBuilder.subStep.back", { step: titles[previous] })}
        </Button>
      ) : (
        // An empty cell rather than a conditional layout: Next stays pinned right on every step.
        <span />
      )}
      <Button
        variant="primary"
        size="md"
        onClick={onNext}
        blocked={nextBlockedReason !== null}
        onBlockedClick={onNext}
        data-next-blocked={nextBlockedReason ?? undefined}
      >
        {nextBlockedReason === "cap_zero"
          ? t("fundBuilder.limits.capZeroReason")
          : next
            ? t("fundBuilder.subStep.next", { step: titles[next] })
            : t("fundBuilder.subStep.nextBuild")}
      </Button>
    </div>
  );
}
