/**
 * @id PP-STR-LIB-004 (POO-419, POO-1042, POO-1149, POO-1549, POO-1559, POO-1749)
 * @name buildProvisioningInput
 * @implements-rules-version v5 (POO-1749 rules v1) · v4 (POO-1149 rules v1) · v3 (POO-1549 rules v1) · v2 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The shared bridge from an op modal to the pre-flight provisioning gate (epic POO-411, POO-419).
 * Every op modal (invest / withdraw / collect / compound / move-range / close) reaches the gate
 * through {@link useProvisioningGate}, which assembles the {@link ProvisioningNeedInput} here.
 * Keeping the assembly in ONE place for all six ops is what stops six modals drifting apart.
 *
 * Mock mode fabricates a short-balance scenario per op so the gate is demoable end-to-end:
 *   - invest → the worst case (buy USDC → bridge → swap gas → op), i.e. the "multi" wizard branch
 *   - withdraw / collect / compound / move-range / close spend no USDC, so they route to the simpler
 *     "gas-only" branch (one swap-gas step).
 *
 * ## What POO-1042 changed
 *
 * The real branch used to return a wallet holding $1,000,000 with `opRequiredUsdc: 0`, so it could
 * not trip under any input. That was honest while nothing behind it was real; it also meant the
 * entire funding rail could be built and never called. It now assembles from the LIVE gate context
 * ({@link ProvisioningGateContext}, read server-side from the SIWE wallet):
 *
 *   [R1] the wallet is the per-chain map, not a scalar. "Can this be funded by bridging" is
 *        unanswerable without knowing WHERE the money is, and five of the six operations spend no
 *        USDC at all, so the scalar shape could never reach the network branch for them.
 *   [R2] the target chain comes from the operation. Move-range and close used to pass no op context
 *        whatsoever, so their gate ran against a chain nobody chose.
 *   [R3] `opRequiredUsdc` is the entered amount for invest and zero for the other five. Withdraw and
 *        close carry a USD figure of their own — how much is coming OUT — and reading that as USDC
 *        the wallet must PROVIDE would invert the operation.
 *   [R4] `gasEstimateUsd` is quoted, never the `0.5` that is still hardcoded in
 *        `mapManagerStrategyDetail.ts`.
 *   [R6] no context (a degraded read) is non-triggering, so the operation proceeds exactly as it
 *        does today. A funded user blocked by a modal because a balance endpoint blipped is worse
 *        than not having the feature.
 */

import { supportedChains } from "@/lib/chains/config";
import type { ProvisioningNeedInput } from "@/lib/provisioning";
import { SCENARIOS, spendableBalancesByChain } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { isMockMode } from "@/lib/services";

/** The six on-chain ops that flow through the pre-flight gate (POO-419 R4). */
export type ProvisioningOp =
  | "invest"
  | "withdraw"
  | "collect"
  | "compound"
  | "move-range"
  | "close";

/** All ops, in flow order — handy for exhaustive iteration in tests and callers. */
export const PROVISIONING_OPS = [
  "invest",
  "withdraw",
  "collect",
  "compound",
  "move-range",
  "close",
] as const satisfies readonly ProvisioningOp[];

/**
 * The ops that consume USDC from the wallet ([R3]).
 *
 * Exactly one today. Written as a set rather than an `op === "invest"` check so that adding a second
 * spending operation is a one-line data change at the place the rule lives, instead of a condition
 * someone has to find.
 */
const USDC_SPENDING_OPS = new Set<ProvisioningOp>(["invest"]);

/**
 * i18n key (in the `strategies` namespace) for each op's anchor title shown at the bottom of the
 * plan, e.g. `"Invest in {strategy}"`. The host modal resolves it with the strategy/pool name.
 */
export const OP_LABEL_KEY: Record<ProvisioningOp, string> = {
  invest: "provisioning.opLabel.invest",
  withdraw: "provisioning.opLabel.withdraw",
  collect: "provisioning.opLabel.collect",
  compound: "provisioning.opLabel.compound",
  "move-range": "provisioning.opLabel.moveRange",
  close: "provisioning.opLabel.close",
};

/** The op-anchor i18n key for `op`. */
export function provisioningOpLabelKey(op: ProvisioningOp): string {
  return OP_LABEL_KEY[op];
}

