/**
 * @id PP-STR-MOD-004 (POO-302)
 * @name useWithdraw
 * @implements-rules-version v2 (POO-847 rules v1)
 *
 * Client executor for the real withdraw operation, exposed as ordered {@link FlowStep}s
 * ({@link WithdrawExecutor.buildSteps}) for the wallet-sign modal (FU-001), and a one-shot `execute`
 * (a thin runner over the same steps). Routes by amount: a partial withdraw removes a percentage of
 * liquidity; a full amount or a closed (already-unwound) position does a full exit. Builds the tx
 * server-side, then signs + sends through the Privy wallet and waits for the receipt. There is no
 * client Permit2/approve step — the position's liquidity is already on-chain. Mock-safe like the other
 * operation hooks.
 *
 * POO-847 R4 (Murilo 2026-07-11): a MANAGER's exit that promotes to a close CLOSES the pool — the
 * mobile investor surface routes owned positions through this hook (the managed view is
 * desktop-only), and `withdraw-tx` is not the manager exit, so an OWNED removal that is a full exit
 * OR promotes to a close (> 50% or a dust remainder, mirroring desktop POO-312 via the SHARED
 * `ownedRemovalClosesPool` predicate) routes to `close-pool-tx` (pair-only by product rule,
 * POO-509/POO-804 — no `shouldSwapFees` rides along). An owned removal at/under 50% (non-dust) keeps
 * the investor percentage route; a CLOSED owned position is a post-close claim (withdraw-tx).
 *
 * POO-475: the build actions now return typed data ({ ok: true, tx } | { ok: false, code, message }).
 * The build step rethrows a failure as `TransactionError(message, { code })` so the backend code lands
 * on `error.cause.code` and `classifyTxError` classifies it in production (e.g. SLIPPAGE_EXCEEDED).
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import { ownedRemovalClosesPool } from "@/features/manager/lib/removalPlan";
import { buildClosePoolTxAction } from "@/features/manager/operations/closePoolAction";
import { useAuth } from "@/lib/auth/useAuth";
import { isLegacyNetwork, networkToChainId } from "@/lib/chains/config";
import type { Position, Strategy } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { recordLiquidityEvent } from "@/lib/strategies/v2/recordLiquidityEvent";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import type { ReceivedLegsResult } from "@/lib/tx/receivedAmounts";
import {
  executeBuiltTransactionWithLogs,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import { buildRemoveLiquidityTxAction, buildWithdrawTxAction } from "../operations/withdrawActions";
import { decodeReceipt } from "./receiptDecode";
import type { FlowStep } from "./useWalletSignFlow";

/** Accumulating context threaded across the withdraw steps. */
export interface WithdrawCtx {
  built?: BuiltTx;
  /**
   * POO-810 R6: the decoded receipt amounts — the REAL per-token amounts received (USDC leg as USD),
   * threaded from the confirm step. Null when logs were unavailable / nothing decoded, so the modal
   * falls back to the pre-broadcast "Total received" figure (R9). Threaded via the flow context.
   */
  decoded?: ReceivedLegsResult | null;
}

/** Runs the withdraw operation: ordered steps for the modal, or a one-shot execute. */
export interface WithdrawExecutor {
  /**
   * The ordered wallet-sign steps (server build → send) for {@link useWalletSignFlow}.
   * `receiveAsPair` carries the gear's receive-as choice (POO-481 R4): true = keep the pool token
   * pair (`shouldSwapFees: false`); omitted/false = swap to USDC (the default).
   */
  buildSteps(
    strategy: Strategy,
    position: Position,
    amountUsd: number,
    slippageTolerance?: number,
    receiveAsPair?: boolean,
  ): FlowStep<WithdrawCtx>[];
  /** One-shot run over the same steps, resolving with the mined transaction hash. */
  execute(
    strategy: Strategy,
    position: Position,
    amountUsd: number,
    slippageTolerance?: number,
    receiveAsPair?: boolean,
  ): Promise<{ hash: string }>;
}

/** Convert a withdraw amount to a 1–100 liquidity percentage of the position. */
function toPercentage(amountUsd: number, currentValue: number): number {
  if (currentValue <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round((amountUsd / currentValue) * 100)));
}

