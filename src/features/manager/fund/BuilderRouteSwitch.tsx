/**
 * @id PP-MGR-SCR-002
 * @name BuilderRouteSwitch
 * @implements-rules-version v1
 * @analytics-events none, the switch renders one of two builders and emits nothing. A view event
 *   here would fire on every render of either builder and belong to neither; the screens own their
 *   own views (S2 for the fund builder), and the choice itself is reported by the control the user
 *   pressed, `ContractFamilyToggle` (`PP-CORE-CMP-075`).
 *
 * POO-2120 [R6], epic POO-2119. Which builder `/manager/new` renders: the live V1 single-pool
 * builder (passed in as `v1`, already built by the page's server reads) or the fund-contracts one.
 *
 * The page stays a server component and keeps its reads. Only the CHOICE is client-side, because
 * both inputs are: the `fundContracts` flag through {@link useFeatureFlags}, and the chosen family
 * through {@link useContractFamily}'s persisted preference.
 *
 * ## Why the flag is tested before hydration
 *
 * Flag off is the FIRST branch and it returns `v1` with no skeleton and not one wrapping element.
 * That ordering is the rule, not an optimisation: in every environment where the preview does not
 * exist, the builder must render exactly as it does today, with no "loading" frame on the way in.
 * A manager in production has no stake in whether this browser has finished reading a preference
 * for a feature their build does not have.
 *
 * ## Why the unknown state is a skeleton
 *
 * With the flag on and the store not yet read, which builder to render is genuinely unknown. The
 * two alternatives are both wrong: rendering V1 flashes it away for every V2 manager, rendering V2
 * flashes it away for every V1 one, and a builder is heavy enough that the flash is a visible jump
 * rather than a blink. A builder-shaped skeleton holds the space for the one frame it takes.
 */
"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useContractFamily } from "@/lib/hooks/useContractFamily";
import { FundStrategyBuilderScreen } from "./FundStrategyBuilderScreen";

/** Public props for {@link BuilderRouteSwitch}. */
export interface BuilderRouteSwitchProps {
  /**
   * The V1 builder element, built by the page's server reads (mock mode renders the screen, real
   * mode the client data loader). Passed in rather than imported so this switch neither duplicates
   * that decision nor drags the V1 tree into its own module graph.
   */
  v1: ReactNode;
}

/** The shape the builder occupies while the chosen family is still unknown: a title bar + three rows. */
function BuilderSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Skeleton height={32} width="18rem" />
      <Skeleton height={96} radius="0.75rem" />
      <Skeleton height={96} radius="0.75rem" />
      <Skeleton height={96} radius="0.75rem" />
    </div>
  );
}

/**
 * Route the strategy builder to the V1 or the fund-contracts (V2) screen.
 *
 * Returns `ReactNode` rather than an element: the V1 branches return the caller's node UNWRAPPED,
 * not even in a Fragment, which is what makes "V1 is byte-identical with the flag off" a property
 * of the code rather than a claim (`BuilderRouteSwitch.test.tsx` compares the markup).
 */
export function BuilderRouteSwitch({ v1 }: BuilderRouteSwitchProps): ReactNode {
  const { isEnabled } = useFeatureFlags();
  const { family, hydrated } = useContractFamily();

  // [R6] Flag off: today's builder, immediately, with nothing added around it. Checked before
  // hydration on purpose, so an environment without the preview never renders a loading frame.
  if (!isEnabled("fundContracts")) return v1;

  // [R6] Flag on, family not read yet: hold the space rather than guess and flash.
  if (!hydrated) return <BuilderSkeleton />;

  return family === "v2" ? <FundStrategyBuilderScreen /> : v1;
}
