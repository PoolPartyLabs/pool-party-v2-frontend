"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { address, createSolanaRpc } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { SOLANA_CHAIN } from "./config";

export async function readManagerSolanaBalance(walletAddress: string): Promise<bigint> {
  const result = await createSolanaRpc("https://api.mainnet-beta.solana.com")
    .getBalance(address(walletAddress), { commitment: "finalized" })
    .send();
  return result.value;
}

/** DEC-190: use only the bound key on resume; never silently switch to another wallet. */
export function useManagerSolanaWallet(boundAddress?: string) {
  const { isEnabled } = useFeatureFlags();
  const enabled = isEnabled("solanaSpoke");
  const { connectWallet } = usePrivy();
  const { wallets, ready } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const wallet = enabled
    ? boundAddress
      ? wallets.find((candidate) => candidate.address === boundAddress)
      : wallets.length === 1
        ? wallets[0]
        : undefined
    : undefined;
  const balance = useQuery({
    queryKey: ["manager-solana-balance", wallet?.address],
    queryFn: () => readManagerSolanaBalance(wallet?.address ?? ""),
    enabled: enabled && !!wallet,
    retry: false,
    staleTime: 10_000,
  });
  const requireWallet = () => {
    if (!wallet) throw new Error("SOLANA_WALLET_REQUIRED");
    return wallet;
  };
  return {
    enabled,
    ready,
    address: wallet?.address ?? null,
    balanceLamports: wallet ? (balance.data ?? null) : null,
    balanceError: balance.isError,
    refreshBalance: balance.refetch,
    connect: () => {
      if (!enabled) throw new Error("SOLANA_DISABLED");
      connectWallet({ walletChainType: "solana-only" });
    },
    signMessage: async (message: Uint8Array) =>
      (await signMessage({ wallet: requireWallet(), message })).signature,
    signTransaction: async (transaction: Uint8Array) =>
      (
        await signTransaction({
          wallet: requireWallet(),
          transaction,
          chain: SOLANA_CHAIN,
        })
      ).signedTransaction,
  };
}
