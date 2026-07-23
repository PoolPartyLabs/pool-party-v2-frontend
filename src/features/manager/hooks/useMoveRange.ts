/**
 * @id PP-MGR-MOD-001 (POO-310, POO-437)
 * @name useMoveRange
 * @implements-rules-version v3 (POO-900 rules v1)
 *
 * POO-900 (rules v1, R3/R9): the build step rejects a range narrower than MIN_RANGE_SPACINGS
 * usable-tick spacings client-side (parity with the create-pool backstop, createPoolTicks) - this was
 * the only build path that could still mint a degenerate 1-spacing band on-chain (the old guard
 * rejected only inverted/equal ticks). The bound ticks are RECOVERED by rounding
 * (priceToNearestUsableTick, the resolver the modal's gate measures with): the incoming prices are
 * the modal's canonical bounds - floor-snapped to exact tick prices at input time, then
 * display-round-tripped - so rounding recovers exactly the gated ticks, while the POO-319 floor read
 * a display-rounded bound one tick low on spacing-1 pools and made this backstop reject the
 * UI-blessed exactly-2-spacing minimum.
 *
 * Client executor for the on-chain move-range (rebalance), exposed as ordered {@link FlowStep}s
 * ({@link MoveRangeExecutor.buildSteps}) for the multistep wallet-sign modal (FU-001), and a one-shot
 * `execute` (a thin runner over the same steps). The build step converts the manager's new min/max
 * price to usable ticks (POO-282) and orchestrates the build server-side, then the confirm step signs
 * + sends the built tx. No approve/permit — the tokens are already in the position. Mock-safe.
 *
 * The build orchestration is network-aware (POO-437, [R1]): current networks (Polygon) optimize →
 * route → build; legacy networks (Arbitrum/Base) have no swap-optimization step, so they size the
 * rebalance swap directly (`computeLegacyMoveRangeSwapAction`) and build with the simpler body.
 * Running the current path on a legacy network reverts the on-chain simulation ("Path too short").
 *
 * POO-475: the two build actions now return typed data ({ ok: true, tx } | { ok: false, code,
 * message }). The build step rethrows a failure as `TransactionError(message, { code })` so the
 * backend code lands on `error.cause.code` and `classifyTxError` classifies it in production.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import type { FlowStep } from "@/features/strategies/hooks/useWalletSignFlow";
import { useAuth } from "@/lib/auth/useAuth";
import { isLegacyNetwork, networkToChainId } from "@/lib/chains/config";
import { fullRangeTicks } from "@/lib/manager/fullRangeTicks";
import { MIN_RANGE_SPACINGS, priceToNearestUsableTick, tickSpacing } from "@/lib/manager/tickPrice";
import { isMockMode } from "@/lib/services";
import type { BuildTxResult } from "@/lib/tx/actionResult";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import {
  type Eip1193Provider,
  executeBuiltTransaction,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import {
  buildMoveRangeTxAction,
  buildMoveRangeTxLegacyAction,
  computeLegacyMoveRangeSwapAction,
  getMoveRangeRoutingAction,
  optimizeMoveRangeAction,
} from "../operations/moveRangeActions";

/** The (network, position, range, slippage) key shared by every move-range server action. */
interface MoveRangeKey {
  network: string;
  positionId: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  slippageTolerance: number;
}

/**
 * Guard a degenerate 0/0 rebalance as a hard error (POO-319) rather than building a no-op — shared by
 * the current optimizer and the legacy swap sizing.
 */
function assertRebalances(swapZeroForOne: string, swapOneForZero: string): void {
  if (swapZeroForOne === "0" && swapOneForZero === "0") {
    throw new TransactionError("No rebalance is possible for this range. Try a different one.");
  }
}

/** Current (Polygon) build: optimize the swap, complete the routing, then build the tx (POO-475). */
async function buildCurrentMoveRange(key: MoveRangeKey): Promise<BuildTxResult> {
  const optimized = await optimizeMoveRangeAction(key);
  if (!optimized) throw new TransactionError("Move-range optimization returned no result");
  assertRebalances(optimized.swapZeroForOneAmount, optimized.swapOneForZeroAmount);
  const routing = await getMoveRangeRoutingAction({
    ...key,
    swapZeroForOneAmount: optimized.swapZeroForOneAmount,
    swapOneForZeroAmount: optimized.swapOneForZeroAmount,
  });
  if (!routing) throw new TransactionError("Move-range routing returned no result");
  return buildMoveRangeTxAction({
    network: key.network,
    positionId: key.positionId,
    tickLower: key.tickLower,
    tickUpper: key.tickUpper,
    slippageTolerance: key.slippageTolerance,
    mintSlippageTolerance: key.slippageTolerance,
    routing,
  });
}

/** Legacy (Arbitrum/Base) build: size the swap from the position + new range, then build (POO-475). */
async function buildLegacyMoveRange(key: MoveRangeKey): Promise<BuildTxResult> {
  const swap = await computeLegacyMoveRangeSwapAction(key);
  if (!swap) throw new TransactionError("Move-range swap sizing returned no result");
  assertRebalances(swap.swapZeroForOneAmount, swap.swapOneForZeroAmount);
  return buildMoveRangeTxLegacyAction({ ...key, ...swap });
}

/** Input for one move-range run. Prices are token1 per 1 token0 (the modal's inputs). */
export interface MoveRangeRunInput {
  network: string;
  positionId: `0x${string}`;
  feeBps: number;
  decimals0: number;
  decimals1: number;
  /** New lower bound (token1 per token0). Omitted for a full-range move (POO-394). */
  minPrice?: number;
  /** New upper bound (token1 per token0). Omitted for a full-range move (POO-394). */
  maxPrice?: number;
  /**
   * Full-range move (POO-394): rebalance to the widest usable ticks instead of the entered bounds.
   * When set, `minPrice`/`maxPrice` are ignored and the ticks come from {@link fullRangeTicks}.
   */
  fullRange?: boolean;
  slippagePct: number;
}

