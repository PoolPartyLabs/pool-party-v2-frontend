/**
 * @id PP-STR-LIB-004 (POO-419, POO-1042)
 * @name buildProvisioningInput
 * @implements-rules-version v2 (POO-1042 rules v1)
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

import type { ProvisioningNeedInput } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
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
 * PP-MOCK: the demo input per op, built from the canonical {@link SCENARIOS}. invest reuses the
 * worst-case `usdcBridgeGas` (multi), carrying the entered amount as the op's USDC requirement so the
 * plan sizes the on-ramp realistically; every other op spends no USDC and reuses `gasOnly` (the
 * one-step gas-only branch).
 */
export function mockProvisioningInput(op: ProvisioningOp, amount?: number): ProvisioningNeedInput {
  if (op === "invest") {
    return {
      ...SCENARIOS.usdcBridgeGas,
      opRequiredUsdc: amount && amount > 0 ? amount : SCENARIOS.usdcBridgeGas.opRequiredUsdc,
    };
  }
  return { ...SCENARIOS.gasOnly };
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
  const { context, amount, slippagePct } = ctx;
  // [R6] Fail safe. No context is "we could not read the wallet", never "the wallet is empty".
  if (!context) return { ...NON_TRIGGERING_INPUT };

  const opRequiredUsdc = USDC_SPENDING_OPS.has(op) && amount && amount > 0 ? amount : 0;

  return {
    // [R1] Where the money is, chain by chain.
    balancesByChain: context.balancesByChain,
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
  return isMockMode ? mockProvisioningInput(op, ctx.amount) : realProvisioningInput(op, ctx);
}
