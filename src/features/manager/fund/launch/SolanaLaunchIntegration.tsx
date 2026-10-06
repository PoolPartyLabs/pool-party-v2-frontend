"use client";

import type { ReactNode } from "react";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { isMockMode } from "@/lib/services";
import {
  type SolanaLaunchIntegrationOptions,
  useSolanaLaunchIntegration,
} from "./useSolanaLaunchIntegration";

export interface SolanaLaunchIntegrationProps {
  options: SolanaLaunchIntegrationOptions;
  children: (integration: ReturnType<typeof useSolanaLaunchIntegration>) => ReactNode;
}

function ConnectedIntegration({ options, children }: SolanaLaunchIntegrationProps) {
  return children(useSolanaLaunchIntegration(options));
}

/** DEC-188, DEC-190: no pages/styles; the UI owner renders this opt-in launch contract. */
export function SolanaLaunchIntegration(props: SolanaLaunchIntegrationProps) {
  const { isEnabled } = useFeatureFlags();
  if (!isEnabled("solanaSpoke") || isMockMode) return null;
  return <ConnectedIntegration {...props} />;
}
