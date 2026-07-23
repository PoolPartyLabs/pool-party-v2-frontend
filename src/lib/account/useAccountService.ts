/**
 * @id PP-ACCOUNT (POO-197)
 * @name useAccountService
 * @implements-rules-version v1
 *
 * Client-side hook that provides the real AccountService backed by on-chain reads (viem)
 * and Privy wallet introspection. In mock mode, delegates to the mock accountService.
 *
 * This hook exists because the AccountService interface is parameterless but the real
 * implementation needs the connected address and chain from wagmi/Privy hooks. Server
 * components that consume accountService still use the mock export from services/index.ts;
 * client components should migrate to this hook for real-mode support.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import type { AccountService } from "@/lib/services";
import { isMockMode, accountService as mockAccountService } from "@/lib/services";
import { getWalletKind } from "./getWalletKind";
import { readUsdcBalance } from "./readUsdcBalance";

/**
 * Returns an AccountService whose methods read live on-chain data in real mode
 * or delegate to the mock in mock mode.
 */
export function useAccountService(): AccountService {
  // In mock mode Privy/wagmi hooks aren't mounted, so return the mock directly.
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo(() => mockAccountService, []);
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address } = useAccount();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { wallets } = useWallets();

  // The spendable balance is the wallet's USDC on the operation's chain, at full precision. An invest
  // settles on a single chain, so summing every network over-authorized the Permit2 vs what the wallet
  // actually holds there (POO-303, superseding the POO-197 cross-network aggregate). Callers pass the
  // strategy's chainId; a bridge step adds cross-network funds later.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const getUsdcBalance = useCallback(
    async (chainId?: number): Promise<number> => {
      if (!address || chainId == null) return 0;
      return readUsdcBalance(address, chainId);
    },
    [address],
  );

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const getWalletKindFn = useCallback(async (): Promise<"embedded" | "external"> => {
    return getWalletKind(wallets, address);
  }, [wallets, address]);

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  return useMemo(
    () => ({
      getUsdcBalance,
      getWalletKind: getWalletKindFn,
    }),
    [getUsdcBalance, getWalletKindFn],
  );
}
