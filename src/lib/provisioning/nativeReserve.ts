/**
 * @id PP-CORE-LIB-062 (POO-1131, POO-1155, POO-1801)
 * @name native reserve (env-configurable)
 * @implements-rules-version v4 (POO-1801 rules v1) · v3 (POO-1155 / POO-1129 rules v3) · v2 (POO-1131 / POO-1129 rules v2)
 * @analytics-events none, a build-time configuration knob emits nothing.
 *
 * How much NATIVE coin must stay in the wallet, read from NEXT_PUBLIC_* at build time.
 *
 * ## POO-1801 [R5]: renamed off a dead vendor, and moved to where its consumers live
 *
 * This was `src/lib/onramp/config.ts` exporting `PAYBIS_GAS_FLOOR_ETH`. Nothing about its BEHAVIOUR
 * changed: same `0.001` default, same `readUsdMinimum` parse, same two consumers, and the rule text
 * below is preserved word for word. What changed is that the name no longer says "Paybis", because
 * three of its four consumers are provisioning surfaces that have nothing to do with any on-ramp
 * vendor, and a constant named after a rail that is being replaced reads as deletable the day the
 * rail goes. It lives in `provisioning/` for the same reason.
 *
 * ## Why this lives here and NOT in `computeNeed.ts`
 *
 * `computeNeed.ts` already owns the Paybis economics that belong to the PLAN path (`PAYBIS_MIN_USD`,
 * `ONRAMP_CHAIN_ID`, `sizeOnRampUsd`, the gas ladders). This constant deliberately does not join them.
 * Per rules v2 [R1], `NATIVE_RESERVE_ETH` (formerly `PAYBIS_GAS_FLOOR_ETH`) is STANDALONE-ONLY: it governs WHEN a buy-crypto CTA that
 * is attached to no operation also buys gas, and nothing else. `computeNeed.ts` is the operation's
 * plan path, and that path is quote-driven by design; `gasFeasibility.ts`'s own [R4] states "GAS
 * COMES FROM THE QUOTE. Never a constant." Putting a constant gas floor anywhere reachable from an
 * operation's plan would re-introduce exactly the `gasEstimateUsd: 0.5` / `NETWORK_FEE_USD = 0.3`
 * fictions that rule deleted, which is why `serverBoundary.test.ts` pins `computeNeed.ts` pure. So the
 * standalone floor gets its own home, out of the plan path's reach.
 *
 * `NATIVE_RESERVE_ETH` MUST NOT be read by `classifyGasFeasibility`, `buildPlan`'s GAS path, or
 * anything that SIZES a gas top-up: gas there is quote-driven, and a constant gas COST would re-
 * introduce the `gasEstimateUsd: 0.5` fiction rules v2 [R1]/[R4] deleted.
 *
 * ## Two legitimate consumers, both distinct from a gas-cost constant
 *
 * 1. The standalone buy-crypto TRIGGER ([R1] / [R3]): whether a buy attached to no operation also buys
 *    gas. It compares this floor against the wallet's native balance on Base.
 * 2. POO-1155, the WALLET RESERVE FOR SIGNING: when the native coin is a funding SOURCE, this floor is
 *    the balance left untouched so the wallet can still sign — a spend cap on the funding swap, applied
 *    at SELECTION (`fundingSelection.ts`) and when marshalling picked sources to the engine
 *    (`planActions.ts` `reserveNativeFloor`). It never sizes a purchase, never reaches
 *    `classifyGasFeasibility`, and the FULL native balance stays visible to the gas classifier and the
 *    gas-bridge donor, so `buildPlan`'s gas path stays quote-driven and constant-free.
 *
 * Both are "how much native must stay in the wallet", not "how much gas costs", which is why they are
 * legitimate and [R1]/[R4] are not touched. This is SETTLED, not provisional: the prohibition this
 * module carries is on SIZING GAS, and a second consumer that only decides how much native is held
 * BACK does not weaken it. Do not read this floor to size any gas amount.
 *
 * PP-INTEGRATION-POINT: none — a build-time config knob, not a backend call. The real Paybis rail
 * that reads this floor lands with the on-ramp execution phase (POO-1135+).
 */

import { readUsdMinimum } from "@/lib/config/operationMinimums";

/**
 * [R5] The first env value that was actually CONFIGURED, treating blank as unset.
 *
 * The rename cannot be a flag day (Rafael's env rename is POO-1815), so both names have to work at
 * once and the NEW one has to win. Blank counts as unset because an unconfigured `NEXT_PUBLIC_*`
 * inlines as `undefined` or as `""` depending on how the image was built, and an empty string
 * reaching `readUsdMinimum` would take the default while SHADOWING a perfectly good value under the
 * deprecated name. `"0"` is NOT blank: it is the documented kill switch for both consumers and
 * passes straight through.
 *
 * Exported for its own test: the constant above is baked at import, so the precedence between the
 * two names has no other testable surface.
 */
export function firstConfigured(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

/**
 * Native ETH-on-Base floor below which a STANDALONE buy also buys gas ([R1] v2). A standalone buy has
 * no operation, so no legs, so nothing for `classifyGasFeasibility` to quote against; without this a
 * user who buys USDC holding no gas would have to run the on-ramp a second time to become transactable.
 *
 * Denominated in ETH (not USD): compared against the wallet's native balance on Base. `0.001` is the
 * production default; an environment may lower it via `NEXT_PUBLIC_ONRAMP_GAS_FLOOR_ETH` (or the deprecated
 * `NEXT_PUBLIC_PAYBIS_GAS_FLOOR_ETH`) to exercise
 * the standalone gas top-up with a smaller balance. `"0"` is the kill switch for BOTH consumers
 * (matching `readUsdMinimum`'s "0" handling used by the operation minimums): `native < 0` is never
 * true, so a standalone buy never adds a gas top-up, and no positive balance is ever `<= 0`, so the
 * wallet reserve holds nothing back and a selected native stays spendable in full.
 *
 * The parser is `readUsdMinimum` reused verbatim (POO-1131: do not hand-roll a second env parser). Its
 * name is USD-historical; the behaviour is generic non-negative-number parsing with a fallback, which
 * fits an ETH floor exactly. The env read is a LITERAL member access so Next.js inlines it at build
 * time, the same way the operation minimums are read.
 */
export const NATIVE_RESERVE_ETH = readUsdMinimum(
  firstConfigured(
    // Both reads are LITERAL member accesses so Next.js inlines each at build time; a computed
    // lookup would inline nothing and the constant would silently take its default in production.
    process.env.NEXT_PUBLIC_ONRAMP_GAS_FLOOR_ETH,
    // PP-TODO(POO-1815): drop this fallback once Rafael's env rename has landed in every
    // environment. Until then a deploy may still set only the old name, and dropping it early
    // would silently reset the floor to its default on exactly those deploys.
    process.env.NEXT_PUBLIC_PAYBIS_GAS_FLOOR_ETH,
  ),
  0.001,
);
