/**
 * @id PP-STR-LIB-004 (POO-419)
 * @name buildProvisioningInput
 * @implements-rules-version v1
 *
 * The shared bridge from an op modal to the pre-flight provisioning gate (epic POO-411, POO-419).
 * Every op modal (invest / withdraw / collect / compound / move-range / close) calls
 * {@link buildProvisioningInput} at its confirm CTA to assemble the {@link ProvisioningNeedInput}
 * that {@link computeProvisioningNeed} + the planner consume, then embeds {@link ProvisioningPanel}
 * when `needed`. Keeping the assembly here (not per modal) means the mock demo matrix and the real
 * wiring seam live in ONE place for all six ops.
 *
 * Mock mode fabricates a short-balance scenario per op so the gate is demoable end-to-end:
 *   - invest → the worst case (buy USDC → bridge → swap gas → op), i.e. the "multi" wizard branch
 *   - withdraw / collect / compound / move-range / close spend no USDC, so they route to the simpler
 *     "gas-only" branch (one swap-gas step).
 * Real mode returns a non-triggering input so the gate never shows and today's real behavior is
 * unchanged — the real balance reads are wired later (see the PP-INTEGRATION-POINT below).
 */

import type { ProvisioningNeedInput } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { Strategy } from "@/lib/schemas";
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

/**
 * A wallet that already meets every requirement → {@link computeProvisioningNeed} returns
 * `needed: false`. Used by the real-mode stub so the gate stays invisible until POO-432. Deliberately
 * independent of the op amount (a large invest must NOT trip it) — `opRequiredUsdc: 0` keeps it inert.
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
 * PP-INTEGRATION-POINT: real mode assembles this from live balances instead (POO-432).
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
 * Real-mode input. No balance readers exist yet, so this returns a non-triggering input — the gate
 * never shows in real mode and the op signs directly, exactly as today.
 * PP-INTEGRATION-POINT (POO-432): read the native + USDC balances, convert to USD (native USD price
 * is a gap — CoinGecko is logo-only today), take the op's target chain from the strategy, and set
 * `opRequiredUsdc` from `amount` for invest. The shape does not change; only these values do.
 */
export function realProvisioningInput(
  _op: ProvisioningOp,
  _strategy?: Strategy,
  _amount?: number,
): ProvisioningNeedInput {
  return { ...NON_TRIGGERING_INPUT };
}

/**
 * Assemble the gate input for `op`: the mock demo scenario in mock mode, the real reads otherwise.
 * `strategy` is optional op context for the future real path (POO-432); the mock + the real stub both
 * ignore it today, so gas-only manager ops (move-range / close) may omit it.
 */
export function buildProvisioningInput(
  op: ProvisioningOp,
  strategy?: Strategy,
  amount?: number,
): ProvisioningNeedInput {
  return isMockMode
    ? mockProvisioningInput(op, amount)
    : realProvisioningInput(op, strategy, amount);
}
