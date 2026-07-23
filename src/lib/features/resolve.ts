/**
 * @id PP-CORE-LIB-011
 * @name feature flag resolution
 *
 * Resolves a {@link FeatureKey} to an on/off boolean. Precedence (highest first):
 *   1. (future) dev/QA session override — added with the dev panel (POO-136)
 *   2. explicit per-flag env var `NEXT_PUBLIC_FEATURE_<KEY>`
 *   3. non-prod `NEXT_PUBLIC_FEATURE_ALL=on` (reveal the off areas for local/staging dogfooding)
 *   4. the registry `defaultEnabled`
 *   5. (future) backend / remote value — added with the service seam (POO-137)
 *
 * Env reads are written as STATIC `process.env.NEXT_PUBLIC_FEATURE_*` literals so Next.js inlines
 * them into the client bundle (a dynamic `process.env[name]` is `undefined` in the browser). They are
 * read at CALL time (inside the functions below) so tests can `vi.stubEnv(...)` without resetting the
 * module registry, mirroring the service factory's env handling.
 */
import { FEATURES, type FeatureKey } from "./registry";

/**
 * Parse an env string into a tri-state: `true` / `false` for recognized values, or `undefined` when
 * unset or unrecognized (so resolution falls through to the next precedence level).
 */
export function parseFlagValue(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  switch (value.trim().toLowerCase()) {
    case "on":
    case "true":
    case "1":
    case "yes":
    case "enabled":
      return true;
    case "off":
    case "false":
    case "0":
    case "no":
    case "disabled":
      return false;
    default:
      return undefined;
  }
}

/**
 * The per-flag env override, read via static `process.env.NEXT_PUBLIC_FEATURE_*` literals (one per
 * case) so Next can inline each into the client bundle. Returns the raw string (or `undefined`).
 */
function envOverride(key: FeatureKey): string | undefined {
  switch (key) {
    case "home":
      return process.env.NEXT_PUBLIC_FEATURE_HOME;
    case "portfolio":
      return process.env.NEXT_PUBLIC_FEATURE_PORTFOLIO;
    case "strategies":
      return process.env.NEXT_PUBLIC_FEATURE_STRATEGIES;
    case "deposit":
      return process.env.NEXT_PUBLIC_FEATURE_DEPOSIT;
    case "profile":
      return process.env.NEXT_PUBLIC_FEATURE_PROFILE;
    case "rewards":
      return process.env.NEXT_PUBLIC_FEATURE_REWARDS;
    case "cards":
      return process.env.NEXT_PUBLIC_FEATURE_CARDS;
    case "savings":
      return process.env.NEXT_PUBLIC_FEATURE_SAVINGS;
    case "buyTokens":
      return process.env.NEXT_PUBLIC_FEATURE_BUY_TOKENS;
    case "predictions":
      return process.env.NEXT_PUBLIC_FEATURE_PREDICTIONS;
    case "perps":
      return process.env.NEXT_PUBLIC_FEATURE_PERPS;
    case "adminConsole":
      return process.env.NEXT_PUBLIC_FEATURE_ADMIN_CONSOLE;
    case "provisioning":
      return process.env.NEXT_PUBLIC_FEATURE_PROVISIONING;
    case "virtualize":
      return process.env.NEXT_PUBLIC_FEATURE_VIRTUALIZE;
    case "strategyCategoryFilter":
      return process.env.NEXT_PUBLIC_FEATURE_STRATEGY_CATEGORY_FILTER;
    default:
      return undefined;
  }
}

/** Non-prod = any `NEXT_PUBLIC_APP_ENV` other than an explicit production label. Gates the _ALL switch. */
function isNonProdEnv(): boolean {
  const env = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  return env !== "production" && env !== "prod";
}

/** Resolve a single flag to a boolean using the documented precedence. */
export function resolveFeature(key: FeatureKey): boolean {
  // 2. explicit per-flag env var (most specific) wins.
  const explicit = parseFlagValue(envOverride(key));
  if (explicit !== undefined) return explicit;

  // 3. non-prod "reveal all" convenience switch fills the gaps.
  if (isNonProdEnv() && parseFlagValue(process.env.NEXT_PUBLIC_FEATURE_ALL) === true) {
    return true;
  }

  // 4. registry baseline (the v1 launch state).
  return FEATURES[key].defaultEnabled;
}
