"use client";

import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { SOLANA_LP_CHOICES } from "./lpChoices";
import { type SolanaOracleReference, solanaReferenceAvailability } from "./oracle";

/** DEC-198: unstyled selector options; Solana remains off by default. */
export function useSolanaLpChoices(
  references: Readonly<Record<string, SolanaOracleReference>> = {},
) {
  const { isEnabled } = useFeatureFlags();
  const enabled = isEnabled("solanaSpoke");
  return {
    enabled,
    choices: enabled
      ? SOLANA_LP_CHOICES.map((choice) => ({
          ...choice,
          availability: solanaReferenceAvailability(
            references[choice.poolId],
            choice.stockMarketHoursRequired,
          ),
        }))
      : [],
  };
}
