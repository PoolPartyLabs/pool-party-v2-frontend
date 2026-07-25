/**
 * @id PP-CORE-CMP-012 (POO-1081)
 * @name WalletChainProbe
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * A NON-PRODUCTION diagnostic that answers one question no unit test in this repo can:
 * **which lever actually moves a Privy EMBEDDED wallet's reported chain?**
 *
 * Six wallet-facing defects have reached users here (POO-1001, POO-1003, POO-1077, POO-1078,
 * POO-1079, POO-1080, POO-1081), every one a case where an embedded wallet diverges from an injected
 * one. None was reproducible in CI, because the e2e harness injects a viem wallet that Privy treats
 * as EXTERNAL. Five fixes shipped on five plausible mechanisms without any of them being
 * demonstrated. This exists so that stops.
 *
 * It performs NO transaction, spends nothing, and signs nothing: it reads `eth_chainId` through the
 * combinations the app actually uses, so the difference between them is visible rather than
 * inferred.
 *
 * PP-SECURITY: mounted only when `NEXT_PUBLIC_APP_ENV !== "production"`, and it exposes no key, no
 * signature and no address. The gate is a build-time constant, so the whole component is dropped
 * from a production bundle rather than merely hidden at runtime.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useEffect } from "react";

/** What the probe reports. Every field is a chain id as the provider returned it (EIP-3326 hex). */
export interface WalletChainProbeResult {
  available: true;
  /** Whether Privy considers this an embedded wallet. The whole point of the comparison. */
  walletClientType: string;
  /** The chain a provider fetched BEFORE anything reports. */
  initial: string;
  /** A freshly fetched provider, no switch: the rail's old per-request pattern. */
  afterFreshProvider: string;
  /** The SAME provider handle after `wallet.switchChain()`: what `useInvest` does, and it works. */
  afterSdkSwitch: string;
  /** A provider fetched AFTER the SDK switch: does a fresh handle agree with the switch? */
  afterSdkSwitchFreshProvider: string;
}

const ENABLED = process.env.NEXT_PUBLIC_APP_ENV !== "production";

async function chainIdOf(provider: { request: (a: { method: string }) => Promise<unknown> }) {
  try {
    return String(await provider.request({ method: "eth_chainId" }));
  } catch (error) {
    return `error:${String(error)}`;
  }
}

/**
 * Publishes `window.__ppWalletProbe({from, to})` for the e2e spec to call.
 *
 * Returns nothing renderable; it is mounted for its effect alone.
 */
export function WalletChainProbe() {
  const { wallets } = useWallets();

  useEffect(() => {
    if (!ENABLED) return;
    const target = window as unknown as { __ppWalletProbe?: unknown };

    target.__ppWalletProbe = async ({ to }: { from: number; to: number }) => {
      const wallet = wallets[0];
      if (!wallet) return { available: false as const, reason: "no wallet connected" };

      const first = await wallet.getEthereumProvider();
      const initial = await chainIdOf(first);
      const fresh = await wallet.getEthereumProvider();
      const afterFreshProvider = await chainIdOf(fresh);

      try {
        await wallet.switchChain(to);
      } catch (error) {
        return {
          available: true as const,
          walletClientType: wallet.walletClientType,
          initial,
          afterFreshProvider,
          afterSdkSwitch: `switchChain threw: ${String(error)}`,
          afterSdkSwitchFreshProvider: "n/a",
        };
      }

      // The same handle the switch was called against, then a brand new one. If these disagree, the
      // provider is pinned at fetch time and re-fetching per request is the defect.
      const afterSdkSwitch = await chainIdOf(first);
      const afterSdkSwitchFreshProvider = await chainIdOf(await wallet.getEthereumProvider());

      return {
        available: true as const,
        walletClientType: wallet.walletClientType,
        initial,
        afterFreshProvider,
        afterSdkSwitch,
        afterSdkSwitchFreshProvider,
      } satisfies WalletChainProbeResult;
    };

    return () => {
      target.__ppWalletProbe = undefined;
    };
  }, [wallets]);

  return null;
}
