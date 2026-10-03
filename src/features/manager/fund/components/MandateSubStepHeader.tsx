/**
 * @id PP-MGR-CMP-028
 * @name MandateSubStepHeader
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, navigating to a reached step is reported by the shell as that step's
 *   view (PP-MGR-SCR-002); the header itself emits nothing
 *
 * The second row of the fund builder: where inside the Mandate the manager is, and how to get back
 * to a step they already passed (R3, R4).
 *
 * ## Why it is collapsed by default
 *
 * The Mandate is a phase inside a phase. The builder already carries the three-phase stepper
 * (Mandate, Build, Review), and a second always-open stepper under it reads as a competing one: the
 * manager has to work out which of the two tells them where they are. Collapsed, this is one line
 * that answers "which step, of how many, and what comes next"; expanded, it is the full map, which
 * is only wanted when someone is deciding where to jump back to.
 *
 * ## Hover opens it, a click PINS it
 *
 * Both gestures expand, and they differ in what closes it. Hover is a peek: the mouse leaving puts
 * it back. A click is a decision: the manager is going to read the map and probably click a step in
 * it, and a panel that collapsed out from under the pointer on the way there would be unusable.
 * `pinned` is therefore separate state from `hovered`, not a mode flag over one of them.
 *
 * Expansion pushes the content down rather than overlaying it (R3). An overlay would cover the top
 * of the step the manager is reading, which is exactly where the "Select all" and search controls
 * sit on four of the five steps.
 *
 * ## The bar is derived, never stored
 *
 * `steps`, `passed` and `reachable` all come from the draft through {@link visibleSteps},
 * {@link isStepReachable} and `passedSteps`. The header has no idea that Pools disappears when no
 * position protocol is chosen (R29); it draws the steps it is handed, which is why "STEP 4 OF 4"
 * needs no special case here.
 */
"use client";

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { MandateStepKey } from "../mandateDraft";
import { useMandateStepSubtitles, useMandateStepTitles } from "./mandateStepTitles";

/** Public props for {@link MandateSubStepHeader}. */
export interface MandateSubStepHeaderProps {
  /** The steps this draft actually has, in order (Pools is absent when it is skipped, R29). */
  steps: readonly MandateStepKey[];
  current: MandateStepKey;
  /** Steps already left through Next. They carry the Check icon. */
  passed: readonly MandateStepKey[];
  /** Steps that may be navigated to: passed, plus the first unpassed one (R4). */
  reachable: readonly MandateStepKey[];
  onNavigate: (step: MandateStepKey) => void;
}

/** Collapsible "where am I inside the Mandate" header with the mini progress bar. */
export function MandateSubStepHeader({
  steps,
  current,
  passed,
  reachable,
  onNavigate,
}: MandateSubStepHeaderProps) {
  const t = useTranslations("manager");
  const titles = useMandateStepTitles();
  const subtitles = useMandateStepSubtitles();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = hovered || pinned;

  const index = steps.indexOf(current);
  const next = index >= 0 ? steps[index + 1] : undefined;
  const overline = t("fundBuilder.subStep.overline", { n: index + 1, count: steps.length });

  return (
    // A `<nav>`, labelled by the overline, rather than a div: expanded, this row IS the navigation
    // between the Mandate's steps, and the landmark then tells a screen-reader user where in the
    // mandate it leads from. It also puts the hover handlers on an element with a role, which is
    // what the whole ROW owning the hover requires (R3). The pointer only PEEKS: everything it
    // reveals is reachable from the toggle button below, so no keyboard handler mirrors it.
    <nav
      data-mandate-substep=""
      aria-label={overline}
      className="flex flex-col gap-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start justify-between gap-6">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded ? t("fundBuilder.subStep.collapse") : t("fundBuilder.subStep.expand")
          }
          onClick={() => setPinned((open) => !open)}
          className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-muted-foreground text-xs uppercase tracking-wider">{overline}</span>
          <span className="font-semibold text-foreground text-xl">{titles[current]}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>

        <div className="flex items-start gap-4">
          <ol className="flex items-start gap-1">
            {steps.map((step, i) => {
              const filled = i <= index;
              const isCurrent = step === current;
              const canNavigate = !isCurrent && reachable.includes(step);
              const segment = (
                <span
                  data-mandate-segment={filled ? "filled" : "empty"}
                  className={cn(
                    "block h-1 rounded-full transition-all",
                    expanded ? "w-[76px]" : "w-8",
                    filled ? "bg-primary" : "bg-border",
                  )}
                />
              );
              const label = expanded ? (
                <span
                  // R4: an unreached step is text, and says so rather than looking pressable.
                  aria-disabled={reachable.includes(step) ? undefined : true}
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    isCurrent
                      ? "font-semibold text-foreground"
                      : canNavigate
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60",
                  )}
                >
                  {passed.includes(step) ? (
                    <Check className="size-3 text-success" aria-hidden="true" />
                  ) : null}
                  {titles[step]}
                </span>
              ) : null;

              return (
                <li key={step}>
                  {canNavigate && expanded ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(step)}
                      className="flex flex-col gap-1 rounded-sm text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {segment}
                      {label}
                    </button>
                  ) : (
                    <span className="flex flex-col gap-1">
                      {segment}
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* Collapsed, the right edge says what comes next. Expanded, the labels under the bar say
              it better, and keeping both would print the next step's title twice on one row. */}
          {expanded ? null : (
            <span className="whitespace-nowrap text-muted-foreground text-sm">
              {next
                ? t("fundBuilder.subStep.next", { step: titles[next] })
                : t("fundBuilder.subStep.nextBuild")}
            </span>
          )}
        </div>
      </div>

      {expanded ? <p className="text-muted-foreground text-sm">{subtitles[current]}</p> : null}
    </nav>
  );
}
