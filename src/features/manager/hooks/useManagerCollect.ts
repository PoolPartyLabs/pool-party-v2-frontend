/**
 * @id PP-MGR-SCR-004 (POO-311)
 * @name useManagerCollect
 * @implements-rules-version v2 (POO-802 rules v1)
 *
 * Client executor for the manager's collect-fees action on a managed position. Reuses the shared
 * `buildCollectFeesTxAction` (POO-301) — the manage-detail supplies the positionId + network — then
 * signs + sends via the connected Privy wallet. Mock-safe like the other operation hooks.
 *
 * POO-475: the build action now returns typed data ({ ok: true, tx } | { ok: false, code, message }).
 * The executor rethrows a failure as `TransactionError(message, { code })` so the backend code lands
 * on `error.cause.code` and `classifyTxError` classifies it in production (e.g. SLIPPAGE_EXCEEDED).
 *
 * POO-802 R0 (0710 overhaul): `buildSteps` splits the fold into the handshake steps — `build` sets
 * `ctx.built` from the real server build (the Review pauses on REAL figures), `confirm:collect`
 * only signs + sends. Mirrors useCollectFees.buildSteps.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import type { CollectCtx } from "@/features/strategies/hooks/useCollectFees";
import type { FlowStep } from "@/features/strategies/hooks/useWalletSignFlow";
import { buildCollectFeesTxAction } from "@/features/strategies/operations/collectFeesAction";
import { useAuth } from "@/lib/auth/useAuth";
import { networkToChainId } from "@/lib/chains/config";
import { isMockMode } from "@/lib/services";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import {
  executeBuiltTransaction,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";

/** Input for one manager collect run. */
export interface ManagerCollectRunInput {
  network: string;
  positionId: string;
  slippageTolerance?: number;
  /** Receive the raw token pair instead of swapping to USDC (POO-417 R2). */
  collectAsTokenPair?: boolean;
}

/** Runs the manager collect-fees operation, resolving with the mined transaction hash. */
export interface ManagerCollectExecutor {
  /**
   * POO-802 R0: the handshake steps — `build` sets `ctx.built` from the real server build (the
   * flow pauses on the Review with real figures), `confirm:collect` only signs + sends.
   */
  buildSteps(input: ManagerCollectRunInput): FlowStep<CollectCtx>[];
}

/** Returns the manager collect-fees executor (real on-chain in real mode). */
export function useManagerCollect(): ManagerCollectExecutor {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo<ManagerCollectExecutor>(
      () => ({
        buildSteps: () => [],
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
  return useMemo<ManagerCollectExecutor>(() => {
    async function buildTx(input: ManagerCollectRunInput): Promise<BuiltTx> {
      const result = await buildCollectFeesTxAction({
        positionId: input.positionId,
        network: input.network,
        slippageTolerance: input.slippageTolerance,
        collectAsTokenPair: input.collectAsTokenPair,
      });
      // POO-475 [R3]: rethrow a typed failure with the code on `cause.code` for classification.
      if (!result.ok) throw new TransactionError(result.message, { code: result.code });
      return result.tx;
    }

    async function sendBuilt(built: BuiltTx, network: string): Promise<string> {
      // POO-892 [R5]: wallets[0] can be the stale handle after a wallet switch.
      const wallet = findWalletForAddress(wallets, activeAddress);
      if (!wallet) throw new TransactionError("Wallet not connected");
      // POO-824 R2 (mirrors POO-350): switch to the position's chain before sending, else the tx
      // broadcasts on the wallet's current chain (the Arbitrum default), not the position's network.
      const chainId = networkToChainId(network);
      if (!chainId) throw new TransactionError(`Unsupported network: ${network}`);
      await wallet.switchChain(chainId);
      const provider = await wallet.getEthereumProvider();
      // POO-824 R1: chainId is the broadcast-time chain assertion target in the send choke point.
      return executeBuiltTransaction(provider, built, wallet.address, chainId);
    }

    return {
      // POO-802 R0: the handshake split — build pauses on real figures, confirm only signs + sends.
      buildSteps: (input) => [
        {
          key: "build",
          run: async () => ({ built: await buildTx(input) }),
        },
        {
          key: "confirm:collect",
          run: async (ctx) => {
            if (!ctx.built) throw new TransactionError("Transaction was not built");
            return { txHash: await sendBuilt(ctx.built, input.network) };
          },
        },
      ],
    };
  }, [wallets, activeAddress]);
}
