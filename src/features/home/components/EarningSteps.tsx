/**
 * @id PP-DASH-CMP-005
 * @name EarningSteps
 * @implements-rules-version v2
 *
 * The "Your path to earning" tracker card shown in the Home empty / first-run state
 * (PP-DASH-SCR-001). Three steps — Add funds, Pick a strategy, Earn — each rendered as `done`
 * (green check), `active` (gold marker, the next action) or `upcoming` (outline marker) [R8/R9].
 * Presentational: the consumer passes already-translated copy and the per-step state, mirroring the
 * BuilderStepper marker convention. The optional card heading is shown on desktop only (the mobile
 * design omits it), so the steps read as a self-explanatory list on small screens.
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Marker treatment for a single step. */
export type EarningStepState = "done" | "active" | "upcoming";

/** One step in the earning path. */
export interface EarningStep {
  /** 1-based position, shown in the marker unless the step is `done`. */
  number: number;
  /** Step state → marker treatment. */
  state: EarningStepState;
  /** Already-translated step title. */
  title: string;
  /** Already-translated supporting line (e.g. "Start with as little as $10" or "Done · $1,250 added"). */
  body: string;
}

/** Public props for {@link EarningSteps}. */
export interface EarningStepsProps {
  /** The steps to render, in order. */
  steps: EarningStep[];
  /** Optional already-translated card eyebrow. Rendered on desktop only (hidden on mobile per design). */
  heading?: string;
  /** Extra classes on the card. */
  className?: string;
}

/** The circular step marker: a check when done, otherwise the step number. */
function StepMarker({ state, number }: { state: EarningStepState; number: number }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs tabular-nums",
        state === "done" && "bg-success text-primary-foreground",
        state === "active" && "bg-primary text-primary-foreground",
        state === "upcoming" && "border border-border text-muted-foreground",
      )}
    >
      {state === "done" ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : number}
    </span>
  );
}

/** The "Your path to earning" three-step tracker card. */
export function EarningSteps({ steps, heading, className }: EarningStepsProps) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-5 sm:p-6", className)}>
      {heading ? (
        <p className="mb-4 hidden font-medium text-muted-foreground text-xs uppercase tracking-wide lg:block">
          {heading}
        </p>
      ) : null}
      <ol className="flex flex-col gap-4">
        {steps.map((step) => (
          <li key={step.number} className="flex items-start gap-3 text-left">
            <StepMarker state={step.state} number={step.number} />
            <div className="min-w-0">
              <p
                className={cn(
                  "font-medium text-sm",
                  step.state === "upcoming" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.title}
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
