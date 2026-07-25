"use client";

/**
 * @id PP-CORE-LAY (SETUP / POO-194)
 * @name Providers
 * @implements-rules-version v1
 *
 * Client-side provider tree for wallet integration. Nests Privy > QueryClient > Wagmi so that
 * wagmi hooks have access to both the QueryClient and the Privy-managed wallet. Gated on
 * `!isMockMode`: in mock/test/Storybook the heavy SDKs are not loaded at all.
 *
 * PP-INTEGRATION-POINT: this is the single mount point for all wallet infrastructure. When the
 * chain config (W3) and auth service (W4) land, they plug in here.
 */
import { PrivyProvider } from "@privy-io/react-auth";
import { createConfig, WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmbeddedWalletActivator } from "@/lib/auth/EmbeddedWalletActivator";
import { SiweSessionProvider } from "@/lib/auth/useSiweSession";
import { WalletChainProbe } from "@/lib/auth/WalletChainProbe";
import { WalletSwitchGuard } from "@/lib/auth/WalletSwitchGuard";
import { defaultChain, supportedChains, transportMap } from "@/lib/chains/config";
import { OwnerProfileSessionProvider } from "@/lib/profile/useOwnerProfileSession";
import { isMockMode } from "@/lib/services/index";

// ---------------------------------------------------------------------------
// Wagmi config — uses @privy-io/wagmi createConfig (NOT plain wagmi) so Privy's
// embedded wallet is automatically registered as a connector. Chains and
// transports come from the single-source config (POO-195).
// ---------------------------------------------------------------------------
const wagmiConfig = createConfig({
  chains: supportedChains as [(typeof supportedChains)[0], ...typeof supportedChains],
  transports: transportMap,
  ssr: true,
});

// ---------------------------------------------------------------------------
// QueryClient — SSR-safe: in the browser we reuse a singleton so React Query's
// cache persists across navigations. On the server every request gets a fresh
// instance to avoid leaking data between users.
// ---------------------------------------------------------------------------
let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // Server: always fresh.
    return new QueryClient();
  }
  // Browser: singleton.
  if (!browserQueryClient) {
    browserQueryClient = new QueryClient();
  }
  return browserQueryClient;
}

// ---------------------------------------------------------------------------
// Privy env vars (NEXT_PUBLIC_* so they're available client-side).
// PP-INTEGRATION-POINT: values come from Privy dashboard; placeholders until
// .env.local is configured. Empty strings make PrivyProvider render but not
// authenticate — acceptable for initial wiring.
// ---------------------------------------------------------------------------
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ?? "";

/**
 * Wallet provider tree, gated on `!isMockMode`. In mock mode (the default) this is a
 * pass-through that renders children directly — no Privy, wagmi, or react-query overhead.
 */
export function Providers({ children }: { children: ReactNode }) {
  if (isMockMode) {
    return <>{children}</>;
  }

  const queryClient = getQueryClient();

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        defaultChain,
        supportedChains,
        // Email is enabled OUTSIDE production only, so a Privy TEST ACCOUNT
        // (`test-XXXX@privy.io` + fixed OTP) can log in and give automation a REAL EMBEDDED wallet.
        // Six wallet defects reached users because the e2e harness injects a viem wallet that Privy
        // treats as external, so no embedded behaviour was ever reproducible in CI (POO-1081).
        // Production keeps exactly the shipped methods; the ternary is a build-time constant.
        loginMethods:
          process.env.NEXT_PUBLIC_APP_ENV === "production"
            ? ["google", "wallet"]
            : ["google", "wallet", "email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: {
          coinbaseWallet: { config: { preference: { options: "eoaOnly" } } },
        },
        appearance: {
          showWalletLoginFirst: false,
          theme: "dark",
          landingHeader: "Welcome to Pool Party",
          loginMessage: "Connect your wallet to get started",
          walletList: [
            "metamask",
            "rabby_wallet",
            "detected_ethereum_wallets",
            "detected_wallets",
            "wallet_connect",
            "coinbase_wallet",
          ],
          walletChainType: "ethereum-only",
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {/* POO-1003: bind wagmi's active account to the Privy embedded wallet after a social
              login. Without it, a stale external (Rabby) connector left in wagmi storage blocks the
              embedded wallet from connecting, so the app hangs on skeleton loading forever. Inside
              WagmiProvider (needs the wagmi + Privy context); external-only sessions are untouched. */}
          <EmbeddedWalletActivator />
          {/* Non-production only, and dropped from a prod bundle by a build-time constant. */}
          <WalletChainProbe />
          <SiweSessionProvider>
            {/* Wallet switch guard (POO-892): on a genuine A-to-B account flip it clears the stale
                SIWE session and resets to home; on a rejected re-SIWE it forces logout. Inside
                SiweSessionProvider because it reads the handshake status. */}
            <WalletSwitchGuard />
            {/* Owner profile session store (POO-779): fetches the owner profile once per session and
                shares it (the manager role today). Inside SiweSessionProvider — it keys its read off the
                SIWE session/wallet. */}
            <OwnerProfileSessionProvider>{children}</OwnerProfileSessionProvider>
          </SiweSessionProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
