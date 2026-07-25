/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name swapRequest
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The pure half of the standalone swap/bridge screen: everything between "the user typed an amount
 * and picked a network" and "the shipped planner is asked a question". Split out for the reason
 * `fundingSelection.ts` and `gasSelection.ts` are: the arithmetic a money CTA gates on should be
 * exhaustively testable without mounting anything.
 *
 * ## The screen asks the planner the SAME question an operation does
 *
 * `buildPlan` (POO-1034) answers exactly one question: *make this much USDC available on this chain*.
 * That is what the six operation modals need, and it is also what this screen needs, so [R3] holds
 * literally rather than by resemblance: there is no second planner, no second sizing model and no
 * second execution path. The screen only decides WHICH chain and HOW MUCH; the route (a same-chain
 * `CLASSIC` swap, a `BRIDGE`, or a swap decomposed into both) is Uniswap's answer, never a branch
 * here ([R2]).
 *
 * Two consequences are worth stating out loud, because they are the honest limits of that reuse:
 *
 *   - **The destination asset is USDC.** `buildPlan` terminates every route on the target chain's
 *     USDC (`getUsdcAddress`), so an arbitrary "to token" is a PLANNER capability, not a screen
 *     one: it would need a third leg class (a target-chain swap out of USDC) and sizing in that
 *     token's own units. USDC is also the unit every Pool Party operation is denominated in, so it
 *     is the useful destination today. Tracked as a follow-up, not faked here with a picker that
 *     offers one option.
 *   - **The amount is a TARGET BALANCE, not a transfer size.** `computePlanAction` sizes the route
 *     against what the destination chain is still missing, so the screen asks "how much do you want
 *     available on X", shows what is already there, and lets the planner move only the difference.
 *     Re-deriving a plan from current holdings is also what makes it safe to re-run at all
 *     (`02_BRIDGE_ARCHITECTURE.md` §3.1), so bending it into "always move exactly N" would have
 *     traded away the epic's recovery model for a nicer sentence.
 *
 * ## Money
 *
 * The amount is a USD figure a person typed, and it stays display-grade: it is rounded to cents on
 * the way in so the number the user approves is the number the screen shows. Nothing here sizes a
 * transaction. The authoritative base-unit amounts are derived server-side by `computePlanAction`
 * and by the planner, from the wallet's own balances.
 */

// Type-only, and therefore erased at compile time: both modules are `server-only` and this one is
// imported by a `"use client"` component. Never turn either into a value import (ADR 0003).
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { getUsdcAddress } from "@/lib/chains/config";
import type { ProvisioningNeedInput } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";

/**
 * PP-MOCK: the USDC the demo wallet holds, off the destination chain, in mock mode.
 *
 * Mock mode has no session, no API key and no wallet read, and it is the repo default. Without a
 * plausible holding the mock planner has nothing to route and the screen is undemoable offline. The
 * figure is only ever fed to `mockComputePlan`; real mode reads the wallet.
 */
export const MOCK_SWAP_WALLET_USDC_USD = 1_000;

/** PP-MOCK: the chain the demo wallet's USDC sits on (Base, the on-ramp chain). */
const MOCK_SWAP_WALLET_CHAIN_ID = 8453;

/** PP-MOCK: a plausible per-transaction gas estimate for the demo. Real mode quotes it. */
const MOCK_SWAP_GAS_ESTIMATE_USD = 0.5;

/** A plain, unsigned decimal figure. `1e3`, `Infinity` and `-5` are all deliberately excluded. */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * The amount the user typed, as a positive USD figure, or `null` when it is not one.
 *
 * Rounded to cents because the screen renders it with `formatUsd`: a requirement carrying more
 * precision than the display would let someone approve a figure that is not the one they can read.
 * `Number.parseFloat` is deliberately not used on its own, since it happily reads `"12abc"` as 12.
 */
export function parseSwapAmountUsd(text: string): number | null {
  const trimmed = text.trim();
  if (!PLAIN_DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100) / 100;
  return cents > 0 ? cents : null;
}

