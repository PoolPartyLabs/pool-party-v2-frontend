/**
 * @id PP-CORE-LIB-105 (POO-1800)
 * @name on-ramp rail + environment resolver
 * @implements-rules-version v1 (POO-1800 rules v1)
 * @analytics-events none, this module decides which rail serves fiat and against which vendor
 *   environment. It renders nothing, no user gesture reaches it, and the funnel events belong to the
 *   hosts that act on its answer.
 *
 * Two flags, one answer. `fiatOnRamp` says WHETHER fiat is offered at all; `privyOnRamp` says WHICH
 * rail serves it. Collapsing them here rather than at each host is the point of the module: the pair
 * has three states and only one of them is reachable by reading either flag alone.
 *
 *   | `fiatOnRamp` | `privyOnRamp` | result     |
 *   |--------------|---------------|------------|
 *   | off          | off           | `"none"`   |
 *   | off          | on            | `"none"`   |  [R1] the new flag never turns fiat on by itself
 *   | on           | off           | `"paybis"` |
 *   | on           | on            | `"privy"`  |
 *
 * ## Why the hosts disagree today, and what this fixes
 *
 * `DepositScreen.tsx` reads the flag env-pure and `ProvisioningPanel.tsx` reads it through the
 * dev-overridable hook, so a tester flipping it in the Dev menu moves one host and not the other.
 * {@link useOnRampProvider} is the client twin of this function and shares
 * {@link decideOnRampRail} with it, so the table cannot drift between the two readers: adding a
 * state means editing one function. The hosts adopt them in POO-1807/POO-1808; nothing here touches
 * a host.
 *
 * ## Mock mode is deliberately NOT in the table
 *
 * Whether the app talks to a real rail at all is the hosts' own `realRail` guard, and it is
 * unchanged. This module answers WHICH rail is configured, not whether the caller may reach it. The
 * two questions have different answers in local dev, where the rail is `paybis` and the guard still
 * refuses to call it.
 *
 * PP-NOTE: deliberately carries no integration-point marker. This module makes no call and never becomes
 * one; it resolves two flags to a rail NAME. The seams are at the hosts that act on the answer
 * (POO-1807/POO-1808), and marking a pure decision as a seam would inflate the registry that
 * `tests/hackathonDocs.test.ts` counts. No vendor SDK is imported here, and none should be: a module
 * that names a rail must stay loadable by both halves of the app.
 */

import { isFeatureEnabled } from "@/lib/features";

/** The on-ramp rail serving fiat, or `"none"` when fiat is not offered at all. */
export type OnRampRail = "paybis" | "privy" | "none";

/** Which vendor environment the rail is pointed at. Derived ([R3]), never configured directly. */
export type OnRampEnvironment = "production" | "sandbox";

/**
 * The decision table itself, as a pure function of the two flags, so the server resolver and the
 * client hook cannot answer differently. Exported for the twin and for tests, not for hosts: a host
 * that has both booleans in hand has already read the flags the wrong way.
 */
export function decideOnRampRail(fiatOnRamp: boolean, privyOnRamp: boolean): OnRampRail {
  // [R1] `fiatOnRamp` is the gate and it is checked FIRST. `privyOnRamp` is a routing choice with
  // nothing to route until fiat is offered, so it can never turn fiat on by itself.
  if (!fiatOnRamp) return "none";
  return privyOnRamp ? "privy" : "paybis";
}

/** The rail serving fiat right now, resolved through the flag registry (server-safe). */
export function resolveOnRampProvider(): OnRampRail {
  return decideOnRampRail(isFeatureEnabled("fiatOnRamp"), isFeatureEnabled("privyOnRamp"));
}

/**
 * [R3] The vendor environment, DERIVED from what the deploy already knows and never its own env var.
 *
 * `production` requires BOTH halves: an app env that says production, and mock mode explicitly off.
 * Everything else, including both unset, is `sandbox`, which is the fail-safe direction: the cost of
 * a wrong `sandbox` is a test purchase that does not settle, and the cost of a wrong `production` is
 * a real card charged from a build serving mock data.
 *
 * The app-env spelling is normalized exactly as the two existing readers of this variable do
 * (`isDevPanelEnabled` in `features/devOverrides.ts`, `isNonProdEnv` in `features/resolve.ts`):
 * trimmed, lower-cased, and matching `production` or `prod`. A third normalization would be a third
 * answer to "are we in production", which is how one surface ends up in sandbox while its neighbour
 * is live.
 *
 * The extra `prod` spelling is kept for that consistency alone, and it is unreachable on a real prod
 * build: `scripts/push_image.sh:101-104` refuses any production image whose `NEXT_PUBLIC_APP_ENV` is
 * not exactly `production`. Note the polarity though, because it is inverted here: in
 * `resolve.ts`/`devOverrides.ts` the WIDE match is the safe direction (more spellings counted as
 * production means fewer dev conveniences leak), while here a match is the PERMISSIVE direction, the
 * one that points the rail at the live vendor environment. Widening this set further is therefore a
 * decision about charging real cards, not a normalization detail.
 *
 * The mock-mode half reads the literal rather than importing `isMockMode` from `@/lib/services`.
 * That const has the same MEANING (`process.env.NEXT_PUBLIC_MOCK_MODE !== "false"`) but is evaluated
 * once at module load, so it cannot answer per call and cannot be moved by a test; importing it here
 * would also pull the entire services barrel, and its mock catalog, into every consumer of a
 * three-line flag module.
 */
export function resolveOnRampEnvironment(): OnRampEnvironment {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  const isProdEnv = appEnv === "production" || appEnv === "prod";
  const isRealMode = process.env.NEXT_PUBLIC_MOCK_MODE === "false";
  return isProdEnv && isRealMode ? "production" : "sandbox";
}
