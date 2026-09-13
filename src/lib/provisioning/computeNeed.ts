/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1033, POO-1166, POO-1559, POO-1641)
 * @name computeProvisioningNeed
 * @implements-rules-version v5 (POO-1641 rules v1) · v4 (POO-1559 rules v1) · v3 (POO-1166 / POO-1129 rules v3) · v2 (POO-1033 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Pure FE requirement calculator for pre-flight provisioning (epic POO-411). Given wallet state
 * (already converted to USD by the gate, POO-418) + op context, it decides what is missing (native
 * gas, USDC for the op, or funds on the wrong network), by how much, and which UI branch to take:
 *   none      → the op signs unchanged (no modal)
 *   gas-only  → the buy-gas modal (PP-CORE-MOD-010, POO-331) — even when an on-ramp is needed to fund
 *               the gas, the only OP-level requirement is gas, so the simpler modal handles it
 *   multi     → the provisioning wizard (PP-CORE-MOD-011, POO-409) — the op needs USDC and/or a bridge
 *
 * No I/O, no React, no viem: pure number-math so the branch matrix is exhaustively unit-tested. The
 * authoritative amounts come from the planner quote (POO-413); this only drives detection + routing.
 * The mock on-ramp sizing here ({@link sizeOnRampUsd}) is the documented mock heuristic — real mode
 * reads the buffer from {@link ProvisioningQuote}.
 *
 * v2 (POO-1033 rules v1), two rule changes:
 *   [R1] the wallet is a per-chain map ({@link ProvisioningNeedInput.balancesByChain}), not one
 *        scalar balance on one chain. A scalar wallet cannot answer "can this be funded by
 *        bridging", because it does not know where the money is.
 *   [R2] a bridge is no longer conditional on the op spending USDC. It used to be
 *        `opRequiredUsdc > 0 && currentChainId !== targetChainId`, so withdraw / collect /
 *        move-range / close — which all pass `opRequiredUsdc = 0` — could never reach the network
 *        branch, and a wallet with no gas on the position's chain got a gas-only plan even when the
 *        only funds that could buy that gas were a chain away.
 * The verdict vocabulary is untouched ([R3]) and gas that can be sourced on the target chain still
 * routes to gas-only ([R4]), so the six op modals' branch handling is unchanged.
 *
 * v3 (POO-1166) gave the on-ramp fee ONE home (`ONRAMP_FEE_RATE`) and the gross-up that spent it
 * (`grossUpForOnRampFee` / `onRampFeeUsd`), so the mock fixture and the real planner would size the
 * same purchase.
 *
 * v5 (POO-1641) DELETES all three, and adds no verdict logic either. The gross-up rested entirely on
 * "our 1% is taken out of what the purchase delivers". It is not: the cut is a partner-side
 * configuration, already embedded in the price Paybis quotes, and it is not 1% any more either
 * (Rafael, 2026-08-16). Nothing in `pool-party-api` collects it. So the delivered crypto arrives
 * WHOLE and the gross-up was inflating every order by a percent for a deduction that never happens.
 *
 * Sizing is now the buffer and the floor, and nothing else. Do not reintroduce a rate here, or a
 * `0.01` under any other name: a fee the frontend models is a figure the buyer pays that no one
 * receives. If a Pool Party cut is ever genuinely collected client-side, it arrives as a QUOTED
 * number from the rail, the way Paybis's own charge already does (POO-1139 received-fixed), not as a
 * constant this module invents.
 */
import type {
  ChainBalancesUsd,
  ProvisioningNeed,
  ProvisioningNeedInput,
  ProvisioningReason,
} from "./types";

/**
 * Gas preset shortcuts for gas bought with a CARD (USD). Both ≥ the Paybis $10 floor.
 *
 * POO-1084 [F1-R4]: this is the card-funded set, not the only one. See {@link GAS_PRESETS_USDC_USD}.
 */
export const GAS_PRESETS_USD = [10, 25] as const;
/**
 * Gas preset shortcuts for gas paid out of USDC the wallet already holds (USD).
 *
 * Lower than the card set on purpose: the `$10` floor is a fiat-purchase minimum imposed by Paybis,
 * and a swap out of an existing holding is not a purchase. Forcing $10 there would spend ten dollars
 * of someone's balance to buy a few cents of native coin.
 */
export const GAS_PRESETS_USDC_USD = [5, 10] as const;
/** Default-selected gas amount (USD). */
export const GAS_DEFAULT_USD = 10;
/** Custom gas input bounds (USD) — locked with murilo 2026-06-30. */
export const GAS_CUSTOM_MIN_USD = 10;
/** Custom lower bound when the gas is paid out of USDC (POO-1084 [F1-R4]). */
export const GAS_CUSTOM_MIN_USDC_USD = 5;
export const GAS_CUSTOM_MAX_USD = 200;
/**
 * Paybis on-ramp minimum (USD) — POO-87.
 *
 * **This number is KNOWN to be slightly below the vendor's own floor, and that is tracked, not
 * overlooked.** Measured in production on 2026-08-17 (POO-1666): Paybis refused a 10-USDC order with
 * "You have to buy or sell at least 10.003001 USDC per order", and the figure MOVED across four
 * minutes of one capture (10.002, 10.002, 10.003001) because the vendor floor is a fiat amount
 * (`minAmount: 8.63 EUR`) divided by a live rate.
 *
 * Raising it was attempted and REVERTED, deliberately: this app has FOUR independent $10 floors
 * (`MIN_DEPOSIT` in `DepositScreen`, `GAS_PRESETS_USD[0]`, `GAS_CUSTOM_MIN_USD`, and this one) plus a
 * hardcoded "as little as $10" in 12 locales, and moving this one alone opens a band where the screen
 * states a minimum the app will not place. See POO-1670.
 *
 * What makes leaving it here SAFE is POO-1666's [R9]: a quote whose methods the vendor has refused no
 * longer reaches the mint, so a below-floor order now degrades to a widget without a prefill instead
 * of a 422. The floor is a UX nicety; the refusal check is the correctness boundary.
 */
export const PAYBIS_MIN_USD = 10;
/** Mock slippage buffer applied over a shortfall before the on-ramp (real mode: from the quote). */
export const MOCK_SLIPPAGE_BUFFER_RATE = 0.02;

/** Clamp a custom gas amount to the locked `[10, 200]` bounds. */
export function clampGasUsd(usd: number): number {
  return Math.min(GAS_CUSTOM_MAX_USD, Math.max(GAS_CUSTOM_MIN_USD, usd));
}

/**
 * Mock heuristic for how much USDC to buy on-ramp to cover a `shortfallUsd`: add a slippage buffer,
 * round up to whole dollars, and enforce the Paybis $10 floor. Real mode uses the authoritative
 * `ProvisioningQuote` instead of this.
 *
 * The floor is applied LAST, after the buffer, so a remainder too small to transact rounds UP to a
 * size Paybis accepts rather than producing an order it would reject.
 *
 * POO-1641 removed the second `feesUsd` parameter along with the fee it existed to carry. There is no
 * caller-supplied fee term any more, and there should not be one: the only fee on this rail is the
 * vendor's, and the vendor quotes it (POO-1139 received-fixed). This stays a documented mock
 * HEURISTIC either way, because {@link MOCK_SLIPPAGE_BUFFER_RATE} is a placeholder rather than a
 * quoted allowance.
 */
export function sizeOnRampUsd(shortfallUsd: number): number {
  const buffered = Math.ceil(shortfallUsd * (1 + MOCK_SLIPPAGE_BUFFER_RATE));
  return Math.max(PAYBIS_MIN_USD, buffered);
}

/**
 * The chain the fiat on-ramp always lands USDC on (Paybis buys on Base — epic POO-411 global rule).
 * It matters to the routing verdict: money the user has to BUY arrives here, so an op running
 * anywhere else needs that money bridged, even when the wallet is empty everywhere.
 */
export const ONRAMP_CHAIN_ID = 8453;

/**
 * Does a fiat purchase for this route have to BUY GAS as well as USDC? (POO-1542 [A]/[B])
 *
 * ## One predicate, because two opinions of this cost the screen its honesty
 *
 * `buildPlan` decides whether the order is `ETH-BASE` (gas-first) or `USDC`, and the "Where from" row
 * decides whether to print the `$2` native reserve. Those are the same question, and they were being
 * answered by two different expressions: the planner read **Base's** verdict while the panel read the
 * **target chain's**, so the reachable case below rendered the one state built to have no gas on an
 * operation that was about to buy gas.
 *
 * Target Arbitrum, ~$20 of ETH on Arbitrum (enough for gas, dust-filtered out of `sources`), nothing on
 * Base: Arbitrum's verdict is `OK`, so the row printed `Buy $210.00` with no reserve and the screen
 * rendered `1c` ("no gas needed"), while the planner saw no Base verdict at all, bought ETH and sized
 * gas in. The row understated what the route sources, which is the direction [R10] exists to prevent.
 *
 * ## Why the absent verdict is a real term rather than defensive coding
 *
 * `gasByChain` carries a verdict for the SOURCE chains and for `targetChainId` (`gateContext.ts`), so a
 * wallet holding nothing on Base has **no Base entry to read**. Treating that as "gas is fine" is
 * exactly how the case above stayed invisible.
 *
 * ## The target term, and the one case it moves
 *
 * The planner still ORs `gasStillBlocked` into its decision (the target is `BLOCKED`, no crypto donor
 * can unblock it, and the on-ramp can), but that term is redundant by construction: `gasStillBlocked`
 * requires a `BLOCKED` target verdict, which the target term here already reads as not-OK. The plan's
 * decision therefore IS this predicate, and the row matches it exactly: whenever the row discloses the
 * `$2` reserve, the purchase does go ETH-first and holds it.
 *
 * The target term is a real behaviour change against the pre-POO-1542 planner (`gasStillBlocked ||
 * Base not-OK`): Base `OK` with a target that is merely `TOP_UP` now buys ETH gas-first where it used
 * to order plain USDC. That is the [R4] direction on purpose (any surplus stays in the wallet and
 * never strands, so the cost is a few dollars more on the card, never an unbroadcastable route), and
 * it is pinned in `buildPlan.test.ts` ("buys ETH gas-first when Base is OK but the TARGET chain is
 * only TOP_UP").
 */
export function onRampRouteBuysGas(
  gasByChainId: Readonly<Record<number, { verdict: string } | undefined>>,
  targetChainId: number,
): boolean {
  const notOk = (chainId: number): boolean => gasByChainId[chainId]?.verdict !== "OK";
  return notOk(ONRAMP_CHAIN_ID) || notOk(targetChainId);
}

/**
 * Tolerance on the USD comparisons introduced in v2. USD figures are display-grade floats by
 * contract, so `100.1 - 100.1` can land on 1.4e-14 — and a residue that small must not be the
 * difference between "sign this" and "bridge your money".
 */
const USD_EPSILON = 1e-6;

/** The wallet, reduced to the three quantities the verdict actually depends on. */
interface FundingView {
  /** Native USD on the TARGET chain: the only balance that can pay this op's gas. */
  targetNativeUsd: number;
  /** Routable token USD sitting ON the target chain: fills the op, or swaps into gas there. */
  targetTokenUsd: number;
  /** Routable token USD on every OTHER chain: the bridgeable reserve. */
  offTargetTokenUsd: number;
}

/**
 * Resolve the wallet from whichever shape the caller passed.
 *
 * The per-chain map is the authority. The legacy scalar pair is kept working (POO-1033 R1) because
 * the mock scenarios and the six op modals still speak it, but it is strictly less informative: it
 * cannot say which chain the native coin is on. The old math read it as "available to this op", and
 * that reading is preserved verbatim here so no existing caller's verdict moves under it. Callers
 * that know better pass `balancesByChain` and get the chain-aware answer.
 */
function resolveFunding(input: ProvisioningNeedInput): FundingView {
  const { balancesByChain, targetChainId } = input;

  if (balancesByChain) {
    let offTargetTokenUsd = 0;
    for (const key of Object.keys(balancesByChain)) {
      const chainId = Number(key);
      const held: ChainBalancesUsd | undefined = balancesByChain[chainId];
      // Another chain's NATIVE coin is deliberately not counted: it is what pays that chain's own
      // gas, and working out how much of it could be spared needs a live quote (POO-1032/POO-1034).
      // Under-counting falls back to the on-ramp; over-counting would promise a route that cannot
      // pay for itself.
      if (held && chainId !== targetChainId) offTargetTokenUsd += held.tokenUsd;
    }
    const onTarget = balancesByChain[targetChainId];
    return {
      targetNativeUsd: onTarget?.nativeUsd ?? 0,
      targetTokenUsd: onTarget?.tokenUsd ?? 0,
      offTargetTokenUsd,
    };
  }

  const onTargetChain = input.currentChainId === targetChainId;
  const tokenUsd = input.usdcBalanceUsd ?? 0;
  return {
    targetNativeUsd: input.nativeBalanceUsd ?? 0,
    targetTokenUsd: onTargetChain ? tokenUsd : 0,
    offTargetTokenUsd: onTargetChain ? 0 : tokenUsd,
  };
}

/**
 * Total routable token value (USD) the wallet can spend on this op, wherever it currently sits.
 * This is the "you have" figure the gas selector validates a custom amount against: money on
 * another chain is still the user's money, it just costs a bridge leg to reach.
 */
export function spendableTokenUsd(input: ProvisioningNeedInput): number {
  const funds = resolveFunding(input);
  return funds.targetTokenUsd + funds.offTargetTokenUsd;
}

/**
 * A routable holding, as the funding inventory reports it (POO-1031): where it sits, what it is
 * worth, and whether it is the chain's own coin.
 *
 * Structurally typed on purpose. `FundingSource` lives in `fundingInventory.ts`, which is
 * `server-only`, and this module is re-exported by the client barrel, so even a type-only edge would
 * trip `serverBoundary.test.ts`. Every `FundingSource` satisfies this shape.
 */
export interface RoutableHolding {
  /** The chain the holding sits on. */
  chainId: number;
  /** Its USD value. */
  usd: number;
  /** The chain's own coin. It pays gas there, and is never counted as spendable token value. */
  isNative: boolean;
}

/** A USD figure, or `0` when whatever produced it did not produce a number ([R6]). */
function finiteUsd(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The wallet as this calculator must SEE it: native RAW, tokens ROUTABLE only.
 *
 * POO-1149 rules v1, generalised here by POO-1559 rules v1 so the swap screen reads the same wallet
 * as the six operation modals.
 *
 * ## The defect this closes, with the numbers it was reported on
 *
 * {@link computeProvisioningNeed} decides whether an operation needs provisioning at all, and both
 * callers were handing it the gate context's `balancesByChain`, documented there as "per-chain native
 * and token USD, from the RAW holdings". Raw means every token the wallet happens to hold, whether or
 * not anything can convert it, while {@link ChainBalancesUsd.tokenUsd} has always claimed to be the
 * routable half. The contract said one thing and the caller passed another.
 *
 * Reported 2026-08-11 (POO-1552), real mode: a $1 invest on a **Base** strategy sent the user to
 * `/deposit` and its $10 fiat minimum while 3.05 USDC sat on Arbitrum. The wallet held 3.2263 VIRTUAL
 * on Base, worth $1.78, and that is the whole story:
 *
 *   `unmetOnTargetUsd = 1 + 0 - 1.78 = -0.78`  -> not > epsilon    -> `needsBridge` false
 *   `spendableUsd     = 1.78 + 3.05 = 4.83 >= 1`                   -> `needsUsdc`   false
 *   `targetNativeUsd  = 3.25 (Base ETH) >= gas`                    -> `needsGas`    false
 *                                                                  -> `needed`      FALSE
 *
 * The gate concluded the operation was already funded and stood aside. Nothing was logged, because
 * standing aside IS its designed answer to "nothing is missing": a wrong input produced a confident
 * wrong answer, and a funded user was told to go and buy fiat.
 *
 * ## Why the token half is the routable inventory and the native half is not
 *
 * The routable inventory is the wallet intersected with Uniswap's `swappable_tokens` allowlist and
 * dust-filtered: it IS the answer to "what can pay for this". Summing it per chain is what makes
 * `spendableUsd` mean what its name says.
 *
 * Native stays RAW, deliberately. Gas is chain-local and paid in the chain's own coin, so whether
 * anything would route it is beside the point: what matters is whether it is there. {@link
 * resolveFunding} already refuses to count another chain's native as fundable, for the reason
 * recorded there.
 *
 * Non-native holdings only. A native holding can genuinely fund an operation by being swapped, so
 * excluding it UNDER-counts and the gate fires slightly more often than strictly necessary. That is
 * the safe direction and the same one `resolveFunding` chose: under-counting falls back to the
 * on-ramp, over-counting would promise a route that cannot pay for itself. The panel still offers the
 * native coin above the signing reserve (POO-1155).
 *
 * ## What the CALLER decides
 *
 * Which holdings are routable *for this operation*. The six operation modals offer the whole
 * inventory (`buildProvisioningInput.ts`); the swap screen withholds the destination chain's own
 * USDC, because it nets that out of the requirement instead and counting it on both sides would
 * under-state the move (`swapRequest.ts`, POO-1559 [R3]). Passing the list rather than the context is
 * what lets one rule serve both without either surface guessing at the other's accounting.
 */
export function spendableBalancesByChain(
  balancesByChain: Readonly<Record<number, ChainBalancesUsd>>,
  routable: readonly RoutableHolding[],
): Record<number, ChainBalancesUsd> {
  const routableTokenUsd: Record<number, number> = {};
  for (const holding of routable) {
    if (holding.isNative) continue;
    routableTokenUsd[holding.chainId] =
      (routableTokenUsd[holding.chainId] ?? 0) + finiteUsd(holding.usd);
  }

  const out: Record<number, ChainBalancesUsd> = {};
  // Every chain either view knows about: a chain with native and no routable token still has to be
  // able to report its gas, and a chain whose raw entry is missing but which carries a routable
  // holding must not vanish from the off-target sum.
  for (const key of new Set([...Object.keys(balancesByChain), ...Object.keys(routableTokenUsd)])) {
    const chainId = Number(key);
    if (!Number.isInteger(chainId)) continue;
    out[chainId] = {
      nativeUsd: finiteUsd(balancesByChain[chainId]?.nativeUsd),
      tokenUsd: finiteUsd(routableTokenUsd[chainId]),
    };
  }
  return out;
}

/** Compute what the op is missing and which provisioning branch to take. */
export function computeProvisioningNeed(input: ProvisioningNeedInput): ProvisioningNeed {
  const { targetChainId, opRequiredUsdc, gasEstimateUsd, gasChoiceUsd } = input;
  const funds = resolveFunding(input);

  // A user-chosen gas top-up raises the required native; otherwise the bare op estimate applies.
  // Gas is chain-local: only native ON the target chain counts, never a balance held elsewhere.
  const requiredGasUsd = gasChoiceUsd ?? gasEstimateUsd;
  const needsGas = funds.targetNativeUsd < requiredGasUsd;
  const gasShortfallUsd = needsGas ? requiredGasUsd - funds.targetNativeUsd : 0;

  // USDC is only an op-level requirement when the op actually consumes USDC (invest); collect /
  // withdraw / close pass opRequiredUsdc = 0. Funds count wherever they sit: holding the USDC on
  // another chain is a MOVE problem (needsBridge below), not a BUY problem.
  const spendableUsd = funds.targetTokenUsd + funds.offTargetTokenUsd;
  const needsUsdc = opRequiredUsdc > 0 && spendableUsd < opRequiredUsdc;
  const usdcShortfallUsd = needsUsdc ? opRequiredUsdc - spendableUsd : 0;

  // [R2]/[R4] What the target chain itself has to supply: the op's USDC, plus whatever token value
  // must be swapped into native there to close the gas gap. A bridge is needed when that demand
  // cannot be met on the target chain AND can be met from somewhere else — either another chain the
  // wallet already funds, or the on-ramp, whose USDC always lands on Base. When neither can supply
  // it, there is nothing to bridge and the plan stays a straight buy (gas-only).
  const unmetOnTargetUsd = opRequiredUsdc + gasShortfallUsd - funds.targetTokenUsd;
  const fundableFromAnotherChain = funds.offTargetTokenUsd > 0 || targetChainId !== ONRAMP_CHAIN_ID;
  const needsBridge = unmetOnTargetUsd > USD_EPSILON && fundableFromAnotherChain;

  const reason: ProvisioningReason[] = [];
  if (needsGas) reason.push("gas");
  if (needsUsdc) reason.push("usdc");
  if (needsBridge) reason.push("network");

  const needed = reason.length > 0;
  const variant = !needed ? "none" : needsUsdc || needsBridge ? "multi" : "gas-only";

  return {
    needed,
    needsGas,
    gasShortfallUsd,
    needsUsdc,
    usdcShortfallUsd,
    needsBridge,
    targetChainId,
    reason,
    variant,
  };
}
