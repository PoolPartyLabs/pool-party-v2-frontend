/**
 * @id PP-CORE-LIB-064 (POO-1133, POO-1573)
 * @name sizeOnRampOrder
 * @implements-rules-version v3 (POO-1573 rules v2) · v2 (POO-1129 rules v2)
 * @epic POO-1129 (fiat on-ramp), phase 2
 *
 * Pure sizing decision for a fiat on-ramp order: pick the crypto to buy (ETH-BASE vs USDC-BASE) and
 * the fiat amount to pre-fill, in BOTH shapes epic POO-1129 ships:
 *   in-flow    a buy leg inside a provisioning plan (an operation exists),
 *   standalone a "buy crypto" CTA attached to no operation ([R3]).
 *
 * No I/O, no React, no viem, no clock ([R1] "GAS COMES FROM THE QUOTE" is honoured by the CALLER, which
 * runs `classifyGasFeasibility` and passes its verdict in): every figure is injected, so the whole
 * matrix is exhaustively unit-testable offline. Paybis sells only ETH-BASE / USDC-BASE (v1's
 * `getCurrencyCode`), so the currency is always one of those two and the buy always lands on Base.
 *
 * ## Why the gas trigger is split by context ([R1] v2)
 *
 * The two contexts cannot share one trigger, because in exactly one of them the gas classifier can run:
 *   - IN-FLOW an operation exists, so its legs are quoted, so `classifyGasFeasibility` gives a
 *     quote-driven Base verdict. That verdict (resolved with `GasFundingSource`, "card" => the on-ramp
 *     buys the gas) is the trigger, passed in as {@link SizeOnRampOrderInput.gasFundedByOnRamp}.
 *     `PAYBIS_GAS_FLOOR_ETH` must NOT participate here: a constant floor on the plan path is exactly the
 *     fiction `gasFeasibility.ts` [R4] deleted.
 *   - STANDALONE there is no operation, so no legs, so nothing to quote, so the classifier cannot run.
 *     The trigger is the static `baseNativeEth < gasFloorEth` (default 0.001 ETH, POO-1131
 *     `PAYBIS_GAS_FLOOR_ETH`), so a user who buys USDC holding no gas is not forced through the on-ramp
 *     a second time to become transactable.
 * Either way, needs gas => buy ETH on Base and swap the op-funding portion to USDC downstream
 * (`needsSwapToUsdc: true`); has gas => buy USDC on Base directly.
 *
 * ## The amount ([R1] / [R6])
 *
 * `amountUsd = max(minUsd, requiredUsd + gasComponent)`, where `requiredUsd` is the op-funding shortfall
 * (already buffered/ceiled upstream by `sizeOnRampUsd` / the real quote, and consumed AS-IS so this
 * order and the picker's subtitle cannot disagree by a cent), and the gas component is only present when
 * we buy ETH:
 *   `gasComponent = max(classifier figure [in-flow only], gasFloorEth*ethUsd [standalone only], gasChoiceUsd)`.
 * This is the raise-only rule of POO-1085's `raiseTopUpToUsd` restated in fiat: the classifier's figure
 * is an inviolable floor a user choice may only RAISE. It is NOT computed via `raiseTopUpToUsd`, which is
 * bound to a held `GasSourceToken` and caps at that balance (`gasFeasibility.ts:364`); a fiat order has
 * no held token, and routing it through there would silently shrink a card purchase to an unrelated
 * crypto holding.
 *
 * That `max` is ONE decision and both outputs read it (`usdHalfWins`, PR #875 review F4). Only two of
 * the three inputs are context-restricted: `gasChoiceUsd` applies in BOTH contexts by design, so a
 * standalone order can hold a USD gas figure and an ETH gas floor at the same time, and the halves are
 * alternatives because the code picks between them — not because a context ever separates them.
 *
 * ## The ETH target, and why it is a RECIPE ([R1]/[R3] of POO-1573)
 *
 * Both legs are quoted RECEIVED-FIXED now, so the buyer's own currency is resolved server-side on
 * both and a European first-time buyer is no longer billed in dollars. A USDC-BASE order is already
 * received-fixed against its `fiatAmount` (USDC is ~1:1 with USD); an ETH-BASE order needs an ETH
 * figure, which needs an ETH PRICE, which this pure sizer cannot read and a plan must not store (a
 * plan executes for minutes, a price is perishable — [R8]'s reasoning about `quoteId`, restated).
 *
 * So the ETH leg carries {@link ProvisioningOrder.ethTarget}, the recipe `gasFloorEth + fundingUsd /
 * ethUsd`, and the MINT solves it against a price read inside the `"use server"` boundary
 * (`ethTarget.ts`). The two halves are in different units deliberately: the standalone gas floor is
 * natively ETH, and valuing it here through the caller's `ethUsd` produces 0 for a wallet holding no
 * ETH, which is precisely the wallet this leg exists to serve. `fiatAmount` and every USD term
 * behind it are UNCHANGED ([R2]); only the charge currency moves.
 *
 * The whole order floors at {@link PAYBIS_MIN_USD} ($10) per [R6]. That floor is the CARD ladder's floor
 * (`GAS_PRESETS_USD[0]`), never the USDC ladder's $5 (`GAS_PRESETS_USDC_USD[0]`): a card purchase is a
 * fiat purchase and inherits the Paybis fiat minimum. `gasChoiceUsd` must likewise be drawn from the
 * card ladder by the caller. `minUsd` is a parameter that DEFAULTS to `PAYBIS_MIN_USD` so the $10 lives
 * in one home (`computeNeed.ts`, POO-1131), never a second constant, and is CLAMPED to it: the override
 * may only RAISE the floor, because Paybis rejects any order below its own fiat minimum.
 *
 * Money is cents-precision and therefore float-safe (number-formatting skill §3), the same convention
 * `computeNeed.sizeOnRampUsd` and the mock plan's `order.fiatAmount` already use: the arithmetic runs in
 * `number` and the result is rounded to whole cents and emitted as the decimal STRING
 * {@link ProvisioningOrder.fiatAmount}. Non-finite / negative inputs read as zero, the fail-safe posture
 * `gasFeasibility.readUsd` / `withGasHeadroom` pin for a degraded read.
 *
 * Integration: no seam of its own (nothing to mark, and it carries no real call). Every input is
 * provided by the caller from seams already marked elsewhere: `requiredUsd` from
 * `FundingRoute.shortfallUsd` / the `ProvisioningQuote` (POO-1089 / POO-1135), `classifierGasUsd` from
 * `classifyGasFeasibility` (POO-1032), `ethUsd` from the planner's priced-holding ratio
 * (`buildPlan.ts:522`, never CoinGecko), `gasFloorEth` from `PAYBIS_GAS_FLOOR_ETH` (POO-1131). The
 * resulting `order` is placed against a `"buy"` step and quoted received-fixed by
 * `getOnRampQuoteAction` (POO-1132) when the picker mounts (POO-1135).
 *
 * PP-NOTE (POO-1573): that "never CoinGecko" applies to the `ethUsd` INPUT above, which values the
 * gas floor in dollars, and it still holds — this module reads no price. The ETH TARGET is a
 * different figure and it IS priced from `GET /api/v1/prices` (CoinGecko-backed) at mint time, a
 * deliberate exception taken on the record rather than by accident: the balance ratio reads exactly 0
 * for a wallet holding no ETH, and that wallet is the only one the gas-first leg ever serves.
 */

