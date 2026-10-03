/**
 * @id PP-CORE-CMP-075
 * @name ContractFamilyToggle
 * @implements-rules-version v1
 * @analytics-events contract_family_toggled
 *
 * POO-2120 [R3] / [R4] / [R5], epic POO-2119. The header's "V1 | V2" segmented control: which
 * family of contracts the manager console is addressing. V1 is the live Uniswap v3 single-pool
 * builder; V2 is the fund-contracts builder. It sits immediately left of the {@link RewardsPill},
 * so the two pills read as one cluster at the same 36 px height.
 *
 * Gated by the `fundContracts` feature flag, and off means ABSENT rather than disabled: a greyed-out
 * V2 segment would advertise a preview that does not exist in this environment. Read through
 * {@link useFeatureFlags}, the client hook the header already uses, so the Dev menu's QA override
 * reveals it live.
 *
 * The choice itself lives in {@link useContractFamily} (`PP-CORE-HOK-038`), persisted as a UI
 * preference. Before hydration that hook answers `"v1"` whatever is stored, which is what keeps the
 * first client render equal to the server HTML: this control therefore renders V1 selected until the
 * store has been read, and a V2 manager never watches V1 flash into V2.
 *
 * `aria-pressed` toggle buttons rather than a `radiogroup`, matching the repo's other segmented
 * controls (`TransactionSettingsDialog`, `GasAmountSelector`, `SwapScreen`): a radiogroup promises a
 * single tab stop with arrow-key movement, and these are native buttons with no roving tabindex, so
 * claiming the role would describe a keyboard contract the control does not honour.
 *
 * Desktop only (`hidden md:inline-flex`): the strategy builder it switches between is desktop only,
 * so offering the switch on a phone would lead to a screen that is not built for it.
 */
"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { type ContractFamily, useContractFamily } from "@/lib/hooks/useContractFamily";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ContractFamilyToggle}. */
export interface ContractFamilyToggleProps {
  /** Extra classes merged onto the group. */
  className?: string;
}

/** The two segments, in display order. V1 first: it is the default and the live builder. */
const SEGMENTS: readonly ContractFamily[] = ["v1", "v2"];

/** Class for one segment, by selected state. */
function segmentClass(selected: boolean): string {
  return cn(
    "inline-flex h-7 min-w-9 items-center justify-center rounded-full px-3",
    "font-semibold text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
  );
}

/** Header control choosing which contract family `/manager/new` builds against. */
export function ContractFamilyToggle({ className }: ContractFamilyToggleProps) {
  const t = useTranslations("shell");
  const { isEnabled } = useFeatureFlags();
  const { family, setFamily } = useContractFamily();
  const { track } = useAnalytics();

  // Off is absent: no segment, no tooltip, no group in the accessibility tree.
  if (!isEnabled("fundContracts")) return null;

  // Literal t() calls per segment (the i18n usage scan is static, no dynamic keys).
  const labels: Record<ContractFamily, string> = {
    v1: t("contractFamily.v1"),
    v2: t("contractFamily.v2"),
  };

  function choose(next: ContractFamily) {
    // Pressing the selected segment is not a decision: no state write and no event, so the series
    // counts builders entered rather than clicks on a control.
    if (next === family) return;
    setFamily(next);
    // [R5] The family switched TO. No from/to pair: the previous family is the previous row.
    track("contract_family_toggled", { family: next });
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* The whole group is the trigger, so hovering anywhere on the control explains it, and
              React's bubbling focus events open it for a keyboard user reaching either segment. */}
          {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of related toggle buttons (a segmented control) is the correct ARIA pattern; a <fieldset> carries form semantics this control does not have, and the repo's other segmented controls make the same call. */}
          <div
            role="group"
            aria-label={t("contractFamily.label")}
            className={cn(
              "hidden h-9 shrink-0 items-center gap-1 rounded-full border border-border px-1",
              "md:inline-flex",
              className,
            )}
          >
            {SEGMENTS.map((segment) => (
              <button
                key={segment}
                type="button"
                aria-pressed={family === segment}
                onClick={() => choose(segment)}
                className={segmentClass(family === segment)}
              >
                {labels[segment]}
              </button>
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {t("contractFamily.tooltip")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