/** Returns the withdraw executor (real on-chain in real mode). */
export function useWithdraw(): WithdrawExecutor {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo<WithdrawExecutor>(
      () => ({
        buildSteps: () => [],
        execute: async () => {
          throw new TransactionError("Withdraw is mocked in mock mode");
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
  return useMemo<WithdrawExecutor>(() => {
    function buildSteps(
      strategy: Strategy,
      position: Position,
      amountUsd: number,
      slippageTolerance?: number,
      receiveAsPair?: boolean,
    ): FlowStep<WithdrawCtx>[] {
      // PP-ANALYTICS: per-step (build / send) breadcrumbs + partial-vs-full land here with POO-156.
      return [
        {
          // Route full vs partial and build the tx server-side (computes the gas estimate).
          key: "build",
          run: async () => {
            if (!strategy.network) {
              throw new TransactionError("This strategy has no network configured");
            }
            // Closed positions are already unwound; treat near-full amounts as a full exit.
            const isFull =
              position.status === "closed" || amountUsd >= position.currentValue - 1e-6;
            // POO-847 R4 (Murilo 2026-07-11): an OWNED (isPoolManager) ACTIVE removal that is a full
            // exit OR promotes to a close (> 50% or a dust remainder, via the SHARED desktop POO-312
            // predicate `ownedRemovalClosesPool` — never a divergent 50% here) CLOSES the pool, never
            // withdraw-tx. The close build is pair-only (POO-509/POO-804), so the receive-as choice
            // does not ride along. An already-CLOSED owned position is a post-close CLAIM and keeps
            // withdraw-tx (you cannot close a closed pool).
            const ownedClosing =
              position.isPoolManager === true &&
              position.status !== "closed" &&
              (isFull || ownedRemovalClosesPool(amountUsd, position.currentValue));
            const result = ownedClosing
              ? await buildClosePoolTxAction({
                  network: strategy.network,
                  positionId: position.id,
                  slippageTolerance,
                })
              : isFull
                ? await buildWithdrawTxAction({
                    positionId: position.id,
                    network: strategy.network,
                    slippageTolerance,
                    // POO-481 R4: the gear's receive-as choice; omitted = swap to USDC.
                    shouldSwapFees: !receiveAsPair,
                  })
                : await buildRemoveLiquidityTxAction({
                    positionId: position.id,
                    network: strategy.network,
                    percentage: toPercentage(amountUsd, position.currentValue),
                    slippageTolerance,
                    // POO-481 R4: the gear's receive-as choice; omitted = swap to USDC.
                    shouldSwapFees: !receiveAsPair,
                    // Universal Router only on current networks; legacy omits it (POO-316).
                    poolPartyPositionAddress: isLegacyNetwork(strategy.network)
                      ? undefined
                      : strategy.pool,
                  });
            // POO-475 [R3]: rethrow a typed failure with the code on `cause.code` for classification.
            if (!result.ok) throw new TransactionError(result.message, { code: result.code });
            return { built: result.tx };
          },
        },
        {
          // Sign + send the built tx and wait for the receipt.
          key: "confirm:withdraw",
          run: async (ctx) => {
            if (!ctx.built) throw new TransactionError("Transaction was not built");
            // POO-892 [R5]: wallets[0] can be the stale handle after a wallet switch.
            const wallet = findWalletForAddress(wallets, activeAddress);
            if (!wallet) throw new TransactionError("Wallet not connected");
            // Switch the wallet to the position's chain before sending, else the tx is sent on the
            // wallet's current chain (the Arbitrum default), not the strategy's network (POO-350).
            const chainId = strategy.network ? networkToChainId(strategy.network) : undefined;
            if (!chainId) throw new TransactionError(`Unsupported network: ${strategy.network}`);
            await wallet.switchChain(chainId);
            const provider = await wallet.getEthereumProvider();
            // POO-810 R1/R6: send with the receipt logs so a single confirmed tx feeds BOTH the
            // decode (the REAL per-token amounts received, USDC leg as USD, not the pre-broadcast
            // estimate) AND the POO-719 cost-basis ledger below (which only needs the tx hash).
            // POO-824 [R1]: chainId is the broadcast-time chain assertion target.
            const { hash, logs } = await executeBuiltTransactionWithLogs(
              provider,
              ctx.built,
              wallet.address,
              chainId,
            );
            // POO-719 rules-v2 [R4v2]: ledger this confirmed remove/withdraw (post-close claims
            // included) into the cost-basis ledger. Fire-and-forget — the helper swallows every
            // failure (POO-822 reconciles), so the withdraw's success is NEVER gated on it.
            if (strategy.network) {
              void recordLiquidityEvent({
                strategyRef: position.id,
                txHash: hash,
                network: strategy.network,
              });
            }
            const decoded = await decodeReceipt({
              logs,
              wallet: wallet.address as `0x${string}`,
              chainId,
              position,
            });
            return { txHash: hash, decoded };
          },
        },
      ];
    }

    return {
      buildSteps,
      execute: async (strategy, position, amountUsd, slippageTolerance, receiveAsPair) => {
        let ctx: WithdrawCtx = {};
        let hash = "";
        for (const step of buildSteps(
          strategy,
          position,
          amountUsd,
          slippageTolerance,
          receiveAsPair,
        )) {
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