/** The op context the gate assembles an input from. */
export interface ProvisioningInputContext {
  /**
   * The live gate context for this operation's chain, or `null` when the wallet could not be read
   * ([R6]). Type-only across the boundary: `gateContext.ts` is `server-only` and this module is
   * reachable from `"use client"` code, so this must never become a value import (ADR 0003).
   */
  context: ProvisioningGateContext | null;
  /** The USD amount the user entered. Only invest turns this into a USDC requirement ([R3]). */
  amount?: number;
  /** Max slippage from the settings gear, percent (POO-523 R2). Rides through to the planner. */
  slippagePct?: number;
  /**
   * POO-1549 [R1]: the chain the OPERATION runs on, resolved from its network slug by the gate hook.
   *
   * Real mode never needed it, because `context.targetChainId` is the same fact arriving a different
   * way. Mock mode did, and not having it is the whole defect: the demo scenarios carry a baked chain,
   * so every invest presented as bridging to Arbitrum and the five non-spending operations as needing
   * gas on Base, whatever the strategy was actually on. `undefined` (an unresolvable network slug)
   * keeps the fixture default rather than guessing: real mode already treats that as non-triggering.
   */
  targetChainId?: number;
  /**
   * POO-1749 [R1]: the host surface's own directly-read USDC balance on the operation's chain, USD.
   *
   * The gate context and the host read the same wallet through different pipes, and the pipes can
   * disagree. Two deterministic modes are already on record (both 2026-08-24/25, production):
   * pool-party-api renders a stable balance of ~$9,999.5 or more in scientific notation
   * (`formatSignificant(balance, 4)` → "1.089e+4"), the funding context's `toBaseUnits` rejects that
   * string, and the holding drops from `sources` on EVERY read (POO-1750) — $10,885.73 of on-target
   * USDC erased from the gate's view while the modal beside it displayed that exact figure and gated
   * its own CTA on it, sending a fully funded investor to buy $11,337.78 of fiat. And at ANY balance,
   * the surviving row's `usd` is cent-rounded upstream while the Max chip fills the amount at full
   * precision, so a Max press read as short by a fraction of a cent and fired the funnel.
   *
   * USDC on the operation's OWN chain is spendable by the OP LEG by definition: invest consumes it
   * in place, no Uniswap route involved, so routability is not a fact about that half. The GAS half
   * is different — `unmetOnTargetUsd` assumes on-target token value can be swapped into native,
   * which does need a route — but USDC sits on Uniswap's allowlist on all three chains, so
   * "genuinely unroutable USDC" is in practice always a failed lookup, never a missing route. The
   * host's read therefore FLOORS the target chain's token value ([R1], `max`, never replace [R3]);
   * every other chain keeps the routable projection ([R2]). Absent or unusable (non-finite,
   * non-positive) it contributes nothing, leaving behavior exactly as before ([R4]), and it is
   * ignored when the context echoes a different chain than the host read ({@link targetChainId}) —
   * crediting one chain's verified USDC to another is exactly the [R2] violation this rule forbids.
   * Only invest passes it today.
   *
   * This floor SURVIVES POO-1750. It is not a workaround for one serializer bug: it is the
   * invariant that the gate never reads the wallet as poorer than the host's own on-chain figure,
   * and two independent pipes can always disagree again. Do not remove it when POO-1750 lands.
   */
  targetUsdcBalanceUsd?: number;
}

/**
 * A wallet that already meets every requirement → {@link computeProvisioningNeed} returns
 * `needed: false`. Used whenever the live context is missing, so a degraded read leaves the
 * operation exactly as it is today ([R6]). Deliberately independent of the op amount (a large invest
 * must NOT trip it) — `opRequiredUsdc: 0` keeps it inert.
 */
const NON_TRIGGERING_INPUT: ProvisioningNeedInput = {
  nativeBalanceUsd: 1_000,
  usdcBalanceUsd: 1_000_000,
  currentChainId: 8453,
  targetChainId: 8453,
  opRequiredUsdc: 0,
  gasEstimateUsd: 0,
};

/**
 * A supported chain that is NOT the operation's, for the "your money is on the wrong network" story
 * ([R2]).
 *
 * Derived from `supportedChainMetas` rather than hardcoded, so adding a fourth chain cannot leave a
 * stale literal behind: the previous shape baked `currentChainId: BASE` beside `targetChainId:
 * ARBITRUM`, and picking Base for a Base operation would have quietly turned the bridge demo into a
 * same-chain one. Falls back to the operation's own chain when there is somehow no other, which
 * degrades the demo to "no bridge needed" rather than inventing a chain the app does not support.
 */
function offTargetChainId(targetChainId: number): number {
  return supportedChains.find((chain) => chain.id !== targetChainId)?.id ?? targetChainId;
}

/**
 * PP-MOCK: the demo input per op, built from the canonical {@link SCENARIOS}. invest reuses the
 * worst-case `usdcBridgeGas` (multi), carrying the entered amount as the op's USDC requirement so the
 * plan sizes the on-ramp realistically; every other op spends no USDC and reuses `gasOnly` (the
 * one-step gas-only branch).
 */
export function mockProvisioningInput(
  op: ProvisioningOp,
  amount?: number,
  targetChainId?: number,
): ProvisioningNeedInput {
  const scenario = op === "invest" ? SCENARIOS.usdcBridgeGas : SCENARIOS.gasOnly;
  const base =
    op === "invest"
      ? {
          ...scenario,
          opRequiredUsdc: amount && amount > 0 ? amount : scenario.opRequiredUsdc,
        }
      : { ...scenario };
  // [R1] No resolved chain means an unknown network slug, which real mode treats as non-triggering.
  // Keeping the fixture default is the same refusal to invent: the demo is wrong-chained rather than
  // wrong AND silent about which chain it thinks it is on.
  if (targetChainId === undefined) return base;
  return {
    ...base,
    targetChainId,
    // [R2] Each scenario's STORY is what makes it worth demoing, and both stories are relative to the
    // operation's chain rather than to a particular one. `gasOnly` is "gas missing on the operation's
    // OWN chain", so the wallet sits on the target; the invest case is "the money is on the WRONG
    // network", so it must not.
    currentChainId: op === "invest" ? offTargetChainId(targetChainId) : targetChainId,
  };
}

