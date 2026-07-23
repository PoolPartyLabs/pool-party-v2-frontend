/**
 * @id PP-CORE-LIB-010
 * @name AnalyticsIdentify
 * @implements-rules-version v1
 *
 * Invisible client component that keeps the pseudonymous analytics `user_id` in sync (POO-164):
 * when a wallet is connected AND consent is granted, it resolves the server-derived hash once and
 * stores it for `useAnalytics`; on disconnect or consent denial/withdrawal it clears the store.
 * Listens to the `pp:consent` signal emitted by `writeConsent` so a banner choice takes effect
 * without a reload. Renders nothing.
 *
 * PP-SECURITY [R4]: identified analytics only after consent; [R2] only the hash is stored.
 * PP-NOTE: mock mode has no persisted session (route guards/Privy session = POO-117), so there is
 * no connected address to identify — the store simply stays null and analytics runs unidentified.
 * In real mode the address comes from the wagmi-connected account (Privy).
 */
"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { type ConsentState, readConsent } from "@/lib/analytics/consent";
import { fetchAnalyticsUserId, setAnalyticsUserId } from "@/lib/analytics/userId";
import { isMockMode } from "@/lib/services";

/** The connected wallet address (real mode via wagmi; mock mode has none). */
function useConnectedAddress(): string | null {
  if (isMockMode) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address } = useAccount();
  return address ?? null;
}

/** Syncs the analytics user id with the wallet + consent state. */
export function AnalyticsIdentify() {
  const address = useConnectedAddress();
  const [consent, setConsent] = useState<ConsentState>("unknown");

  // Track the persisted choice; a banner choice (pp:consent) re-syncs without a reload.
  useEffect(() => {
    setConsent(readConsent());
    const sync = () => setConsent(readConsent());
    window.addEventListener("pp:consent", sync);
    return () => window.removeEventListener("pp:consent", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!address || consent !== "granted") {
      setAnalyticsUserId(null);
      return;
    }
    fetchAnalyticsUserId(address).then((userId) => {
      if (!cancelled) setAnalyticsUserId(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [address, consent]);

  return null;
}
