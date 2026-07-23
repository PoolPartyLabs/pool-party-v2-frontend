/**
 * @id PP-CORE-CMP-022
 * @name CtaWithMissing
 * @implements-rules-version v1
 *
 * A primary CTA that, instead of going inert when its form is incomplete, stays tappable and reveals
 * which required fields are still missing. On a blocked tap (or keyboard activation) it shows an
 * inline list below the button — mobile-first — and on desktop the same list also appears as a
 * hover/focus tooltip. Wraps the shared {@link Button}'s blocked-mode; when `missing` is empty the
 * button behaves normally and runs `onClick`.
 */
"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { Button, type ButtonProps } from "./Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip";

/** Public props for {@link CtaWithMissing}. */
export interface CtaWithMissingProps extends Omit<ButtonProps, "blocked" | "onBlockedClick"> {
  /** Already-translated labels of the still-missing required fields. Empty → the CTA is ready. */
  missing: string[];
  /** Already-translated heading shown above the missing list. */
  missingTitle: string;
  /** Class for the wrapping column (the Button keeps its own `className`). */
  wrapperClassName?: string;
}

/** Bulleted list of the missing fields, shared by the inline reveal and the tooltip. */
function MissingList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{title}</span>
      <ul className="list-inside list-disc">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Primary CTA that surfaces the still-missing required fields instead of silently disabling. */
export function CtaWithMissing({
  missing,
  missingTitle,
  wrapperClassName,
  className,
  children,
  ...buttonProps
}: CtaWithMissingProps) {
  const [revealed, setRevealed] = useState(false);
  const hintId = useId();
  const blocked = missing.length > 0;

  // Collapse the reveal automatically once every required field is satisfied.
  useEffect(() => {
    if (!blocked) setRevealed(false);
  }, [blocked]);

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={className}
              blocked={blocked}
              aria-describedby={blocked && revealed ? hintId : undefined}
              onBlockedClick={() => setRevealed(true)}
              {...buttonProps}
            >
              {children}
            </Button>
          </TooltipTrigger>
          {blocked ? (
            <TooltipContent>
              <MissingList title={missingTitle} items={missing} />
            </TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>
      {blocked && revealed ? (
        <div
          id={hintId}
          role="status"
          aria-live="polite"
          className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-warning text-xs"
        >
          <MissingList title={missingTitle} items={missing} />
        </div>
      ) : null}
    </div>
  );
}

CtaWithMissing.displayName = "CtaWithMissing";
