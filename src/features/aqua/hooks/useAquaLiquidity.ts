"use client";

import { useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import { createPublicClient, erc20Abi, http } from "viem";
import { arbitrum } from "viem/chains";
import type { FlowStep } from "@/features/strategies/hooks/useWalletSignFlow";
import { CHAIN_ID_ARBITRUM, TOKENS } from "@/lib/aqua/config/public";
import { useAuth } from "@/lib/auth/useAuth";
import {
  executeBuiltTransaction,
  findWalletForAddress,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import {
  buildAquaApproveTx,
  buildAquaDepositTx,
  buildAquaRedeemTx,
} from "../operations/aquaActions";

/**
 * @id PP-AQUA-HOK-001
 * @name useAquaLiquidity
 * @implements-rules-version v3
 *
 * Client executor for Active Reserve deposits and withdrawals, shaped as ordered
 * {@link FlowStep}s so it drives the same wallet-sign machinery every other operation uses.
 *
 * Deposit is two steps, approve then deposit, because the vault pulls with an ordinary
 * `transferFrom` and takes no Permit2 signature. The approve SELF-SKIPS when the existing
 * allowance already covers the amount, so a repeat deposit is a single signature.
 *
 * Withdraw is one step: shares are an internal ledger with no token to approve.
 *
 * Every build goes through a server action (SRV-R5) and the wallet signs whatever comes back;
 * this hook never constructs calldata.
 */

/** Public Arbitrum read client for the allowance check. Reads only, no key. */
function readClient() {
  return createPublicClient({ chain: arbitrum, transport: http() });
}

export interface AquaLiquidityCtx {
  /** Set once the deposit lands, so the caller can report the real minted amount. */
  depositHash?: string;
}

export interface AquaLiquidityExecutor {
  depositSteps(amountUsdc: bigint): FlowStep<AquaLiquidityCtx>[];
  redeemSteps(shares: bigint): FlowStep<AquaLiquidityCtx>[];
}

/** Turn a failed server build into the error shape `classifyTxError` already understands. */
function rethrowBuildFailure(result: { ok: false; code: string; message: string }): never {
  throw new TransactionError(result.message, { code: result.code });
}

export function useAquaLiquidity(): AquaLiquidityExecutor {
  const { wallets } = useWallets();
  const { address } = useAuth();

  /** Resolve the connected wallet's EIP-1193 provider, or fail with a legible reason. */
  const resolveProvider = useCallback(async () => {
    if (!address) throw new TransactionError("Connect a wallet first.", { code: "NO_WALLET" });
    const wallet = findWalletForAddress(wallets, address);
    if (!wallet) {
      throw new TransactionError("The connected wallet is unavailable.", { code: "NO_WALLET" });
    }
    const provider = (await wallet.getEthereumProvider()) as Parameters<
      typeof executeBuiltTransaction
    >[0];
    return { provider, owner: address as `0x${string}` };
  }, [wallets, address]);

  return useMemo<AquaLiquidityExecutor>(
    () => ({
      depositSteps(amountUsdc) {
        return [
          {
            key: "approve",
            async run() {
              const { provider, owner } = await resolveProvider();

              // Self-skip: a repeat deposit inside an existing allowance costs one signature,
              // not two. Read straight from chain rather than trusting a cached figure.
              const allowance = await readClient().readContract({
                address: TOKENS.USDC,
                abi: erc20Abi,
                functionName: "allowance",
                args: [owner, vaultFromEnvSafe()],
              });
              if (allowance >= amountUsdc) return { skipped: true };

              const built = await buildAquaApproveTx({
                owner,
                amountUsdc: amountUsdc.toString(),
              });
              if (!built.ok) rethrowBuildFailure(built);

              const hash = await executeBuiltTransaction(
                provider,
                built.tx,
                owner,
                CHAIN_ID_ARBITRUM,
              );
              return { txHash: hash };
            },
          },
          {
            key: "deposit",
            async run() {
              const { provider, owner } = await resolveProvider();
              const built = await buildAquaDepositTx({
                owner,
                amountUsdc: amountUsdc.toString(),
              });
              if (!built.ok) rethrowBuildFailure(built);

              const hash = await executeBuiltTransaction(
                provider,
                built.tx,
                owner,
                CHAIN_ID_ARBITRUM,
              );
              return { txHash: hash, depositHash: hash };
            },
          },
        ];
      },

      redeemSteps(shares) {
        return [
          {
            key: "redeem",
            async run() {
              const { provider, owner } = await resolveProvider();
              const built = await buildAquaRedeemTx({ owner, shares: shares.toString() });
              if (!built.ok) rethrowBuildFailure(built);

              const hash = await executeBuiltTransaction(
                provider,
                built.tx,
                owner,
                CHAIN_ID_ARBITRUM,
              );
              return { txHash: hash };
            },
          },
        ];
      },
    }),
    [resolveProvider],
  );
}

/**
 * The vault address for the client-side allowance read.
 *
 * Deliberately NEXT_PUBLIC: this is a public contract address, not a secret, and the allowance
 * check has to happen in the browser to decide whether the approve step can be skipped. Every
 * actual build still goes through the server action, which reads the server-only value.
 */
function vaultFromEnvSafe(): `0x${string}` {
  const raw = process.env.NEXT_PUBLIC_AQUA_VAULT_ADDRESS;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new TransactionError("The vault address is not configured.", {
      code: "VAULT_NOT_CONFIGURED",
    });
  }
  return raw as `0x${string}`;
}
