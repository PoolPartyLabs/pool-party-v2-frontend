"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { address, createSolanaRpc } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { SOLANA_CHAIN } from "./config";
import { solanaRpcUrl } from "./rpcEndpoint";

export async function readManagerSolanaBalance(walletAddress: string): Promise<bigint> {
  const result = await createSolanaRpc(solanaRpcUrl())
    .getBalance(address(walletAddress), { commitment: "finalized" })
    .send();
  return result.value;
}

function isWalletRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === 4001 || /reject|denied|cancel|declin|closed/i.test(message);
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
    /** Every connected Solana wallet: with several and no bound key, the Manager picks one. */
    addresses: enabled ? wallets.map((candidate) => candidate.address) : [],
    balanceLamports: wallet ? (balance.data ?? null) : null,
    balanceError: balance.isError,
    refreshBalance: balance.refetch,
    connect: () => {
      if (!enabled) throw new Error("SOLANA_DISABLED");
      connectWallet({
        walletChainType: "solana-only",
        walletList: ["phantom", "detected_solana_wallets", "wallet_connect"],
      });
    },
    signMessage: async (message: Uint8Array) =>
      (await signMessage({ wallet: requireWallet(), message })).signature,
    signTransaction: async (transaction: Uint8Array) => {
      const target = requireWallet();
      try {
        return (await signTransaction({ wallet: target, transaction, chain: SOLANA_CHAIN }))
          .signedTransaction;
      } catch (error) {
        // F5: a refused prompt is provably unsent; name it so the journey can offer a retry.
        throw new Error(isWalletRejection(error) ? "USER_REJECTED" : "SOLANA_SIGN_FAILED");
      }
    },
  };
}
