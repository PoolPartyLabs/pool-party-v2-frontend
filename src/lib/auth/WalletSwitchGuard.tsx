/**
 * @id PP-AUTH-CMP-002 (POO-892)
 * @name WalletSwitchGuard
 * @implements-rules-version v1
 *
 * Invisible client guard in the wallet provider tree (inside WagmiProvider + SiweSessionProvider,
 * real mode only). Watches the wagmi account with a prev-ref (the established pattern from
 * useSiweSession / AnalyticsIdentify) and, on a GENUINE A-to-B wallet switch, kills wallet A's
 * server session (signOutAction, wired by POO-890) and sends the user to the localized home with a
 * fresh RSC render. On landing, the existing SIWE handshake prompts wallet B; if that handshake
 * errors (rejected signature), it forces a clean logout to /sign-in so the user is never stuck on
 * a blank, stale-identity dashboard. Renders nothing.
 *
 * POO-892 rules v1: [R1] switch predicate (first connect and disconnect never trigger; disconnect
 * stays with AuthGuard; embedded Privy wallets cannot switch; chain switches are out of scope,
 * POO-824). [R2] switch -> signOutAction + i18n router.push home + router.refresh. [R3] rejected
 * re-SIWE -> forced logout to /sign-in. Phase 2 (dual-identity, no re-SIWE popup) is POO-889.
 */
"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { signOutAction } from "@/features/auth/siweActions";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "./useAuth";
import { useSiweSession } from "./useSiweSession";

/**
 * The switch predicate (POO-892 R1): a genuine A-to-B flip only. First connect (prev null) and
 * disconnect (next null) never count; casing-only differences are the same wallet.
 */
export function isWalletSwitch(prev: string | null, next: string | null): boolean {
  return prev != null && next != null && prev.toLowerCase() !== next.toLowerCase();
}

/** Guards the app against a wallet switch leaving a stale SIWE identity behind (POO-892). */
export function WalletSwitchGuard() {
  const { address } = useAccount();
  const { status } = useSiweSession();
  const { logout } = useAuth();
  const router = useRouter();
  // The previously observed address (null = disconnected). A ref, not state: the comparison must
  // not re-render, and the effect below is the only reader/writer.
  const prevAddress = useRef<string | null>(null);

  // [R1]/[R2]: detect the A-to-B flip and reset the session + view for wallet B.
  useEffect(() => {
    const prev = prevAddress.current;
    const next = address ?? null;
    prevAddress.current = next;
    if (!isWalletSwitch(prev, next)) return;
    void (async () => {
      // Kill wallet A's Bearer immediately (same action as logout, POO-890 R2). A failed clear
      // must not strand the user mid-switch: the SIWE handshake for B overwrites the cookie anyway.
      try {
        await signOutAction();
      } catch (error) {
        console.error("[WalletSwitchGuard] failed to clear the stale session", error);
      }
      // Localized home + fresh RSC render (server content was wallet A's).
      router.push("/");
      router.refresh();
    })();
  }, [address, router]);

  // [R3]: the re-SIWE handshake for the new wallet errored (rejected signature / failed sign-in).
  // Without this the app is stuck: Privy stays authenticated (no AuthGuard redirect), the header
  // shows B, and A's cookie keeps serving Bearer writes. Force a clean logout to /sign-in.
  useEffect(() => {
    if (status !== "error") return;
    void (async () => {
      try {
        await signOutAction();
      } catch (error) {
        console.error("[WalletSwitchGuard] failed to clear the session on forced logout", error);
      }
      logout();
      router.push("/sign-in");
    })();
  }, [status, logout, router]);

  return null;
}
