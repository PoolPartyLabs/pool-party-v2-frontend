/**
 * @id PP-STR-MOD-001 (POO-303)
 * @name useInvest
 * @implements-rules-version v1
 *
 * Client executor for the real invest (add-liquidity) operation, exposed two ways: as ordered
 * {@link FlowStep}s ({@link InvestExecutor.buildSteps}) for the multistep wallet-sign modal (FU-001),
 * and as a one-shot `execute` (a thin runner over the same steps). The sequence: ensure USDC is
 * approved to Permit2 (one-time, self-skips when the allowance already covers it), sign a Permit2
 * single for the deposit, build the add-liquidity tx server-side, then sign + send it and wait for the
 * receipt. Mock-safe like the other operation hooks; in mock mode it throws if called (the modal uses
 * the mock settle path).
 *
 * Optimize (display-only utilization) is intentionally skipped — the backend does its own routing.
 *
 * POO-475: the build action now returns typed data ({ ok: true, tx } | { ok: false, code, message }).
 * The build step rethrows a failure as `TransactionError(message, { code })` so the backend code lands
 * on `error.cause.code` and `classifyTxError` classifies it in production (e.g. SLIPPAGE_EXCEEDED).
 */
"use client";

import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import { parseUnits } from "viem";
import { useAuth } from "@/lib/auth/useAuth";
import { getUsdcAddress, isLegacyNetwork, networkToChainId } from "@/lib/chains/config";
import { poolPartyManagerAddress } from "@/lib/manager/managerContracts";
import type { Strategy } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { recordLiquidityEvent } from "@/lib/strategies/v2/recordLiquidityEvent";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import {
  buildPermit2ApproveTx,
  buildPermitSingle,
  permitTypedData,
  readPermit2Nonce,
  readPermit2TokenAllowance,
  serializePermit,
} from "@/lib/tx/permit2";
import type { ReceivedLegsResult } from "@/lib/tx/receivedAmounts";
import {
  type Eip1193Provider,
  executeBuiltTransaction,
  executeBuiltTransactionWithLogs,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import { buildAddLiquidityTxAction } from "../operations/investActions";
import { decodeReceipt } from "./receiptDecode";
import type { FlowStep } from "./useWalletSignFlow";

/** USDC has 6 decimals; invest amounts are 1:1 USD. */
const USDC_DECIMALS = 6;

/** Accumulating context threaded across the invest steps. */
export interface InvestCtx {
  provider?: Eip1193Provider;
  chainId?: number;
  usdc?: `0x${string}`;
  owner?: `0x${string}`;
  spender?: `0x${string}`;
  amount?: bigint;
  permit?: ReturnType<typeof buildPermitSingle>;
  signature?: `0x${string}`;
  built?: BuiltTx;
  /**
   * POO-810 R4: the decoded receipt amounts. For invest only the USDC refund matters —
   * `deployed = requested − decoded.usdcUsd`. Null when logs were unavailable / nothing decoded, so
   * the modal falls back to the full requested amount (R9). Threaded here from the confirm step.
   */
  decoded?: ReceivedLegsResult | null;
}

/** Runs the invest operation: ordered steps for the modal, or a one-shot execute. */
export interface InvestExecutor {
  /** The ordered wallet-sign steps (approve → permit → build → send) for {@link useWalletSignFlow}. */
  buildSteps(
    strategy: Strategy,
    amountUsd: number,
    slippageTolerance?: number,
  ): FlowStep<InvestCtx>[];
  /** One-shot run over the same steps, resolving with the mined transaction hash. */
  execute(
    strategy: Strategy,
    amountUsd: number,
    slippageTolerance?: number,
  ): Promise<{ hash: string }>;
}

/** Returns the invest executor (real on-chain in real mode). */
export function useInvest(): InvestExecutor {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo<InvestExecutor>(
      () => ({
        buildSteps: () => [],
        execute: async () => {
          throw new TransactionError("Invest is mocked in mock mode");
        },
      }),
      [],
    );
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { wallets } = useWallets();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { signTypedData } = useSignTypedData();
  // POO-892 [R5]: the active address drives the address-matched wallet lookup below.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address: activeAddress } = useAuth();

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  return useMemo<InvestExecutor>(() => {
    function buildSteps(
      strategy: Strategy,
      amountUsd: number,
      slippageTolerance?: number,
    ): FlowStep<InvestCtx>[] {
      // PP-ANALYTICS: per-step (approve / sign / build / send) breadcrumbs land here with POO-156.
      return [
        {
          // Ensure USDC is approved to Permit2 (one-time). Also does the pre-flight (chain switch +
          // provider) so later steps can sign/send. Self-skips when the allowance already covers it.
          key: "approve:USDC",
          run: async () => {
            if (!strategy.network || !strategy.pool) {
              throw new TransactionError("This strategy is missing on-chain configuration");
            }
            const chainId = networkToChainId(strategy.network);
            if (!chainId) throw new TransactionError(`Unsupported network: ${strategy.network}`);
            const usdc = getUsdcAddress(chainId);
            if (!usdc) throw new TransactionError("USDC is not configured for this network");
            // POO-892 [R5]: wallets[0] can be the stale handle after a wallet switch.
            const wallet = findWalletForAddress(wallets, activeAddress);
            if (!wallet) throw new TransactionError("Wallet not connected");
            const owner = wallet.address as `0x${string}`;
            // The Permit2 spender is the PoolPartyManager that executes addLiquidity (matches
            // useCreatePool) — NOT the pool address, which the backend rejects.
            const spender = poolPartyManagerAddress(strategy.network);
            if (!spender) throw new TransactionError("Pool manager contract is not configured");
            const amount = parseUnits(amountUsd.toString(), USDC_DECIMALS);
            // Switch the wallet to the strategy's chain first, else signing / sends fail with
            // "chainId should be same as current chainId" (-32602).
            await wallet.switchChain(chainId);
            const provider = await wallet.getEthereumProvider();
            const ctx: Partial<InvestCtx> = { provider, chainId, usdc, owner, spender, amount };
            const allowance = await readPermit2TokenAllowance(chainId, owner, usdc);
            if (allowance < amount) {
              await executeBuiltTransaction(
                provider,
                buildPermit2ApproveTx(chainId, usdc),
                owner,
                chainId,
              );
              return ctx;
            }
            return { ...ctx, skipped: true };
          },
        },
        {
          // Build + sign the Permit2 single for this deposit (off-chain, gasless).
          key: "permit",
          run: async (ctx) => {
            const { chainId, owner, usdc, spender, amount } = ctx;
            if (!chainId || !owner || !usdc || !spender || amount == null) {
              throw new TransactionError("Invest pre-flight is incomplete");
            }
            const nonce = await readPermit2Nonce(chainId, owner, usdc, spender);
            const permit = buildPermitSingle(usdc, spender, amount, nonce);
            const { signature } = await signTypedData(permitTypedData(permit, chainId), {
              address: owner,
            });
            return { permit, signature: signature as `0x${string}` };
          },
        },
        {
          // Build the add-liquidity tx server-side (computes mins + the gas estimate).
          key: "build",
          run: async (ctx) => {
            if (!strategy.network) throw new TransactionError("This strategy has no network");
            if (!ctx.permit || !ctx.signature)
              throw new TransactionError("Permit signature missing");
            const result = await buildAddLiquidityTxAction({
              positionId: strategy.id,
              network: strategy.network,
              permit: serializePermit(ctx.permit),
              signature: ctx.signature,
              // Universal Router only on current networks; legacy omits it (POO-316).
              poolPartyPositionAddress: isLegacyNetwork(strategy.network)
                ? undefined
                : strategy.pool,
              slippageTolerance,
            });
            // POO-475 [R3]: the action surfaces failures as data. Rethrow with the code on
            // `cause.code` so `classifyTxError` sees a backend SLIPPAGE_EXCEEDED (etc.) in production.
            if (!result.ok) throw new TransactionError(result.message, { code: result.code });
            return { built: result.tx };
          },
        },
        {
          // Sign + send the built tx and wait for the receipt.
          key: "confirm:invest",
          run: async (ctx) => {
            if (!ctx.provider || !ctx.built || !ctx.owner || ctx.chainId == null) {
              throw new TransactionError("Transaction was not built");
            }
            // POO-810 R1/R4: send with the receipt logs so a single confirmed tx feeds BOTH the
            // decode (the REAL deployed USD from the USDC refund — `deployed = requested − refund`;
            // a partial fill on market movement / slippage leaves a remainder in the wallet) AND the
            // POO-719 cost-basis ledger below (which only needs the tx hash).
            // POO-824 [R1]: ctx.chainId is the broadcast-time chain assertion target.
            const { hash, logs } = await executeBuiltTransactionWithLogs(
              ctx.provider,
              ctx.built,
              ctx.owner,
              ctx.chainId,
            );
            // POO-719 rules-v2 [R3v2/R5v2]: ledger this confirmed add into the cost-basis ledger.
            // Fire-and-forget — the helper swallows every failure (POO-822 reconciles), so the
            // invest flow's success is NEVER gated on it.
            if (strategy.network) {
              void recordLiquidityEvent({
                strategyRef: strategy.id,
                txHash: hash,
                network: strategy.network,
              });
            }
            const decoded = await decodeReceipt({
              logs,
              wallet: ctx.owner,
              chainId: ctx.chainId,
            });
            return { txHash: hash, decoded };
          },
        },
      ];
    }

    return {
      buildSteps,
      execute: async (strategy, amountUsd, slippageTolerance) => {
        let ctx: InvestCtx = {};
        let hash = "";
        for (const step of buildSteps(strategy, amountUsd, slippageTolerance)) {
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
