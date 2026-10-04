/**
 * @id PP-MGR-CMP-062
 * @name PanelFieldLabel
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational label; the Build screen (PP-MGR-SCR-002) owns every
 *   event
 *
 * The label row of a configuration panel field (handoff "Panel shell", "Field label row"): the label
 * in Body/Medium, 6 px, then a 14 px (i) that opens the app Tooltip on hover and on keyboard focus
 * (side top, max-w-xs). Help text lives ONLY in the tooltip, never as a caption under the field (a
 * rule from the product owner). An optional value sits at the right end of the row (the
 * Allocation's "45%", in the Numeric style the caller gives it).
 *
 * The (i) is a real button, so a keyboard reaches its tooltip; it is named "More about <label>" and
 * described by the help text at all times (a hidden copy), not only while the tooltip is open.
 * Props only: every string arrives translated.
 */
"use client";

import { Info } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";
import { PANEL_FOCUS_RING } from "./panelStyles";

/** Public props for {@link PanelFieldLabel}. */
export interface PanelFieldLabelProps {
  /** The field's label: "Allocation", "Max slippage". */
  label: string;
  /** The help text of the (i) tooltip. */
  help: string;
  /** The (i) button's name: "More about Allocation". */
  helpLabel: string;
  /** The id the label carries, so the field can be `aria-labelledby` it. */
  labelId?: string;
  /** Points the label at a form control (a `<label htmlFor>`), when the field has one. */
  htmlFor?: string;
  /** At the right end of the row: the field's value. */
  value?: ReactNode;
  /** Help tooltip open state, for stories (an open (i)); uncontrolled otherwise. */
  helpOpen?: boolean;
}

/** The label, its (i) help and an optional value at the right end. */
export function PanelFieldLabel({
  label,
  help,
  helpLabel,
  labelId,
  htmlFor,
  value,
  helpOpen,
}: PanelFieldLabelProps) {
  const descriptionId = useId();
  const LabelTag = htmlFor ? "label" : "span";
  return (
    <div data-panel-field-label="" className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <LabelTag id={labelId} htmlFor={htmlFor} className="font-medium text-foreground text-sm">
          {label}
        </LabelTag>
        <TooltipProvider delayDuration={200}>
          <Tooltip open={helpOpen}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={helpLabel}
                aria-describedby={descriptionId}
                data-panel-help=""
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground",
                  PANEL_FOCUS_RING,
                )}
              >
                <Info aria-hidden="true" className="size-3.5" />
              </button>
            </TooltipTrigger>
            <span id={descriptionId} hidden>
              {help}
            </span>
            <TooltipContent side="top" className="max-w-xs">
              {help}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {value !== undefined ? <div className="shrink-0 text-foreground">{value}</div> : null}
    </div>
  );
}