import Decimal from "decimal.js";
import type { ProvisioningOrder } from "@/lib/provisioning";
// The VALUE import comes straight from `computeNeed` (which depends only on `./types`), not the
// `@/lib/provisioning` barrel: the barrel re-exports the `server-only` planner seam, and POO-1135's
// `buildPlan` (also server-only) now imports this sizer, so pulling the barrel here would close a
// `buildPlan -> sizeOnRampOrder -> barrel -> planner -> planActions -> buildPlan` require cycle. The
// TYPE import above stays on the barrel: `import type` is erased, so it creates no runtime edge.
import { PAYBIS_MIN_USD } from "@/lib/provisioning/computeNeed";
// POO-1136: the ONE union for "what the on-ramp bought". It used to be declared here AND in
// `tokenDeltas.ts` (as `OnRampExpectedToken`); the mint site now holds both an order and the
// settlement hook, so the two are collapsed onto this single type. Imported type-only, so the pure
// delta domain owns the symbol and this sizer takes on no runtime edge to it.
import type { OnRampCurrencyCode } from "./tokenDeltas";

export type { OnRampCurrencyCode };

/** What {@link sizeOnRampOrder} needs to size one fiat on-ramp order. */
export interface SizeOnRampOrderInput {
  /**
   * The op-funding shortfall in USD the on-ramp must cover (the NON-gas part). This is
   * `FundingRoute.shortfallUsd` / the quote figure in-flow, already buffered and ceiled upstream and
   * consumed as-is (never re-derived). `0` for a pure standalone gas top-up. When we buy ETH this is the
   * slice swapped to USDC downstream.
   */
  requiredUsd: number;
  /**
   * `true` for a buy-crypto CTA attached to no operation ([R3]); `false` for an in-flow provisioning
   * leg. Selects the gas TRIGGER and which gas inputs apply.
   */
  standalone: boolean;
  /**
   * IN-FLOW ONLY. The resolved upstream gas answer: "must the on-ramp buy ETH to fund this op's gas?",
   * i.e. `classifyGasFeasibility`'s Base verdict combined with `GasFundingSource === "card"`. Taken as an
   * input, never re-derived from raw balances (the issue's "no fourth source classifier"). Ignored when
   * {@link standalone}. Defaults to `false`.
   */
  gasFundedByOnRamp?: boolean;
  /**
   * IN-FLOW ONLY. The classifier's Base gas figure in USD (`GasFeasibility.shortfallUsd`, quote-driven
   * and headroom-included). The raise-only floor of the gas component. Ignored when {@link standalone}
   * (the classifier cannot run with no legs). Defaults to `0`.
   */
  classifierGasUsd?: number;
  /** STANDALONE ONLY. Native ETH held on Base. Below {@link gasFloorEth} => buy ETH for gas. */
  baseNativeEth?: number;
  /** STANDALONE ONLY. The ETH floor (`PAYBIS_GAS_FLOOR_ETH`). `0` disables the standalone gas top-up. */
  gasFloorEth?: number;
  /** ETH/USD price, used only to value the standalone gas floor in USD. A degraded read (0) is safe. */
  ethUsd?: number;
  /**
   * The user's chosen gas top-up in USD, drawn from the CARD ladder `GAS_PRESETS_USD`. Raises the gas.
   *
   * BOTH CONTEXTS, unlike the two inputs above it: rules v2 [R1] lets a standalone order raise its gas
   * this way too. So it is the one input that can put a USD gas figure beside the standalone ETH floor,
   * and it COMPETES with that floor (`max`) rather than adding to it — in `fiatAmount` and in the
   * recipe alike (PR #875 review, F4).
   */
  gasChoiceUsd?: number;
  /**
   * The fiat minimum in USD. Defaults to {@link PAYBIS_MIN_USD} (one home, not a second $10) and is
   * CLAMPED to it: an override may only RAISE the floor, never drop below the minimum Paybis accepts.
   */
  minUsd?: number;
}

