/**
 * @id PP-CORE-LIB-011
 * @name feature flags — public API
 *
 * The single entry point the app reads flags through. Use {@link isFeatureEnabled} in server code
 * and {@link useFeatureFlags} (see "./useFeatureFlags") in client components; guard a flag-gated
 * route with {@link requireFeature} (see "./requireFeature"). Never read `process.env.NEXT_PUBLIC_FEATURE_*`
 * directly in a component — go through here so nav, routes, and links always agree.
 */
import { FEATURE_KEYS, type FeatureKey } from "./registry";
import { resolveFeature } from "./resolve";

export type { FeatureDefinition, FeatureKey, FeatureStage } from "./registry";
export { FEATURE_KEYS, FEATURES } from "./registry";
export { parseFlagValue, resolveFeature } from "./resolve";

/** Whether an area's flag is on in the current environment. */
export function isFeatureEnabled(key: FeatureKey): boolean {
  return resolveFeature(key);
}

/** The full resolved flag map ({@link FeatureKey} → on/off), in registry order. */
export function getFeatureFlags(): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, resolveFeature(key)])) as Record<
    FeatureKey,
    boolean
  >;
}
