/**
 * @id PP-CORE-LIB-011
 * @name feature-flag dev/QA overrides
 *
 * A NON-PRODUCTION, client-only session override store for feature flags — the data layer behind the
 * Dev menu's "Feature flags" panel (POO-129, closes the POO-132 epic). It lets a tester flip an area
 * on/off live, without an env var or a rebuild.
 *
 * Overrides are layered on top of the env/registry resolution at the CLIENT consumption point
 * ({@link useFeatureFlags}) only. Server route guards ({@link requireFeature}) stay env-driven, so a
 * dev override changes nav + entry-link visibility live but NOT a route's 404 guard — use
 * `NEXT_PUBLIC_FEATURE_*` (or `NEXT_PUBLIC_FEATURE_ALL=on`) for direct route access in dev.
 *
 * Persisted to localStorage; reactive via {@link subscribeOverrides}. Fully inert in production and
 * during SSR (every mutator is a no-op, and the snapshot falls back to the env-only resolution).
 *
 * PP-INTEGRATION-POINT: delete together with {@link DevMenu} before launch.
 */
import { FEATURE_KEYS, type FeatureKey } from "./registry";
import { resolveFeature } from "./resolve";

/** localStorage key holding the JSON override map. */
const STORAGE_KEY = "pp:ff-overrides";

/** A partial map of flags the tester has explicitly forced on/off. */
export type FlagOverrides = Partial<Record<FeatureKey, boolean>>;

/**
 * Dev/QA flag overrides are allowed only outside production — same signal the registry's `_ALL`
 * switch uses (`NEXT_PUBLIC_APP_ENV`). Staging/preview/local = on; production = off.
 */
export function isDevPanelEnabled(): boolean {
  const env = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  return env !== "production" && env !== "prod";
}

let overrides: FlagOverrides | null = null;
let serverSnapshot: Record<FeatureKey, boolean> | null = null;
let clientSnapshot: Record<FeatureKey, boolean> | null = null;
const listeners = new Set<() => void>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Lazily hydrate the override map from localStorage (client + non-prod only); else empty. */
function getOverridesInternal(): FlagOverrides {
  if (overrides) return overrides;
  const next: FlagOverrides = {};
  if (isBrowser() && isDevPanelEnabled()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const key of FEATURE_KEYS) {
          if (typeof parsed[key] === "boolean") next[key] = parsed[key] as boolean;
        }
      }
    } catch {
      // Malformed/unavailable storage → start from no overrides.
    }
  }
  overrides = next;
  return overrides;
}

function persist(map: FlagOverrides): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage quota/disabled — overrides still apply for this session.
  }
}

/** Invalidate the cached client snapshot and notify subscribers (a new map reference is produced). */
function emit(): void {
  clientSnapshot = null;
  for (const listener of listeners) listener();
}

/** Subscribe to override changes; returns an unsubscribe fn. Wired into `useSyncExternalStore`. */
export function subscribeOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The env-only flag map, used as the SSR + hydration snapshot so overrides never cause a hydration
 * mismatch (they apply after mount). Stable reference for the lifetime of the module.
 */
export function getServerFlags(): Record<FeatureKey, boolean> {
  if (!serverSnapshot) {
    serverSnapshot = Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, resolveFeature(key)]),
    ) as Record<FeatureKey, boolean>;
  }
  return serverSnapshot;
}

/**
 * The flag map as the client sees it (env baseline with dev overrides layered on top). Returns a
 * cached reference that only changes when an override is set/cleared, satisfying
 * `useSyncExternalStore`'s stability requirement.
 */
export function getClientFlags(): Record<FeatureKey, boolean> {
  if (clientSnapshot) return clientSnapshot;
  const map = getOverridesInternal();
  clientSnapshot = Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, map[key] ?? resolveFeature(key)]),
  ) as Record<FeatureKey, boolean>;
  return clientSnapshot;
}

/** A read-only copy of the current overrides, for the Dev panel UI (which keys are forced). */
export function getOverrides(): FlagOverrides {
  return { ...getOverridesInternal() };
}

/** Force a flag on/off (`true`/`false`) or clear the override (`null`). No-op outside the dev panel. */
export function setOverride(key: FeatureKey, value: boolean | null): void {
  if (!isBrowser() || !isDevPanelEnabled()) return;
  const map = getOverridesInternal();
  if (value === null) delete map[key];
  else map[key] = value;
  persist(map);
  emit();
}

/** Clear every override at once. No-op outside the dev panel. */
export function clearOverrides(): void {
  if (!isBrowser() || !isDevPanelEnabled()) return;
  overrides = {};
  persist(overrides);
  emit();
}

/** Test-only: drop in-memory caches so a fresh `getOverridesInternal` re-reads storage/env. */
export function __resetDevOverridesForTests(): void {
  overrides = null;
  serverSnapshot = null;
  clientSnapshot = null;
  listeners.clear();
}