/** Is this holding the given chain's USDC? Address case is not identity (EIP-55 checksums differ). */
function isChainUsdc(source: Pick<FundingSource, "chainId" | "address">, chainId: number): boolean {
  const usdc = getUsdcAddress(chainId);
  return (
    source.chainId === chainId &&
    usdc !== undefined &&
    source.address.toLowerCase() === usdc.toLowerCase()
  );
}

/**
 * USD of the destination chain's USDC the wallet already holds.
 *
 * Shown to the user, so they can see why a $100 target on a chain that already has $25 only moves
 * $75. Read from the inventory rather than from `balancesByChain.tokenUsd`, which counts every
 * routable token on the chain: a WETH holding there is not USDC and still needs a swap.
 * Sub-$1 USDC dust is filtered out of the inventory and therefore under-counted, which errs towards
 * telling the user they have less than they do.
 */
export function usdcAtDestinationUsd(context: ProvisioningGateContext | null): number {
  if (!context) return 0;
  return context.sources
    .filter((source) => isChainUsdc(source, context.targetChainId))
    .reduce((total, source) => total + (Number.isFinite(source.usd) ? source.usd : 0), 0);
}

/**
 * The holdings worth offering as funding for a move to the destination ([R2]).
 *
 * Exactly one thing is dropped: the destination chain's own USDC. Moving USDC to the chain it
 * already sits on is a no-op, and `computePlanAction` has already counted it as held when it sized
 * the requirement, so leaving it selectable would let a user "spend" the same dollars twice and
 * receive a plan that moves less than it says. Every other holding on the destination chain stays:
 * a same-chain swap into USDC is a real route, and it is half of what this screen exists for.
 */
export function swapFundingSources(context: ProvisioningGateContext | null): FundingSource[] {
  if (!context) return [];
  return context.sources.filter((source) => !isChainUsdc(source, context.targetChainId));
}

/** What {@link buildSwapInput} needs. */
export interface SwapInputArgs {
  /** The live wallet read for the destination, or `null` in mock mode / after a degraded read. */
  context: ProvisioningGateContext | null;
  /** The network the user picked. Authoritative over `context.targetChainId`, which may be stale. */
  destinationChainId: number;
  /** How much USDC the user wants available there, USD. */
  amountUsd: number;
  /** Max slippage from the settings gear, percent (POO-523 R2). Rides through to the planner. */
  slippagePct?: number;
}

/**
 * Assemble the {@link ProvisioningNeedInput} for a move, in the shape the shipped planner takes.
 *
 * The destination is the one the USER picked, never `context.targetChainId`: the context is re-read
 * per destination and a request in flight when the choice changes must not be able to plan a route
 * to the old chain. Mirrors `realProvisioningInput` (POO-1042) field for field, minus the six-op
 * vocabulary, which does not apply to a screen that IS the operation.
 */
export function buildSwapInput({
  context,
  destinationChainId,
  amountUsd,
  slippagePct,
}: SwapInputArgs): ProvisioningNeedInput {
  if (!context) {
    // PP-MOCK: a demo wallet holding USDC on Base, so a move to Arbitrum or Polygon plans a bridge
    // and a move to Base plans a same-chain swap for gas. The scalar shape is what the mock
    // fixture speaks (`fixtures/mockPlan.ts`); real mode uses the per-chain map below.
    return {
      nativeBalanceUsd: 0,
      usdcBalanceUsd: MOCK_SWAP_WALLET_USDC_USD,
      currentChainId: MOCK_SWAP_WALLET_CHAIN_ID,
      targetChainId: destinationChainId,
      opRequiredUsdc: amountUsd,
      gasEstimateUsd: MOCK_SWAP_GAS_ESTIMATE_USD,
      ...(slippagePct === undefined ? {} : { slippagePct }),
    };
  }

  return {
    balancesByChain: context.balancesByChain,
    // The legacy scalar field the contract still requires. With `balancesByChain` present the
    // calculator never reads it; the destination is the honest value for "the chain this is about".
    currentChainId: destinationChainId,
    targetChainId: destinationChainId,
    opRequiredUsdc: amountUsd,
    gasEstimateUsd: context.gasEstimateUsd,
    ...(slippagePct === undefined ? {} : { slippagePct }),
  };
}
