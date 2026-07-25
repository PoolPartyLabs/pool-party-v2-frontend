/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1033)
 * @name computeProvisioningNeed
 * @implements-rules-version v2 (POO-1033 rules v1)
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
 */
import type {
  ChainBalancesUsd,
  ProvisioningNeed,
  ProvisioningNeedInput,
  ProvisioningReason,
} from "./types";

/** Gas preset shortcuts shown in the buy-gas modal (USD). Both ≥ the Paybis $10 floor. */
export const GAS_PRESETS_USD = [10, 25] as const;
/** Default-selected gas amount (USD). */
export const GAS_DEFAULT_USD = 10;
/** Custom gas input bounds (USD) — locked with murilo 2026-06-30. */
export const GAS_CUSTOM_MIN_USD = 10;
export const GAS_CUSTOM_MAX_USD = 200;
/** Paybis on-ramp minimum (USD) — POO-87. */
export const PAYBIS_MIN_USD = 10;
/** Mock slippage buffer applied over a shortfall before the on-ramp (real mode: from the quote). */
export const MOCK_SLIPPAGE_BUFFER_RATE = 0.02;

/** Clamp a custom gas amount to the locked `[10, 200]` bounds. */
export function clampGasUsd(usd: number): number {
  return Math.min(GAS_CUSTOM_MAX_USD, Math.max(GAS_CUSTOM_MIN_USD, usd));
}

/**
 * Mock heuristic for how much USDC to buy on-ramp to cover a `shortfallUsd`: add a slippage buffer
 * and `feesUsd`, round up to whole dollars, and enforce the Paybis $10 floor. Real mode uses the
 * authoritative `ProvisioningQuote` instead of this.
 */
export function sizeOnRampUsd(shortfallUsd: number, feesUsd = 0): number {
  const buffered = Math.ceil(shortfallUsd * (1 + MOCK_SLIPPAGE_BUFFER_RATE) + feesUsd);
  return Math.max(PAYBIS_MIN_USD, buffered);
}

/**
 * The chain the fiat on-ramp always lands USDC on (Paybis buys on Base — epic POO-411 global rule).
 * It matters to the routing verdict: money the user has to BUY arrives here, so an op running
 * anywhere else needs that money bridged, even when the wallet is empty everywhere.
 */
export const ONRAMP_CHAIN_ID = 8453;

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
