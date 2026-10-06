"use client";

import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { SOLANA_LP_CHOICES } from "./lpChoices";

/** DEC-198: unstyled selector options; Solana remains off by default. */
export function useSolanaLpChoices() {
  const { isEnabled } = useFeatureFlags();
  const enabled = isEnabled("solanaSpoke");
  return { enabled, choices: enabled ? SOLANA_LP_CHOICES : [] };
}
