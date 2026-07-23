/**
 * @id PP-MGR-SCR-002 (POO-306)
 * @name useCreatePool
 * @implements-rules-version v2
 *
 * Client executor for the on-chain create-pool operation, exposed as ordered {@link FlowStep}s
 * ({@link CreatePoolExecutor.buildSteps}) for the multistep wallet-sign modal (FU-001), and a one-shot
 * `execute` (a thin runner over the same steps). The sequence: ensure both pool tokens are approved to
 * Permit2 (one-time each, each self-skips when its allowance already covers the seed), sign a Permit2
 * batch for the two seed amounts, ask pool-party-api to build the create-pool tx (ranged or full-range
 * ticks, with the gas estimate), then sign + send it. Mock-safe like the other operation hooks. Amounts
 * are in wei (the caller resolves token decimals).
 *
 * POO-475: the build action now returns typed data ({ ok: true, tx } | { ok: false, code, message }).
 * The build step rethrows a failure as `TransactionError(message, { code })` so the backend code lands
 * on `error.cause.code` and `classifyTxError` classifies it in production (e.g. SLIPPAGE_EXCEEDED).
 *
 * POO-525 R1 (v2): an omitted `slippageTolerance` now defaults to CREATE_POOL_DEFAULT_SLIPPAGE_PCT
 * (2%), aligned with the Review gear seed and the server fallback (was a hardcoded 0.5).
 */
"use client";

