/**
 * @id PP-STR-MOD-003 (POO-301)
 * @name useCollectFees
 * @implements-rules-version v2 (POO-802 rules v1)
 *
 * Client executor for the real collect-fees operation: build the tx server-side
 * (buildCollectFeesTxAction), then sign + send it through the connected Privy wallet and wait
 * for the receipt. Mock-safe like useAccountService: in mock mode it returns an executor that
 * throws if called (the modal uses the mock settle path instead).
 *
 * POO-475: the build action now returns typed data ({ ok: true, tx } | { ok: false, code, message }).
 * The executor rethrows a failure as `TransactionError(message, { code })` so the backend code lands
 * on `error.cause.code` and `classifyTxError` classifies it in production (e.g. SLIPPAGE_EXCEEDED).
 *
 * POO-802 R0 (0710 overhaul): `buildSteps` splits the fold into the handshake steps — the `build`
 * step calls the server action and sets `ctx.built` (the flow pauses there, so the Review reads the
 * REAL gas + swapInfo instead of the mock walk), and `confirm:collect` only signs + sends the
 * already-built tx. Mirrors useWithdraw.buildSteps / useInvest.
 *
 * POO-810 R1/R5: the `confirm:collect` step sends via `executeBuiltTransactionWithLogs`, decodes the
 * mined receipt, and carries the REAL per-token amounts received (USDC leg as USD) on `ctx.decoded`
 * so the receipt reads them from `flow.context`. Null when logs are unavailable / nothing decoded, so
 * the modal falls back to the pre-execute claimable figure (R9). There is NO liquidity-event ledger
 * callback here — POO-719 R8: collect never records a liquidity event.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { isLegacyNetwork, networkToChainId } from "@/lib/chains/config";
import type { Position, Strategy } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import type { ReceivedLegsResult } from "@/lib/tx/receivedAmounts";
import {
  executeBuiltTransactionWithLogs,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import { buildCollectFeesTxAction } from "../operations/collectFeesAction";
import { decodeReceipt } from "./receiptDecode";
import type { FlowStep } from "./useWalletSignFlow";

/** The accumulated collect-flow context (POO-615/POO-802): the built tx + its display figures. */
export interface CollectCtx {
  built?: BuiltTx;
  /**
   * POO-810 R5: the real per-token amounts decoded from the mined receipt (USDC leg as USD),
   * threaded from the confirm step. Null when logs are unavailable / nothing decoded, so the modal
   * R9-falls-back to the pre-execute claimable figure. Read by the receipt from `flow.context`.
   */
  decoded?: ReceivedLegsResult | null;
}

/** Runs the collect-fees operation, resolving with the mined transaction hash. */
export interface CollectFeesExecutor {
  /**
   * POO-802 R0: the handshake steps — `build` sets `ctx.built` from the real server build (the
   * flow pauses on the Review with real figures), `confirm:collect` signs + sends and decodes the
   * receipt into `ctx.decoded` (POO-810 R5).
   */
  buildSteps(
    strategy: Strategy,
    position: Position,
    slippageTolerance?: number,
    /** Receive the raw token pair instead of swapping to USDC (POO-417 R2). */
    collectAsTokenPair?: boolean,
  ): FlowStep<CollectCtx>[];
}

/** Returns the collect-fees executor (real on-chain in real mode). */
export function useCollectFees(): CollectFeesExecutor {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo<CollectFeesExecutor>(
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
  return useMemo<CollectFeesExecutor>(() => {
    async function buildTx(
      strategy: Strategy,
      position: Position,
      slippageTolerance?: number,
      collectAsTokenPair?: boolean,
    ): Promise<BuiltTx> {
      // PP-ANALYTICS: instrument the collect operation start/result (strategy id, network) when
      // POO-156 lands.
      if (!strategy.network) {
        throw new TransactionError("This strategy has no network configured");
      }
      const result = await buildCollectFeesTxAction({
        positionId: position.id,
        network: strategy.network,
        slippageTolerance,
        collectAsTokenPair,
        // Universal Router only on current networks; legacy omits it (POO-316).
        poolPartyPositionAddress: isLegacyNetwork(strategy.network) ? undefined : strategy.pool,
      });
      // POO-475 [R3]: rethrow a typed failure with the code on `cause.code` for classification.
      if (!result.ok) throw new TransactionError(result.message, { code: result.code });
      return result.tx;
    }

    // POO-810 R1/R5: send with the receipt logs, then decode the mined receipt into the REAL
    // per-token amounts received (USDC leg as USD). Returns null decoded on any decode miss so the
    // modal R9-falls-back to the pre-execute claimable figure.
    async function sendAndDecode(
      strategy: Strategy,
      position: Position,
      built: BuiltTx,
    ): Promise<{ hash: string; decoded: ReceivedLegsResult | null }> {
      // POO-892 [R5]: wallets[0] can be the stale handle after a wallet switch.
      const wallet = findWalletForAddress(wallets, activeAddress);
      if (!wallet) throw new TransactionError("Wallet not connected");
      // Switch the wallet to the strategy's chain before sending, else the tx is sent on the
      // wallet's current chain (the Arbitrum default), not the position's network (POO-350).
      const chainId = strategy.network ? networkToChainId(strategy.network) : undefined;
      if (!chainId) throw new TransactionError(`Unsupported network: ${strategy.network}`);
      await wallet.switchChain(chainId);
      const provider = await wallet.getEthereumProvider();
      // POO-824 [R1]: chainId is the broadcast-time chain assertion target in the send choke point.
      const { hash, logs } = await executeBuiltTransactionWithLogs(
        provider,
        built,
        wallet.address,
        chainId,
      );
      const decoded = await decodeReceipt({
        logs,
        wallet: wallet.address as `0x${string}`,
        chainId,
        position,
      });
      return { hash, decoded };
    }

    return {
      // POO-802 R0: the handshake split — build pauses on real figures, confirm signs + sends and
      // decodes the receipt (POO-810 R5).
      buildSteps: (strategy, position, slippageTolerance, collectAsTokenPair) => [
        {
          key: "build",
          run: async () => ({
            built: await buildTx(strategy, position, slippageTolerance, collectAsTokenPair),
          }),
        },
        {
          key: "confirm:collect",
          run: async (ctx) => {
            if (!ctx.built) throw new TransactionError("Transaction was not built");
            const { hash, decoded } = await sendAndDecode(strategy, position, ctx.built);
            return { txHash: hash, decoded };
          },
        },
      ],
    };
  }, [wallets, activeAddress]);
}
