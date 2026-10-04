/**
 * @id PP-CORE-CMP-075
 * @name ContractFamilyToggle
 * @implements-rules-version v1 (POO-2120 rules v1, POO-2157 rules v1); POO-2220 rules v1
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
 * Default placement is desktop (`hidden md:inline-flex`), preserving the manager builder.
 * The explicit mobile variant is mounted in a separate row on investor list and fund routes.
 *
 * ## A switch is a way out (POO-2157, review F2 of PR #41)
 *
 * On `/manager/new` choosing the other family unmounts the builder on screen, and with it any work
 * that was never saved: a Build canvas plan, a Mandate selection. So the choice goes through the
 * app's unsaved-changes guard ({@link useNavigationGuard}), like the sidebar links and every other
 * way out of the builder: with unsaved work registered it asks first and switches only on Leave;
 * with none it switches at once, as before. The event fires only when the switch happens.
 *
 * PP-NOTE: the guard asks about ANY unsaved form on the page. On a screen whose dirty form the
 * switch does not unmount (the manager profile, the personal info form) it asks too, and Leave
 * there loses nothing: a needless question in a rare case, against silent loss in the common one.
 */
"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useNavigationGuard } from "@/lib/hooks/unsavedChanges";
import { type ContractFamily, useContractFamily } from "@/lib/hooks/useContractFamily";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ContractFamilyToggle}. */
export interface ContractFamilyToggleProps {
  /** Extra classes merged onto the group. */
  className?: string;
  /** Explicit investor placement below md; the default remains the desktop control. */
  mobile?: boolean;
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
export function ContractFamilyToggle({ className, mobile = false }: ContractFamilyToggleProps) {
  const t = useTranslations("shell");
  const { isEnabled } = useFeatureFlags();
  const { family, setFamily } = useContractFamily();
  const { track } = useAnalytics();
  // Called before the flag check: a hook cannot sit behind an early return.
  const guard = useNavigationGuard();

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
    // A switch unmounts the builder on screen: with unsaved work it asks first (see the header).
    guard(() => {
      setFamily(next);
      // [R5] The family switched TO. No from/to pair: the previous family is the previous row.
      track("contract_family_toggled", { family: next });
    });
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
              "h-9 shrink-0 items-center gap-1 rounded-full border border-border px-1",
              mobile ? "inline-flex md:hidden" : "hidden md:inline-flex",
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
