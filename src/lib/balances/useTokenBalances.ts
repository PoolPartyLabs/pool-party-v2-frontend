/**
 * @id PP-BALANCES (POO-238, POO-239, POO-808)
 * @name useTokenBalances
 * @implements-rules-version v1
 * Client hook that loads the connected wallet's token balances across every supported network and
 * the total USD value. Real mode reads on-chain USDC for the connected address (getRealTokenBalances,
 * POO-239); mock mode reads the static fixtures. The total always reflects every chain (the modal
 * lists all networks without a switcher).
 *
 * POO-808: exposes a manual `refresh()` (with `isRefreshing`) so the wallet modal can re-read the
 * balance on demand. Received tokens do not change the connected address, so the initial-load
 * effect never re-fires on its own. The refresh is in-place: it does NOT toggle `isLoading`, so the
 * header chip / total never flash their skeleton; the previous values stay visible until the new
 * read resolves; a failed read keeps the last balances (swallowed); concurrent calls coalesce.
 *
 * PP-MOCK: the 24h change is a static mock and is omitted in real mode (no value series yet).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { isMockMode } from "@/lib/services";
import { getRealTokenBalances } from "./getRealTokenBalances";
import { getTokenBalances } from "./getTokenBalances";
import type { TokenBalance } from "./types";
import { getWalletHoldingsAction } from "./walletHoldingsActions";

/** Mock 24h change in USD (header subtitle; mock mode only). */
const MOCK_DAY_CHANGE_USD = 58.4;
/** Mock 24h change as a fraction (e.g. 0.047 = +4.7%; mock mode only). */
const MOCK_DAY_CHANGE_PCT = 0.047;

/** Aggregated wallet balance state for the modal. */
export interface WalletBalances {
  /** All token holdings across chains (zero balances already removed). */
  balances: TokenBalance[];
  /** Total USD value across every chain. */
  totalUsd: number;
  /** Mock 24h change in USD. */
  dayChangeUsd: number;
  /** Mock 24h change as a fraction of the total. */
  dayChangePct: number;
  /** Whether the balances are still loading (first load / address change only). */
  isLoading: boolean;
  /** Whether a manual in-place refresh is currently running (POO-808). */
  isRefreshing: boolean;
  /** Re-read the balances in place, without a loading skeleton (POO-808). */
  refresh: () => void;
}

/** Loads all token balances once and derives the total (+ the mock 24h change in mock mode). */
export function useTokenBalances(): WalletBalances {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Mock mode: Privy/wagmi providers aren't mounted, so the connected address is read only in real
  // mode. isMockMode is a build-time constant, so the hook order is stable for a given build.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const address = isMockMode ? undefined : useAccount().address;

  // Reads balances for the current mode + address. Mock mode reads fixtures. Real mode reads the
  // FULL multi-token holdings (with USD) from pool-party-api (POO-815); if that endpoint is
  // unavailable / fails the action returns null and we fall back to the USDC-only on-chain read so
  // nothing regresses. No wallet yet (real mode) → an empty list, not a stale mock balance.
  const read = useCallback(async (): Promise<TokenBalance[]> => {
    if (isMockMode) return getTokenBalances();
    if (!address) return [];
    const holdings = await getWalletHoldingsAction();
    return holdings ?? getRealTokenBalances(address);
  }, [address]);

  // Monotonic id so a superseded read (address change / unmount) can never overwrite fresher state.
  const runIdRef = useRef(0);
  // Guards against overlapping manual refreshes (POO-808 R5: coalesce concurrent activations).
  const refreshingRef = useRef(false);

  // First load, and reload on address change: show the skeleton until the first read resolves.
  useEffect(() => {
    const runId = ++runIdRef.current;
    setIsLoading(true);
    read()
      .then((next) => {
        if (runIdRef.current !== runId) return;
        setBalances(next);
        setIsLoading(false);
      })
      .catch(() => {
        // Keep whatever we had; surface no error boundary. Stop the skeleton so the UI is usable.
        if (runIdRef.current === runId) setIsLoading(false);
      });
    // Invalidate any in-flight read on unmount / address change.
    return () => {
      runIdRef.current++;
    };
  }, [read]);

  // Manual, in-place refresh (POO-808). Does NOT toggle isLoading (no skeleton flash, R2); keeps the
  // previous balances until the new read resolves; swallows errors (R3); coalesces (R5).
  const refresh = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);
    const runId = ++runIdRef.current;
    read()
      .then((next) => {
        if (runIdRef.current === runId) setBalances(next);
      })
      .catch(() => {
        // R3: a failed refresh keeps the last good balances on screen.
      })
      .finally(() => {
        refreshingRef.current = false;
        if (runIdRef.current === runId) setIsRefreshing(false);
      });
  }, [read]);

  const totalUsd = balances.reduce((sum, balance) => sum + balance.usd, 0);

  return {
    balances,
    totalUsd,
    // No real value series yet → no 24h change in real mode (POO-239 follow-up).
    dayChangeUsd: isMockMode ? MOCK_DAY_CHANGE_USD : 0,
    dayChangePct: isMockMode ? MOCK_DAY_CHANGE_PCT : 0,
    isLoading,
    isRefreshing,
    refresh,
  };
}
