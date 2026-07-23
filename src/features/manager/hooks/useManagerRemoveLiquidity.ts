/**
 * @id PP-MGR-MOD (POO-312)
 * @name useManagerRemoveLiquidity
 * @implements-rules-version v1
 *
 * Client executor for the manager remove-liquidity / close action, exposed as ordered {@link FlowStep}s
 * ({@link ManagerRemoveExecutor.buildSteps}) for the multistep wallet-sign modal (FU-001), and a
 * one-shot `execute` (a thin runner over the same steps). The build step resolves the percentage to a
 * partial remove or a full close ({@link planRemoval}: >50% or dust → close) and builds the matching tx
 * server-side (remove-liquidity-tx vs close-pool-tx); the confirm step signs + sends. No approve/permit
 * — the liquidity is already on-chain. Mock-safe like the other operation hooks. `execute` resolves with
 * the mined hash + whether the position was closed (the modal derives `closed` from its own plan).
 *
 * POO-475: the build actions now return typed data ({ ok: true, tx } | { ok: false, code, message }).
 * The build step rethrows a failure as `TransactionError(message, { code })` so the backend code lands
 * on `error.cause.code` and `classifyTxError` classifies it in production (e.g. SLIPPAGE_EXCEEDED).
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import type { FlowStep } from "@/features/strategies/hooks/useWalletSignFlow";
import { buildRemoveLiquidityTxAction } from "@/features/strategies/operations/withdrawActions";
import { useAuth } from "@/lib/auth/useAuth";
import { networkToChainId } from "@/lib/chains/config";
import { isMockMode } from "@/lib/services";
import { recordLiquidityEvent } from "@/lib/strategies/v2/recordLiquidityEvent";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import {
  type Eip1193Provider,
  executeBuiltTransaction,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import { planRemoval } from "../lib/removalPlan";
import { buildClosePoolTxAction } from "../operations/closePoolAction";

/** Input for one manager remove run. */
export interface ManagerRemoveRunInput {
  network: string;
  positionId: string;
  /** Chosen removal percentage (1–100). */
  percentage: number;
  /** The manager's stake in USD (drives the dust → close promotion). */
  stakeUsd: number;
  /** Collect the removed liquidity as USDC vs the token pair. POO-804 R1 (decision #12): the
   * manager remove family is pair-only, so the only caller (RemoveLiquidityModal) always passes
   * `false`; the flag stays on this seam because the partial build API still accepts
   * `shouldSwapFees`. A close never swapped anyway (POO-509). */
  collectAsUsdc: boolean;
  slippageTolerance?: number;
}

/** Accumulating context threaded across the manager remove/close steps. */
export interface ManagerRemoveCtx {
  provider?: Eip1193Provider;
  owner?: string;
  built?: BuiltTx;
  /** The position's chain, asserted again at broadcast time (POO-824). */
  chainId?: number;
  /** Whether the plan resolved to a full close (vs a partial remove). */
  closed?: boolean;
}

/** Runs the manager remove/close: ordered steps for the modal, or a one-shot execute. */
export interface ManagerRemoveExecutor {
  /** The ordered wallet-sign steps (build → send) for the runner. */
  buildSteps(input: ManagerRemoveRunInput): FlowStep<ManagerRemoveCtx>[];
  /** One-shot run over the same steps, resolving with the hash + whether it closed the position. */
  execute(input: ManagerRemoveRunInput): Promise<{ hash: string; closed: boolean }>;
}

/** Returns the manager remove-liquidity executor (real on-chain in real mode). */
export function useManagerRemoveLiquidity(): ManagerRemoveExecutor {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo<ManagerRemoveExecutor>(
      () => ({
        buildSteps: () => [],
        execute: async () => {
          throw new TransactionError("Remove liquidity is mocked in mock mode");
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
  return useMemo<ManagerRemoveExecutor>(() => {
    function buildSteps(input: ManagerRemoveRunInput): FlowStep<ManagerRemoveCtx>[] {
      // PP-ANALYTICS: per-step (build / send) breadcrumbs land here with POO-156.
      return [
        {
          // Resolve the plan (partial vs close) and build the matching tx server-side.
          key: "build",
          run: async () => {
            const plan = planRemoval(input.percentage, input.stakeUsd);
            const result = plan.closing
              ? // POO-509: no swapAllToStableCurrency — the action hard-closes to the token pair
                // (close-as-USDC is disabled). collectAsUsdc only drives the partial-remove path below.
                await buildClosePoolTxAction({
                  network: input.network,
                  positionId: input.positionId,
                  slippageTolerance: input.slippageTolerance,
                })
              : await buildRemoveLiquidityTxAction({
                  network: input.network,
                  positionId: input.positionId,
                  percentage: plan.percentage,
                  slippageTolerance: input.slippageTolerance,
                  shouldSwapFees: input.collectAsUsdc,
                });
            // POO-475 [R3]: rethrow a typed failure with the code on `cause.code` for classification.
            if (!result.ok) throw new TransactionError(result.message, { code: result.code });
            const built = result.tx;
            // POO-892 [R5]: wallets[0] can be the stale handle after a wallet switch.
            const wallet = findWalletForAddress(wallets, activeAddress);
            if (!wallet) throw new TransactionError("Wallet not connected");
            // Switch the wallet to the position's chain before sending, else the tx is sent on
            // the wallet's current chain (the Arbitrum default), not the position's network
            // (POO-824 R2, mirrors POO-350).
            const chainId = networkToChainId(input.network);
            if (!chainId) throw new TransactionError(`Unsupported network: ${input.network}`);
            await wallet.switchChain(chainId);
            const provider = await wallet.getEthereumProvider();
            return { provider, owner: wallet.address, built, chainId, closed: plan.closing };
          },
        },
        {
          // Sign + send the built tx and wait for the receipt.
          key: "confirm:removeLiquidity",
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
            // POO-719 rules-v2 [R4v2/R11]: ledger this confirmed manager remove — or, when the
            // plan closed the pool, the close (the API decodes PositionClosed and writes the
            // synthetic manager-zeroing row). Fire-and-forget — the helper swallows every failure
            // (POO-822 reconciles), so the operation's success is NEVER gated on it.
            void recordLiquidityEvent({
              strategyRef: input.positionId,
              txHash: hash,
              network: input.network,
            });
            return { txHash: hash };
          },
        },
      ];
    }

    return {
      buildSteps,
      execute: async (input) => {
        let ctx: ManagerRemoveCtx = {};
        let hash = "";
        for (const step of buildSteps(input)) {
          const result = (await step.run(ctx)) ?? {};
          const { txHash, skipped: _skipped, ...partial } = result;
          ctx = { ...ctx, ...partial };
          if (txHash) hash = txHash;
        }
        return { hash, closed: ctx.closed ?? false };
      },
    };
  }, [wallets, activeAddress]);
}