import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import type { FlowStep } from "@/features/strategies/hooks/useWalletSignFlow";
import { CREATE_POOL_DEFAULT_SLIPPAGE_PCT } from "@/features/strategies/lib/slippage";
import { useAuth } from "@/lib/auth/useAuth";
import { networkToChainId } from "@/lib/chains/config";
import { fullRangeTicks } from "@/lib/manager/fullRangeTicks";
import { poolPartyManagerAddress } from "@/lib/manager/managerContracts";
import { isMockMode } from "@/lib/services";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import {
  buildPermit2ApproveTx,
  buildPermitBatch,
  permitBatchTypedData,
  readPermit2Nonce,
  readPermit2TokenAllowance,
  serializePermitBatch,
} from "@/lib/tx/permit2";
import {
  type Eip1193Provider,
  executeBuiltTransaction,
  executeBuiltTransactionWithReceipt,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import type { WrappedNativeFunding } from "../lib/seedAmounts";
import {
  buildCreatePoolTxAction,
  type CreatePoolFeatureSettings,
} from "../operations/createPoolAction";

/** Input for one create-pool run. Amounts are in wei (caller resolves decimals). */
export interface CreatePoolRunInput {
  network: string;
  feeBps: number;
  /** Raw Uniswap fee tier (e.g. 500), sent verbatim. Falls back to feeBps×100 when absent. */
  feeTier?: number;
  /**
   * Spacing-aligned tick bounds for the position (from the manager's range). When omitted, the
   * pool is created full-range. Pair them — supplying only one falls back to full-range.
   */
  tickLower?: number;
  tickUpper?: number;
  token0: `0x${string}`;
  amount0: bigint;
  token1: `0x${string}`;
  amount1: bigint;
  featureSettings: CreatePoolFeatureSettings;
  slippageTolerance?: number;
  /**
   * POO-878 [R5]: the funding source chosen for the pool's wrapped-native leg (WETH/WPOL), forwarded
   * to the build so the API sets `tx.value` accordingly. Undefined when the pool has no wrapped-native
   * token (the API keeps its native default).
   */
  wrappedNativeFunding?: WrappedNativeFunding;
}

/** Accumulating context threaded across the create-pool steps. */
export interface CreatePoolCtx {
  provider?: Eip1193Provider;
  chainId?: number;
  owner?: `0x${string}`;
  spender?: `0x${string}`;
  batch?: ReturnType<typeof buildPermitBatch>;
  signature?: `0x${string}`;
  built?: BuiltTx;
  /**
   * POO-308: the mined receipt block of the create-pool send, threaded into the flow context so the
   * Review step's success handler feeds POO-638 convergence (indexed block >= receipt block). Null
   * when the node omitted `blockNumber`; undefined until the send settles.
   */
  blockNumber?: number | null;
}

/** Runs create-pool: ordered steps for the modal, or a one-shot execute. */
export interface CreatePoolExecutor {
  /** The ordered wallet-sign steps (approve ×2 → permit batch → build → send) for the runner. */
  buildSteps(input: CreatePoolRunInput): FlowStep<CreatePoolCtx>[];
  /** One-shot run over the same steps, resolving with the mined transaction hash. */
  execute(input: CreatePoolRunInput): Promise<{ hash: string }>;
}

/** Returns the create-pool executor (real on-chain in real mode). */
export function useCreatePool(): CreatePoolExecutor {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo<CreatePoolExecutor>(
      () => ({
        buildSteps: () => [],
        execute: async () => {
          throw new TransactionError("Create pool is mocked in mock mode");
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
  const { signTypedData } = useSignTypedData();

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  return useMemo<CreatePoolExecutor>(() => {
    function buildSteps(input: CreatePoolRunInput): FlowStep<CreatePoolCtx>[] {
      // PP-ANALYTICS: per-step (approve / sign / build / send) breadcrumbs land here with POO-156.
      return [
        {
          // Pre-flight (chain switch + provider) + ensure token0 is approved to Permit2 (one-time).
          // Self-skips when the allowance already covers the seed amount.
          key: "approve:token0",
          run: async () => {
            const chainId = networkToChainId(input.network);
            if (!chainId) throw new TransactionError(`Unsupported network: ${input.network}`);
            const spender = poolPartyManagerAddress(input.network);
            if (!spender) throw new TransactionError("Pool manager contract is not configured");
            // POO-892 [R5]: wallets[0] can be the stale handle after a wallet switch.
            const wallet = findWalletForAddress(wallets, activeAddress);
            if (!wallet) throw new TransactionError("Wallet not connected");
            const owner = wallet.address as `0x${string}`;
            // Switch the wallet to the pool's chain before signing/sending, else the wallet rejects
            // with "chainId should be same as current chainId" (-32602).
            await wallet.switchChain(chainId);
            const provider = await wallet.getEthereumProvider();
            const ctx: Partial<CreatePoolCtx> = { provider, chainId, owner, spender };
            const allowance = await readPermit2TokenAllowance(chainId, owner, input.token0);
            if (allowance < input.amount0) {
              await executeBuiltTransaction(
                provider,
                buildPermit2ApproveTx(chainId, input.token0),
                owner,
                chainId,
              );
              return ctx;
            }
            return { ...ctx, skipped: true };
          },
        },
        {
          // Ensure token1 is approved to Permit2 (one-time); self-skips like token0.
          key: "approve:token1",
          run: async (ctx) => {
            const { chainId, owner, provider } = ctx;
            if (!chainId || !owner || !provider) {
              throw new TransactionError("Create-pool pre-flight is incomplete");
            }
            const allowance = await readPermit2TokenAllowance(chainId, owner, input.token1);
            if (allowance < input.amount1) {
              await executeBuiltTransaction(
                provider,
                buildPermit2ApproveTx(chainId, input.token1),
                owner,
                chainId,
              );
              return {};
            }
            return { skipped: true };
          },
        },
        {
          // Build + sign the Permit2 batch (both seed amounts), spender = PoolPartyManager.
          key: "permit",
          run: async (ctx) => {
            const { chainId, owner, spender } = ctx;
            if (!chainId || !owner || !spender) {
              throw new TransactionError("Create-pool pre-flight is incomplete");
            }
            const [nonce0, nonce1] = await Promise.all([
              readPermit2Nonce(chainId, owner, input.token0, spender),
              readPermit2Nonce(chainId, owner, input.token1, spender),
            ]);
            const batch = buildPermitBatch(
              { token: input.token0, amount: input.amount0, nonce: nonce0 },
              { token: input.token1, amount: input.amount1, nonce: nonce1 },
              spender,
            );
            const { signature } = await signTypedData(permitBatchTypedData(batch, chainId), {
              address: owner,
            });
            return { batch, signature: signature as `0x${string}` };
          },
        },
        {
          // Build the create-pool tx server-side. The action computes the position-aware mint mins
          // (POO-315) from the raw seed amounts and the gas estimate.
          key: "build",
          run: async (ctx) => {
            if (!ctx.batch || !ctx.signature)
              throw new TransactionError("Permit signature missing");
            // POO-525 R1: default to the shared create-pool 2% (aligned with the gear seed + the
            // server fallback) when the caller omits a tolerance.
            const slippage = input.slippageTolerance ?? CREATE_POOL_DEFAULT_SLIPPAGE_PCT;
            // Ranged position when the caller supplies both bounds; otherwise full-range (POO-306).
            const { tickLower, tickUpper } =
              input.tickLower != null && input.tickUpper != null
                ? { tickLower: input.tickLower, tickUpper: input.tickUpper }
                : fullRangeTicks(input.feeBps);
            const result = await buildCreatePoolTxAction({
              network: input.network,
              // Send the raw fee tier when available (avoids the lossy bps round-trip); else derive it.
              feeTier: input.feeTier ?? input.feeBps * 100,
              currency0: input.token0,
              currency1: input.token1,
              tickLower,
              tickUpper,
              amount0: input.amount0.toString(),
              amount1: input.amount1.toString(),
              permitBatch: serializePermitBatch(ctx.batch),
              signature: ctx.signature,
              slippageTolerance: slippage,
              // POO-878 [R5]: forward the wrapped-native funding choice so the API sets tx.value.
              wrappedNativeFunding: input.wrappedNativeFunding,
              featureSettings: input.featureSettings,
            });
            // POO-475 [R3]: rethrow a typed failure with the code on `cause.code` for classification.
            if (!result.ok) throw new TransactionError(result.message, { code: result.code });
            return { built: result.tx };
          },
        },
        {
          // Sign + send the built tx and wait for the receipt. POO-308: capture the mined block so the
          // Review success handler can drive deterministic convergence (POO-638) on the new strategy.
          key: "confirm:addLiquidity",
          run: async (ctx) => {
            if (!ctx.provider || !ctx.built || !ctx.owner || !ctx.chainId) {
              throw new TransactionError("Transaction was not built");
            }
            const { hash, blockNumber } = await executeBuiltTransactionWithReceipt(
              ctx.provider,
              ctx.built,
              ctx.owner,
              ctx.chainId,
            );
            return { txHash: hash, blockNumber };
          },
        },
      ];
    }

    return {
      buildSteps,
      execute: async (input) => {
        let ctx: CreatePoolCtx = {};
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
  }, [wallets, activeAddress, signTypedData]);
}
