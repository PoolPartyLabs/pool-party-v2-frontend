/**
 * @id PP-CORE-HOK-034 (POO-1800)
 * @name useOnRampProvider
 * @implements-rules-version v1 (POO-1800 rules v1)
 * @analytics-events none, the hook returns a rail name and renders nothing; the funnel events
 *   belong to the hosts that act on its answer.
 *
 * The client twin of {@link resolveOnRampProvider}, and the reason both exist rather than one: a
 * server component cannot subscribe to the Dev-menu override store, and a client component that
 * reads the env directly ignores it. Today `DepositScreen.tsx` takes the env-pure read and
 * `ProvisioningPanel.tsx` the dev-overridable hook, so a tester flipping the flag in the Dev menu
 * moves one host and not the other. Once POO-1807/POO-1808 adopt this hook, both move together.
 *
 * The decision table is NOT restated here. It is {@link decideOnRampRail}, shared with the server
 * resolver, so the twin cannot drift from its original: this file's whole job is where the two
 * booleans come from.
 */
"use client";

import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { decideOnRampRail, type OnRampRail } from "./onRampProvider";

/** The rail serving fiat, reactive to Dev-menu overrides (client). */
export function useOnRampProvider(): OnRampRail {
  const { isEnabled } = useFeatureFlags();
  return decideOnRampRail(isEnabled("fiatOnRamp"), isEnabled("privyOnRamp"));
}
