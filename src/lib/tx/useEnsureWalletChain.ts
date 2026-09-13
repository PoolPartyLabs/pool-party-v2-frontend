/**
 * @id PP-CORE-HOK-031 (POO-1385)
 * @name useEnsureWalletChain
 * @implements-rules-version v2 (POO-1385 rules v2)
 * @analytics-events none, the error surface reports the blocked intent; see PP-STR-CMP-026
 *
 * The one call every operation hook makes before it touches the wallet: move onto the operation's
 * chain, prove it, and hand back a provider that is really there.
 *
 * It is a hook only so it can reach wagmi's `switchChainAsync`, which is rung 1 of the ladder and the
 * lever the provider actually follows (POO-1079). Everything else lives in `ensureWalletChain.ts`,
 * pure and directly tested; this is the six lines of binding.
 *
 * REAL MODE ONLY. It calls a wagmi hook, and in mock mode there is no `WagmiProvider` in the tree, so
 * every caller sits behind the same `isMockMode` build-time constant the operation hooks already use.
 */
"use client";

import { useCallback } from "react";
import { useSwitchChain } from "wagmi";
import { ensureWalletProviderOnChain, type WalletHandle } from "./ensureWalletChain";
import type { Eip1193Provider } from "./sendTransaction";

/** Move a wallet onto `chainId` and resolve with a provider proven to be on it. */
export type EnsureWalletChain = (wallet: WalletHandle, chainId: number) => Promise<Eip1193Provider>;

/**
 * Returns the chain-ensuring call bound to this app's wagmi connector.
 *
 * Replaces, at every call site, the pair that shipped this bug:
 *
 * ```ts
 * await wallet.switchChain(chainId);                    // resolved without moving the connector
 * const provider = await wallet.getEthereumProvider();  // ...so this was still on the old chain
 * ```
 */
export function useEnsureWalletChain(): EnsureWalletChain {
  const { switchChainAsync } = useSwitchChain();
  return useCallback(
    (wallet, chainId) =>
      ensureWalletProviderOnChain(wallet, chainId, async (target) => {
        await switchChainAsync({ chainId: target });
      }),
    [switchChainAsync],
  );
}
