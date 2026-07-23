import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Providers } from "@/app/providers";
import { AnalyticsIdentify } from "@/components/analytics/AnalyticsIdentify";
import { ReferralTracker } from "@/features/rewards/ReferralTracker";

/**
 * @id PP-CORE-LAY-003 (SETUP / POO-491, POO-718)
 * @name Auth-scoped layout
 * @implements-rules-version v1
 *
 * Mounts the wallet provider tree (Privy > QueryClient > Wagmi > SIWE) over exactly the subtree that
 * can touch a wallet: the login flow (sign-in / connect / welcome) and the protected `(app)` app.
 * Pure-public routes (privacy / terms / risk / learn) live OUTSIDE this route group and never mount
 * the wallet stack, so they no longer ship or hydrate the Privy/wagmi/viem bundle (POO-491).
 *
 * The group is URL-transparent: `(auth)` and the nested `(app)` are stripped from the path, so every
 * public URL is unchanged. Because the login screens and `(app)` share THIS layout, navigating
 * login -> app does not remount the provider tree — the Privy session and any completed SIWE handshake
 * persist (no second signature).
 *
 * `AnalyticsIdentify` renders here (not in the root layout) so its `useAccount()` call only runs where
 * a `WagmiProvider` is actually mounted; on pure-public routes there is no wallet to identify.
 *
 * `ReferralTracker` (POO-718) mounts HERE, not in `(app)`: it must capture `?ref=` on the signed-out
 * landing (`/?ref=…`) before the `(app)` AuthGuard client-redirects to /sign-in (which drops the query),
 * and it needs the wallet tree above to know when a SIWE session exists so it can apply the code. It is
 * wrapped in Suspense because it reads `useSearchParams()` (which otherwise opts the whole route into
 * client rendering); the boundary confines that to the invisible tracker.
 *
 * PP-NOTE: this only mounts the wallet-infra entry point ({@link Providers}); the real chain/auth
 * mock->real seams live inside it (see the PP-INTEGRATION-POINT markers in `src/app/providers.tsx`).
 */
export default async function AuthScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Providers>
      <Suspense fallback={null}>
        <ReferralTracker />
      </Suspense>
      {children}
      <AnalyticsIdentify />
    </Providers>
  );
}
