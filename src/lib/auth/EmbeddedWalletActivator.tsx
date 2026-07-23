/**
 * @id PP-AUTH-CMP-003 (POO-1003)
 * @name EmbeddedWalletActivator
 * @implements-rules-version v1
 *
 * Invisible client guard in the wallet provider tree (inside WagmiProvider, real mode only). Fixes
 * the "log in with Google after disconnecting an external wallet hangs forever on skeleton loading"
 * bug (POO-1003).
 *
 * Root cause: `@privy-io/wagmi` mirrors every Privy wallet into wagmi as an `injected` connector but
 * leaves the *active* account to wagmi's `reconnect()`, tie-broken by the persisted
 * `recentConnectorId`. When an external wallet is disconnected, wagmi's `disconnect()` writes
 * `recentConnectorId` + a `<id>.disconnected` tombstone for it; on the next Google login Privy's own
 * sync effect sees that tombstoned `recentConnectorId` and skips `reconnect()`, so the freshly
 * created embedded wallet never becomes wagmi's active account. Privy stays `authenticated` while
 * `useAccount().isConnected` stays `false`, so `useAuth` sits in `authenticated && !isConnected`
 * (isLoading) forever and every wallet-scoped loader stays in its skeleton.
 *
 * Fix ([R2]): whenever a Privy embedded wallet exists and wagmi is not already on it, bind it as the
 * active account with `useSetActiveWallet` (the Privy-documented lever — it clears the embedded
 * connector's tombstone and forces `switchAccount`/`connect`), which deterministically flips
 * `isConnected` to true regardless of the stale `recentConnectorId`.
 *
 * The guard only ever acts when an embedded wallet is present. External-only sessions (Rabby et al.)
 * have no embedded wallet (`createOnLogin: "users-without-wallets"` never mints one for a user who
 * arrives with a wallet), so they are never touched and keep connecting/disconnecting through the
 * unchanged Privy/wagmi path. Dual embedded+external identity (deliberately staying on the external
 * wallet while an embedded one also exists) is out of scope until POO-889.
 *
 * PP-NOTE (WalletSwitchGuard PP-AUTH-CMP-002 interaction): in the real flow wagmi's active address is
 * `undefined` at activation time — `wagmiDisconnect()` on logout (useAuth) resets wagmi to
 * disconnected before the next login — so activation is an `undefined → embedded` first-connect, and
 * WalletSwitchGuard.isWalletSwitch(null, B) is false: it stays quiet (already covered by its
 * "[R1] does nothing when a different wallet connects after a disconnect" test). The predicate's
 * `stale-external → embedded` branch is defensive only: an external address owning wagmi *while* Privy
 * is authenticated with an embedded wallet is a state no session produces today (an external-arriving
 * user has no embedded wallet; there is no user switch without logout). If POO-889 (embedded +
 * external at once) lands, that co-occurrence becomes possible and the A→B activation would trip the
 * guard's switch path (signOutAction + home redirect) — revisit this guard interaction there.
 */
"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";

/**
 * Whether wagmi should be re-pointed at the embedded wallet: an embedded wallet exists and it is not
 * already the active account (casing-insensitive; `undefined` active = the stuck/disconnected state).
 */
export function shouldActivateEmbeddedWallet(
  embeddedAddress: string | undefined,
  activeAddress: string | undefined,
): boolean {
  if (!embeddedAddress) return false;
  return embeddedAddress.toLowerCase() !== (activeAddress ?? "").toLowerCase();
}

/** Keeps wagmi's active account bound to the Privy embedded wallet after a social login (POO-1003). */
export function EmbeddedWalletActivator() {
  const { authenticated } = usePrivy();
  const { wallets, ready } = useWallets();
  const { address } = useAccount();
  const { setActiveWallet } = useSetActiveWallet();
  // The embedded wallet we've already fired an activation for. A one-shot per address (the
  // `startedFor` pattern from useSiweSession): Privy rebuilds `wallets` on every render (POO-899) so
  // the effect re-runs constantly; without this latch we'd spam setActiveWallet until the account
  // flips. Reset on logout/not-ready/no-embedded so a fresh session re-attempts, and cleared on a
  // hard failure so the next render retries once (the embedded connector may register a beat late).
  const attemptedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!authenticated || !ready) {
      attemptedFor.current = null;
      return;
    }
    const embedded = wallets.find((wallet) => wallet.walletClientType === "privy");
    if (!embedded) {
      attemptedFor.current = null;
      return;
    }
    if (!shouldActivateEmbeddedWallet(embedded.address, address)) return;
    if (attemptedFor.current === embedded.address) return;

    attemptedFor.current = embedded.address;
    setActiveWallet(embedded).catch((error) => {
      console.error("[EmbeddedWalletActivator] failed to activate the embedded wallet", error);
      attemptedFor.current = null;
    });
  }, [authenticated, ready, wallets, address, setActiveWallet]);

  return null;
}
