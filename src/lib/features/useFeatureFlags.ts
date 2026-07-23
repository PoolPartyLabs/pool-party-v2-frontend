/**
 * @id PP-CORE-HOK-011
 * @name useFeatureFlags
 *
 * Client hook for reading feature flags. Subscribes to the dev/QA override store (POO-129, see
 * "./devOverrides") via useSyncExternalStore, so toggling a flag in the Dev menu re-renders its
 * consumers (nav, entry links) live in non-prod. The SSR/hydration snapshot is env-only, so an
 * override never causes a hydration mismatch — it applies after mount.
 */
"use client";

import { useSyncExternalStore } from "react";
import { getClientFlags, getServerFlags, subscribeOverrides } from "./devOverrides";
import type { FeatureKey } from "./registry";

/** What {@link useFeatureFlags} returns. */
export interface FeatureFlagsApi {
  /** The full resolved flag map ({@link FeatureKey} → on/off). */
  flags: Record<FeatureKey, boolean>;
  /** Convenience reader: whether a single flag is on. */
  isEnabled: (key: FeatureKey) => boolean;
}

/** Read the resolved feature flags from a client component (reactive to dev/QA overrides). */
export function useFeatureFlags(): FeatureFlagsApi {
  const flags = useSyncExternalStore(subscribeOverrides, getClientFlags, getServerFlags);
  return { flags, isEnabled: (key: FeatureKey) => flags[key] };
}