/** The sizing result: the {@link ProvisioningOrder} to pre-fill, plus whether a downstream swap is due. */
export interface OnRampOrderSizing {
  /**
   * The order to pre-fill the Paybis widget with. The {@link ProvisioningOrder} shape, so a caller drops
   * it straight into a `"buy"` step's `order` field with no remap (the reconciliation POO-1131 asked
   * for: one name for the money, `fiatAmount`, never a second `amountUsd`).
   */
  order: ProvisioningOrder;
  /**
   * `true` iff `order.currencyCode === "ETH-BASE"`: the on-ramp bought ETH for gas, so the op-funding
   * portion must be swapped to USDC by a downstream leg. `false` for a direct USDC buy. The size of that
   * swap is a downstream leg-builder concern, not this pure sizer's.
   */
  needsSwapToUsdc: boolean;
}

/** A USD figure we trust: finite and non-negative. Anything else reads as zero (degraded-read posture). */
function nonNegativeUsd(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Round a USD amount to whole cents and emit it as a `ProvisioningOrder.fiatAmount` decimal string. */
function toFiatAmount(usd: number): string {
  return (Math.round(usd * 100) / 100).toFixed(2);
}

/**
 * An ETH quantity as a plain decimal STRING, at full precision (POO-1573 [R3]).
 *
 * `Number.prototype.toString` switches to exponent notation under 1e-6, and the floor is
 * env-configurable (`NEXT_PUBLIC_PAYBIS_GAS_FLOOR_ETH`), so `"1e-7"` is reachable and no decimal
 * parser downstream accepts it. `Decimal` is the house tool for token amounts (up to 18dp, which is
 * not float-safe) and `toFixed()` with no argument emits normal notation at full precision.
 */
function toEthString(eth: number): string {
  return new Decimal(eth).toFixed();
}

/**
 * Decide the on-ramp currency and fiat amount for one order. See the module header for the full rule
 * derivation; this body is the "one line" swap the locked [R1] test anticipated.
 */
export function sizeOnRampOrder(input: SizeOnRampOrderInput): OnRampOrderSizing {
  const {
    standalone,
    gasFundedByOnRamp = false,
    classifierGasUsd,
    baseNativeEth,
    gasFloorEth,
    ethUsd,
    gasChoiceUsd,
  } = input;

  const requiredUsd = nonNegativeUsd(input.requiredUsd);
  // [R6] `minUsd` CLAMPS, it does not replace: Paybis rejects any order under PAYBIS_MIN_USD, so an
  // override may only RAISE the floor. A degraded/absent read (0) lands on PAYBIS_MIN_USD for free.
  const minUsd = Math.max(PAYBIS_MIN_USD, nonNegativeUsd(input.minUsd));

  // [R1] The gas trigger, split by context. A broken native read (non-finite) reads as "plenty of gas"
  // so a standalone buy never auto-purchases ETH it may not need; the config's `gasFloorEth = 0` kill
  // switch falls out for free, since `native < 0` is never true.
  const standaloneNativeEth = Number.isFinite(baseNativeEth as number)
    ? (baseNativeEth as number)
    : Number.POSITIVE_INFINITY;
  const needsGas = standalone
    ? standaloneNativeEth < nonNegativeUsd(gasFloorEth)
    : gasFundedByOnRamp;

  // [R1] The gas component, split by the UNIT it is natively denominated in (POO-1573 [R3]). The
  // USD half is the classifier's quote-driven figure (in-flow) raised by the user's card-ladder
  // choice; the ETH half is the standalone floor, which is an ETH quantity and stays one.
  const gasUsdHalf = needsGas
    ? Math.max(standalone ? 0 : nonNegativeUsd(classifierGasUsd), nonNegativeUsd(gasChoiceUsd))
    : 0;
  const gasEthHalf = needsGas && standalone ? nonNegativeUsd(gasFloorEth) : 0;
  /**
   * WHICH HALF IS THE GAS: one decision, read by both outputs below (PR #875 review, F4).
   *
   * The halves are alternatives, and this is what makes that true. Context alone does not: two of the
   * three gas inputs ARE context-restricted (`classifierGasUsd` in-flow, guarded above; `gasFloorEth`
   * standalone), but `gasChoiceUsd` is neither, because rules v2 [R1] deliberately lets a STANDALONE
   * order raise its gas from the card ladder. So one order can hold both halves at once, and reading
   * the `max` for `fiatAmount` while the recipe below read both would charge the gas floor a second
   * time on top of a choice that had already outbid it.
   *
   * Ties go to the ETH half, which is what keeps the ordinary standalone leg intact: with no choice
   * and the `ethUsd` of 0 an empty wallet reports, both sides are 0 and the floor must survive as an
   * ETH quantity — the whole point of the recipe ([R3]).
   */
  const usdHalfWins = gasUsdHalf > gasEthHalf * nonNegativeUsd(ethUsd);
  // The DOLLAR gas component, unchanged from POO-1133: raise-only, with the ETH floor valued at the
  // caller's `ethUsd` (0 for a wallet holding no ETH, which is why POO-1573 stops deriving the ETH
  // TARGET from it — but the USD sizing itself is deliberately untouched, [R2]). Written as the
  // winner rather than as a second `Math.max`, so the recipe cannot pick a different one.
  const gasComponent = usdHalfWins ? gasUsdHalf : gasEthHalf * nonNegativeUsd(ethUsd);
  // The winner again, in the two units the recipe carries: the loser contributes nothing to either.
  const recipeGasEth = usdHalfWins ? 0 : gasEthHalf;
  const recipeGasUsd = usdHalfWins ? gasUsdHalf : 0;

  const currencyCode: OnRampCurrencyCode = needsGas ? "ETH-BASE" : "USDC-BASE";
  // [R6] Floor the whole order at the CARD ladder floor (`minUsd` = PAYBIS_MIN_USD = GAS_PRESETS_USD[0]),
  // never the USDC ladder's $5: a card purchase inherits the Paybis fiat minimum.
  const amountUsd = Math.max(minUsd, requiredUsd + gasComponent);

  return {
    order: {
      currencyCode,
      fiatAmount: toFiatAmount(amountUsd),
      // PP-NOTE POO-1512 [R6] / POO-1573 [R2]: "USD" is what `fiatAmount` is COMPUTED in, on both
      // legs, and it stays the unit of every internal figure (the floor, the gas). It
      // is no longer what the buyer is CHARGED in: both legs are quoted received-fixed now, so the
      // rail omits `currencyCodeFrom` and the buyer's own currency is resolved server-side. It is
      // NOT a fallback for an unpriced ETH leg: since rules v2 ([R5]) that leg REFUSES the purchase
      // rather than degrading to a USD charge. It is still the pinned currency for an order that
      // carries no ETH recipe at all, which today means a plan built before POO-1573 or a fixture.
      fiatCurrency: "USD",
      // POO-1573 [R1]: the received-fixed target's recipe, solved at MINT time against a real ETH
      // price. Only the ETH leg needs one; a USDC-BASE order is received-fixed against `fiatAmount`.
      //
      // PP-NOTE (POO-1573, `CR-TOK-006`): THIS IS THE DIVERGENCE SITE. `fiatAmount` above and the
      // recipe below size the same order and can name different money, by a decision taken on the
      // record (Rafael, 2026-08-13) rather than by omission. `ethUsd` is exactly 0 for a wallet
      // holding no ETH, which is the only wallet the standalone gas-first leg ever serves, so
      // `gasComponent` values the ETH floor at $0 in `fiatAmount` while `recipeGasEth` still
      // carries it here and the mint prices it for real. The charge therefore exceeds the recorded
      // figure by exactly `gasFloorEth * ethUsd_at_mint` ($2.50 at $2,500/ETH). It is KEPT: before
      // this issue the leg was spend-fixed at `fiatAmount`, so it bought whatever that bought and the
      // gas floor was aspirational; it now genuinely funds gas, and the surplus lands in the buyer's
      // own wallet. Do not "reconcile" the two by folding the floor into `fundingUsd` -- that
      // reintroduces the `ethUsd = 0` dependency this issue removed. Pinned by
      // `sizeOnRampOrder.test.ts` and, end to end, by `ethTarget.test.ts` (`[CR-TOK-006]`).
      ...(needsGas
        ? {
            ethTarget: {
              gasFloorEth: toEthString(recipeGasEth),
              // [R2] The USD half carries the SAME fiat floor `fiatAmount` does, because
              // PAYBIS_MIN_USD is a dollar minimum and applies BEFORE the conversion.
              fundingUsd: toFiatAmount(Math.max(minUsd, requiredUsd + recipeGasUsd)),
            },
          }
        : {}),
    },
    needsSwapToUsdc: needsGas,
  };
}
