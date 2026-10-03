/**
 * @id PP-MGR-HOK-013 (POO-2177)
 * @name useV2LaunchWallet
 * @implements-rules-version v1
 */
"use client";
import { useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, erc20Abi, type Hex, http } from "viem";
import { getChainById, getUsdcAddress } from "@/lib/chains";
import { isUserRejection, sendBuiltTransaction } from "@/lib/tx/sendTransaction";
import { useEnsureWalletChain } from "@/lib/tx/useEnsureWalletChain";
import type { LaunchWallet } from "./driver";

export function useV2LaunchWallet() {
  // PP-INTEGRATION-POINT: real-only Privy/wagmi providers supply chain-checked transactions and receipts.
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const ensureChain = useEnsureWalletChain();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const manager = wallet?.address ?? null;
  const refreshBalance = useCallback(async () => {
    setBalance(null);
    setBalanceError(false);
    const chain = getChainById(42161);
    if (!manager || !chain) return;
    try {
      const value = await createPublicClient({ chain, transport: http() }).readContract({
        address: getUsdcAddress(42161) as Hex,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [manager as Hex],
      });
      setBalance(value);
    } catch {
      setBalanceError(true);
    }
  }, [manager]);
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);
  const binding: LaunchWallet | null = wallet
    ? {
        async send(transaction) {
          const provider = await ensureChain(wallet, transaction.chainId);
          try {
            return await sendBuiltTransaction(
              provider,
              { tx: transaction, chainId: transaction.chainId },
              wallet.address,
              transaction.chainId,
            );
          } catch (failure) {
            throw new Error(
              isUserRejection(failure) ? "USER_REJECTED" : "SUBMISSION_RECONCILIATION_REQUIRED",
            );
          }
        },
        async receipt(chainId, hash) {
          const chain = getChainById(chainId);
          if (!chain || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
          try {
            return await createPublicClient({ chain, transport: http() }).getTransactionReceipt({
              hash: hash as Hex,
            });
          } catch {
            return null;
          }
        },
        async sign(message) {
          const provider = await ensureChain(wallet, 42161);
          const signature = await provider.request({
            method: "personal_sign",
            params: [
              `0x${Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
              wallet.address,
            ],
          });
          if (typeof signature !== "string") throw new Error("INVALID_SIGNATURE");
          return signature;
        },
      }
    : null;
  return {
    manager,
    wallet: binding,
    balance,
    balanceError,
    refreshBalance,
  };
}
export type V2LaunchWallet = ReturnType<typeof useV2LaunchWallet>;