/**
 * Real-mode input, assembled from the live gate context ([R1]-[R4]).
 *
 * PP-INTEGRATION-POINT: `ctx.context` is the live read (`buildProvisioningGateContext`,
 * PP-CORE-LIB-057) of the wallet's multi-chain holdings and Uniswap's per-chain gas, reached through
 * `getProvisioningContextAction`. Everything below is pure assembly over it.
 *
 * The legacy scalar pair is deliberately left unset: `balancesByChain` is the authority, and
 * populating both would leave two descriptions of the same wallet that can disagree.
 */
export function realProvisioningInput(
  op: ProvisioningOp,
  ctx: ProvisioningInputContext,
): ProvisioningNeedInput {
  const { context, amount, slippagePct, targetUsdcBalanceUsd, targetChainId: hostChainId } = ctx;
  // [R6] Fail safe. No context is "we could not read the wallet", never "the wallet is empty".
  if (!context) return { ...NON_TRIGGERING_INPUT };

  const opRequiredUsdc = USDC_SPENDING_OPS.has(op) && amount && amount > 0 ? amount : 0;

  const balancesByChain = spendableBalancesByChain(context.balancesByChain, context.sources);
  // POO-1749 [R1]-[R4]: the host's own on-chain USDC read floors the TARGET chain's token value. The
  // projection above can silently lose on-target USDC when the backend inventory drops a row it
  // failed to serialize (POO-1750: any ~$10k+ stable balance rendered in scientific notation and
  // rejected by the base-unit parse), and the gate must never read the wallet as holding less than
  // the figure the host surface has directly verified and is already gating its CTA on.
  //
  // The floor keys on `context.targetChainId` because that is the key the map is built under, but it
  // only applies when that echo AGREES with the chain the host actually read (`hostChainId`, the same
  // fact the hook resolved for its live read). This PR exists because two pipes disagreed about a
  // wallet; trusting a third pipe's chain key unchecked would let a drifted echo credit one chain's
  // verified USDC to another — the exact [R2] violation.
  //
  // Known residual (recorded on POO-1750): the floored map also feeds the panel's `gasFundingSource`
  // choice, so in the narrow case of a dropped row PLUS a genuine gas shortfall the gas-only screen
  // can offer the USDC-for-gas presets against a `sources` list that lost the row. The wallet DOES
  // hold that USDC (the host verified it on-chain), so the offer is truthful about the wallet even
  // when the plan's own server-side re-read may still disagree with it.
  if (
    typeof targetUsdcBalanceUsd === "number" &&
    Number.isFinite(targetUsdcBalanceUsd) &&
    targetUsdcBalanceUsd > 0 &&
    (hostChainId === undefined || hostChainId === context.targetChainId)
  ) {
    const target = balancesByChain[context.targetChainId] ?? { nativeUsd: 0, tokenUsd: 0 };
    if (targetUsdcBalanceUsd > target.tokenUsd) {
      balancesByChain[context.targetChainId] = { ...target, tokenUsd: targetUsdcBalanceUsd };
    }
  }

  return {
    // [R1] Where the money is, chain by chain, and since POO-1149 what part of it can actually FUND
    // this operation: native RAW, tokens ROUTABLE only. The projection moved to `computeNeed.ts` in
    // POO-1559, when the swap screen needed the same rule; the reasoning, and the production numbers
    // it was reported on, live in {@link spendableBalancesByChain}. An operation may spend the WHOLE
    // routable inventory, so the whole of it is passed here.
    balancesByChain,
    // The legacy field, kept only because the contract still requires it. With `balancesByChain`
    // present the calculator never reads it; pointing it at the target chain is the honest value
    // for "the chain this operation is about".
    currentChainId: context.targetChainId,
    // [R2] The operation's own chain, from the operation.
    targetChainId: context.targetChainId,
    // [R3] Only a USDC-spending operation asks the wallet for USDC.
    opRequiredUsdc,
    // [R4] Quoted, never a constant.
    gasEstimateUsd: context.gasEstimateUsd,
    ...(slippagePct === undefined ? {} : { slippagePct }),
  };
}

/**
 * Assemble the gate input for `op`: the mock demo scenario in mock mode, the live assembly otherwise.
 *
 * The mock branch ignores the context entirely (there is none in mock mode), so flipping the toggle
 * changes which of the two runs and nothing else about the six modals.
 */
export function buildProvisioningInput(
  op: ProvisioningOp,
  ctx: ProvisioningInputContext,
): ProvisioningNeedInput {
  return isMockMode
    ? mockProvisioningInput(op, ctx.amount, ctx.targetChainId)
    : realProvisioningInput(op, ctx);
}
