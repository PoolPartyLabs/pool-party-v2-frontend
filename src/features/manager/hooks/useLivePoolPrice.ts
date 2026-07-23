/**
 * @id PP-MGR-HOK-005 (POO-861)
 * @name useLivePoolPrice
 * @implements-rules-version v1
 *
 * Real-mode client hook that keeps the strategy builder's selected-pool price fresh (POO-861 R1/R3).
 * While `active` (the Build / Review steps) it polls the on-chain price every 15s via
 * {@link getPoolCurrentPriceAction} — the SAME `fetchDexPoolState` source the create-pool mint reads,
 * so the builder's displayed price and its seed-side decision match what the mint will see — and it
 * exposes `refresh()` to force a read on the Build->Review transition (R1). Seeded with the selection
 * price so it is never null on first paint, and it keeps the last known price on a failed / null read.
 *
 * Mock-safe: in mock mode it is a no-op that just echoes the seed (no polling, no server action), since
 * mock mode never mints on-chain. `isMockMode` is a build-time constant, so the hook order is stable.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isMockMode } from "@/lib/services";
import { getPoolCurrentPriceAction } from "../actions";

/** Poll cadence for the live builder price (POO-861 R1) — aligned with the 15s paired-amount cache. */
export const LIVE_POOL_PRICE_REFRESH_MS = 15_000;

/** Inputs for {@link useLivePoolPrice} — the selected pool's identity + the poll gate. */
export interface UseLivePoolPriceInput {
  /** API network slug of the selected pool. */
  network?: string;
  /** token0 (currency0) address. */
  currency0?: string;
  /** token1 (currency1) address. */
  currency1?: string;
  /** Raw Uniswap fee tier (e.g. 500) — the single-pool state read is keyed on it. */
  feeTier?: number;
  /** The selection price, used as the seed + the reset target when the pool changes. */
  initialPrice?: number;
  /** Poll only while true (the Build / Review steps). */
  active: boolean;
}

/** The live price + a manual refresh handle. */
export interface UseLivePoolPriceResult {
  /** Latest known price (seeded with `initialPrice`; updated by polling / refresh). */
  price: number | null;
  /** Force an immediate refresh (e.g. on the Build->Review transition). No-op in mock mode. */
  refresh: () => void;
}

/** Keeps the builder's selected-pool price fresh (real mode); a seed-echoing no-op in mock mode. */
export function useLivePoolPrice(input: UseLivePoolPriceInput): UseLivePoolPriceResult {
  const { network, currency0, currency1, feeTier, initialPrice, active } = input;
  const [price, setPrice] = useState<number | null>(initialPrice ?? null);

  // Latest params + seed in refs so refresh()/the interval read current values without re-subscribing.
  const paramsRef = useRef({ network, currency0, currency1, feeTier });
  paramsRef.current = { network, currency0, currency1, feeTier };
  const initialRef = useRef(initialPrice);
  initialRef.current = initialPrice;

  // Reset to the newly-selected pool's price when the pool identity changes (a Back-and-repick), so a
  // stale live price from the previous pool never bleeds across.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keys on the pool identity only.
  useEffect(() => {
    setPrice(initialRef.current ?? null);
  }, [network, currency0, currency1, feeTier]);

  const refresh = useCallback(async () => {
    if (isMockMode) return;
    const p = paramsRef.current;
    if (!p.network || !p.currency0 || !p.currency1 || p.feeTier == null) return;
    try {
      const result = await getPoolCurrentPriceAction({
        network: p.network,
        currency0: p.currency0,
        currency1: p.currency1,
        feeTier: p.feeTier,
      });
      // Keep the last known price on a null read (404 / transient) rather than blanking the UI.
      if (result) setPrice(result.currentPrice);
    } catch {
      // Network hiccup: keep the last known price.
    }
  }, []);

  // Poll every 15s while active + the pool is resolvable. No immediate fetch on mount — the selection
  // price is already fresh; the Build->Review refresh() forces a read when staleness matters most.
  useEffect(() => {
    if (isMockMode || !active) return;
    if (!network || !currency0 || !currency1 || feeTier == null) return;
    const id = setInterval(refresh, LIVE_POOL_PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [active, network, currency0, currency1, feeTier, refresh]);

  return { price, refresh };
}