/** Accumulating context threaded across the move-range steps. */
export interface MoveRangeCtx {
  provider?: Eip1193Provider;
  owner?: `0x${string}`;
  built?: BuiltTx;
  /** The position's chain, asserted again at broadcast time (POO-824). */
  chainId?: number;
}

/** Runs move-range: ordered steps for the modal, or a one-shot execute. */
export interface MoveRangeExecutor {
  /** The ordered wallet-sign steps (build orchestration → send) for the runner. */
  buildSteps(input: MoveRangeRunInput): FlowStep<MoveRangeCtx>[];
  /** One-shot run over the same steps, resolving with the mined transaction hash. */
  execute(input: MoveRangeRunInput): Promise<{ hash: string }>;
}

/** Returns the move-range executor (real on-chain in real mode). */
export function useMoveRange(): MoveRangeExecutor {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo<MoveRangeExecutor>(
      () => ({
        buildSteps: () => [],
        execute: async () => {
          throw new TransactionError("Move range is mocked in mock mode");
        },
      }),
      [],
    );
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { wallets } = useWallets();
  // POO-892 [R5]: the active address drives the address-matched wallet lookup below.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address: activeAddress } = useAuth();

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  return useMemo<MoveRangeExecutor>(() => {
    function buildSteps(input: MoveRangeRunInput): FlowStep<MoveRangeCtx>[] {
      // PP-ANALYTICS: per-step (build / send) breadcrumbs land here with POO-156.
      return [
        {
          // Pre-flight (chain switch + provider) + price→ticks + optimize → routing → build, server-
          // side. One logical step: the manager sees "building" until the tx is ready to sign.
          key: "build",
          run: async () => {
            const chainId = networkToChainId(input.network);
            if (!chainId) throw new TransactionError(`Unsupported network: ${input.network}`);
            // POO-892 [R5]: wallets[0] can be the stale handle after a wallet switch.
            const wallet = findWalletForAddress(wallets, activeAddress);
            if (!wallet) throw new TransactionError("Wallet not connected");
            const owner = wallet.address as `0x${string}`;
            // Switch to the position's chain before signing/sending, else the wallet rejects with
            // "chainId should be same as current chainId" (-32602).
            await wallet.switchChain(chainId);
            const provider = await wallet.getEthereumProvider();

            // 1. Resolve the target ticks. Full-range (POO-394) uses the widest usable ticks aligned
            //    to the fee tier; otherwise RECOVER the ticks of the entered min/max prices by
            //    rounding (POO-900 R3) - the modal's bounds are display-round-tripped exact tick
            //    prices (the typed-price floor already ran at input time), so this resolves the same
            //    ticks the modal's width gate accepted.
            let tickLower: number;
            let tickUpper: number;
            if (input.fullRange) {
              ({ tickLower, tickUpper } = fullRangeTicks(input.feeBps));
            } else {
              if (input.minPrice == null || input.maxPrice == null) {
                throw new TransactionError("Move range needs a price range");
              }
              tickLower = priceToNearestUsableTick(
                input.minPrice,
                input.decimals0,
                input.decimals1,
                input.feeBps,
              );
              tickUpper = priceToNearestUsableTick(
                input.maxPrice,
                input.decimals0,
                input.decimals1,
                input.feeBps,
              );
            }
            // POO-900 R9: reject a below-minimum width (subsumes the old inverted/equal check) -
            // parity with the create-pool backstop (createPoolTicks), so a move-range build can
            // never mint a degenerate band narrower than MIN_RANGE_SPACINGS spacings on-chain.
            if (tickUpper - tickLower < MIN_RANGE_SPACINGS * tickSpacing(input.feeBps)) {
              throw new TransactionError("Range too narrow for this pool's tick spacing");
            }

            const key = {
              network: input.network,
              positionId: input.positionId,
              tickLower,
              tickUpper,
              slippageTolerance: input.slippagePct,
            };

            // 2. Size + build the tx, server-side. Legacy networks (Arbitrum/Base) have no
            //    swap-optimization step (running it reverts on-chain), so they size the swap directly
            //    and build with the simpler body; current networks (Polygon) optimize + route first
            //    (POO-437, [R1]). Both dispatch to the right backend build internally.
            const result = isLegacyNetwork(input.network)
              ? await buildLegacyMoveRange(key)
              : await buildCurrentMoveRange(key);
            // POO-475 [R3]: rethrow a typed failure with the code on `cause.code` for classification.
            if (!result.ok) throw new TransactionError(result.message, { code: result.code });
            return { provider, owner, built: result.tx, chainId };
          },
        },
        {
          // Sign + send the built tx and wait for the receipt.
          key: "confirm:moveRange",
          run: async (ctx) => {
            if (!ctx.provider || !ctx.built || !ctx.owner || !ctx.chainId) {
              throw new TransactionError("Transaction was not built");
            }
            const hash = await executeBuiltTransaction(
              ctx.provider,
              ctx.built,
              ctx.owner,
              ctx.chainId,
            );
            return { txHash: hash };
          },
        },
      ];
    }

    return {
      buildSteps,
      execute: async (input) => {
        let ctx: MoveRangeCtx = {};
        let hash = "";
        for (const step of buildSteps(input)) {
          const result = (await step.run(ctx)) ?? {};
          const { txHash, skipped: _skipped, ...partial } = result;
          ctx = { ...ctx, ...partial };
          if (txHash) hash = txHash;
        }
        return { hash };
      },
    };
  }, [wallets, activeAddress]);
}
