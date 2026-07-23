/**
 * @id PP-MGR-CMP-011
 * @name BuilderStepper
 *
 * Three-step progress indicator for the V1 strategy builder: Mandate → Build (n8n canvas,
 * POO-278 [R4]) → Review.
 */
"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

/** Which builder step is active. */
export type BuilderStep = "mandate" | "build" | "review";

/** Mandate → Build → Review stepper. Completed steps are clickable to step back. */
export function BuilderStepper({
  active,
  onStepClick,
}: {
  active: BuilderStep;
  /** Called when a completed (earlier) step is clicked, to navigate back to it. */
  onStepClick?: (step: BuilderStep) => void;
}) {
  const t = useTranslations("manager");
  const steps: { key: BuilderStep; label: string }[] = [
    { key: "mandate", label: t("builder.steps.mandate") },
    { key: "build", label: t("builder.steps.build") },
    { key: "review", label: t("builder.steps.review") },
  ];
  const activeIndex = steps.findIndex((step) => step.key === active);
  return (
    <ol className="flex items-center gap-3">
      {steps.map((step, i) => {
        const done = i < activeIndex;
        const isActive = i === activeIndex;
        // Only already-completed steps are clickable — forward jumps stay gated behind each
        // step's own Next so its validation/derivation runs.
        const clickable = done && onStepClick !== undefined;
        const inner = (
          <>
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full font-medium text-xs",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-success text-primary-foreground"
                    : "bg-surface-raised text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span
              className={cn(
                "font-medium text-sm",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </>
        );
        return (
          <li key={step.key} className="flex items-center gap-3">
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick(step.key)}
                className="flex items-center gap-3 rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {inner}
              </button>
            ) : (
              <span className="flex items-center gap-3">{inner}</span>
            )}
            {i < steps.length - 1 ? (
              <span className="h-px w-8 bg-border" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
