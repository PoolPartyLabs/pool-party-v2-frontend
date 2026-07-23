/**
 * @id PP-CORE-CMP-049
 * @name AprTooltip
 * @implements-rules-version v1
 *
 * Wraps a rate label (the unit next to a percentage, or a named label like "Avg APR") as a tooltip
 * trigger that reveals the localized expansion of the rate unit: "Annual Percentage Rate" for APR,
 * "Annual Percentage Yield" for APY. The unit comes from an explicit `unit` prop, or is inferred when
 * the trigger text is itself the bare unit token (e.g. `strategy.rateType`, which is "APR" or "APY");
 * any other label defaults to APR. The trigger is the label text itself (no icon). The app is
 * mobile-first and Radix tooltips do not open on a plain tap, so the open state is controlled: onClick
 * opens it on touch while Radix still handles hover, keyboard focus, and outside-tap / blur close
 * through onOpenChange. The text doubles as the trigger's aria-label, so assistive tech gets the
 * expansion without opening. (POO-485 R1)
 */
"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";

/** The rate unit a label expresses, selecting which expansion the tooltip reveals. */
export type RateUnit = "APR" | "APY";

/** Public props for {@link AprTooltip}. */
export interface AprTooltipProps {
  /** The visible rate text that becomes the trigger (e.g. `strategy.rateType`, "Avg APR"). */
  children: ReactNode;
  /**
   * The rate unit to explain. When omitted, it is inferred from `children` if that is the bare unit
   * token ("APR"/"APY"); any other label defaults to "APR".
   */
  unit?: RateUnit;
  /**
   * When set, an APR label reveals the "Average Annual Percentage Rate" expansion instead of the
   * plain "Annual Percentage Rate" — for avg-APR KPI tiles (Home / Portfolio / Manager). Only APR
   * has an averaged expansion today; it has no effect on APY labels. (POO-712 R3)
   */
  average?: boolean;
  /**
   * When set, an APR label reveals the "Net Annual Percentage Rate" expansion (the return after fees)
   * instead of the plain one, for the manager's Net APR metric. Only APR has a net expansion; it has
   * no effect on APY labels, and takes precedence over `average`. (POO-736 R2)
   */
  net?: boolean;
  /** Extra classes for the trigger so it matches the surrounding label's styling (color, case). */
  className?: string;
}

/** Resolves the rate unit from an explicit prop, else from a bare "APR"/"APY" trigger token. */
function resolveUnit(children: ReactNode, unit?: RateUnit): RateUnit {
  if (unit) return unit;
  if (typeof children === "string" && children.trim().toUpperCase() === "APY") return "APY";
  return "APR";
}

/** A rate label that reveals its "Annual Percentage Rate/Yield" expansion on hover, focus, or tap. */
export function AprTooltip({ children, unit, average, net, className }: AprTooltipProps) {
  const t = useTranslations("common");
  const resolvedUnit = resolveUnit(children, unit);
  // POO-736 R2: `net` wins over `average` for the Net APR metric; both only affect the APR expansion.
  const label =
    resolvedUnit === "APY"
      ? t("apyTooltip")
      : net
        ? t("netAprTooltip")
        : average
          ? t("avgAprTooltip")
          : t("aprTooltip");
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            // Tap support (mobile-first): Radix drives hover/focus + outside-close via onOpenChange;
            // onClick additionally opens it on a plain tap, which Radix tooltips otherwise ignore.
            onClick={() => setOpen(true)}
            className={cn(
              "cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
