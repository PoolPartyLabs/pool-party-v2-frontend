/**
 * @id PP-MGR-HOK-012
 * @name usePanelPool
 * @implements-rules-version v1 (POO-2185 rules v1, slice PC of POO-2171)
 * @analytics-events none (data hooks): a read. The panel's own events (the pool pick, the read that
 *   failed, the leave that was blocked) belong to the panel slices, which own the screen.
 *
 * The live read of ONE Uniswap v4 pool for the Build configuration panel (handoff v1.2, P13): it
 * reads on mount and again every {@link LIVE_POOL_PRICE_REFRESH_MS} (15 s) while the panel is open,
 * and maps each answer to the panel's view (`toPanelPoolView`, PP-MGR-LIB-031). The pool LIST needs no
 * fetch (it is the mandate's own pools, `panelPoolsFor`); this is the one read nobody else provides:
 * `mapV2Pool` drops the tick, the sqrt price and the decimals, and `useLivePoolPrice` is keyed by a v3
 * fee tier and cannot read a v4 pool.
 *
 * - **One pool at a time.** The state is keyed by chain and pool. An answer is applied only if its
 *   read was the latest one issued for the CURRENT key, so a slow answer for the pool the manager
 *   just left (or an older read that overtook a newer one) never overwrites what is on screen, and a
 *   new pool never shows a render of the old one.
 * - **Stops with the panel.** The interval and any in-flight answer end on unmount.
 * - **Errors surface, with a retry; real mode never falls back to a fixture** (P13, hard rule: no mock
 *   in real mode). A failed REFRESH keeps the last good view (`pool` is the last good read of this
 *   pool) but the status is "error" and `refreshedAt` stays at that read, so the panel decides what
 *   to do with a number it can no longer vouch for; the next successful poll clears it by itself.
 * - **Only a bare PoolId reaches the API.** `config.poolId` holds the bare bytes32 PoolId (decision
 *   A1), and the action accepts nothing else. A composite row id (`<chainId>:<poolId>`) or a mock slug
 *   in real mode is answered with `INVALID_POOL_ID` right here, naming the mistake instead of paying
 *   a round trip for a 502.
 *
 * Mock mode serves the PP-MGR-MCK-005 fixtures with no network, after a plausible round trip and with
 * the usual rare failure, so the panel has a skeleton and an error state to show in design review. An
 * id with no fixture is a not-found; the mock never invents a pool.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { LIVE_POOL_PRICE_REFRESH_MS } from "@/features/manager/hooks/useLivePoolPrice";
import { getCatalogPoolAction } from "@/lib/api/v2/actions";
import type { CatalogPool, V2ChainId } from "@/lib/api/v2/schemas";
import { isMockMode } from "@/lib/services";
import {
  findPanelPoolFixture,
  PANEL_MOCK_FAILURE_RATE,
  PANEL_MOCK_LATENCY_MS,
} from "@/mocks/data/buildPanelFixtures";
import { simulateDelay, simulateError } from "@/mocks/utils/simulate";
import { type PanelPoolView, toPanelPoolView } from "./panelCatalogView";

/** Why a read failed: the HTTP-like status and the machine code the action (or this hook) answered. */
export interface PanelReadError {
  status: number;
  code: string;
}

/** Loading: no read has landed for this pool yet (or a retry is in flight). Ready: the latest read succeeded. */
export type PanelPoolStatus = "loading" | "ready" | "error";

/** What {@link usePanelPool} returns. */
export interface UsePanelPoolResult {
  /** The last good read of THIS pool, or null before the first one. Never another pool's. */
  pool: PanelPoolView | null;
  status: PanelPoolStatus;
  /** The latest read's failure; null unless `status` is "error". */
  error: PanelReadError | null;
  /** Read again now, from an error. Resets the 15 s schedule. */
  retry: () => void;
  /** When the last successful read landed, as `Date.now()` milliseconds; null before the first. */
  refreshedAt: number | null;
}

/** A v4 PoolId: 32 bytes, the only id the catalog's single-pool read accepts. */
const BARE_POOL_ID = /^0x[0-9a-fA-F]{64}$/;

type PoolRead = { ok: true; pool: PanelPoolView } | { ok: false; error: PanelReadError };

function failure(status: number, code: string): PoolRead {
  return { ok: false, error: { status, code } };
}

/** One read of one pool, in whichever mode the app runs, never throwing. */
async function readPanelPool(chainId: V2ChainId, poolId: string): Promise<PoolRead> {
  let catalogPool: CatalogPool;
  if (isMockMode) {
    // PP-MOCK: the MCK-005 fixtures after a plausible round trip, no network. A mock-mode Pool block
    // holds the mandate's mock slug (the mock Pools step has no PoolId), so the fixture answers to it.
    try {
      await simulateDelay(PANEL_MOCK_LATENCY_MS[0], PANEL_MOCK_LATENCY_MS[1]);
      simulateError(PANEL_MOCK_FAILURE_RATE);
    } catch {
      return failure(503, "MOCK_UNAVAILABLE");
    }
    const fixture = findPanelPoolFixture(chainId, poolId);
    if (!fixture) return failure(404, "V2_NOT_FOUND");
    catalogPool = fixture;
  } else {
    if (!BARE_POOL_ID.test(poolId)) return failure(400, "INVALID_POOL_ID");
    try {
      // PP-INTEGRATION-POINT: the single-pool live read, GET /api/v2/catalog/uniswap-v4/pools/{poolId}
      // ?chainId= through `getCatalogPoolAction` (POO-2133): tick spacing, fee, decimals, current tick,
      // sqrtPriceX96 and the price in both orientations. Polled while a panel is open; no fixture fallback.
      const result = await getCatalogPoolAction(chainId, poolId);
      if (!result.ok) return failure(result.error.status, result.error.code);
      catalogPool = result.data;
    } catch {
      return failure(0, "PANEL_READ_FAILED");
    }
  }
  try {
    return { ok: true, pool: toPanelPoolView(catalogPool) };
  } catch {
    return failure(502, "V2_INVALID_RESPONSE");
  }
}

interface ReadState {
  /** `chainId:poolId`: what the rest of the state is about. */
  key: string;
  pool: PanelPoolView | null;
  error: PanelReadError | null;
  refreshedAt: number | null;
  status: PanelPoolStatus;
}

function loadingState(key: string): ReadState {
  return { key, pool: null, error: null, refreshedAt: null, status: "loading" };
}

/**
 * Keeps one Uniswap v4 pool's live view fresh while the calling panel is mounted.
 *
 * @param chainId The pool's chain (42161 hub, 4663 Robinhood Chain).
 * @param poolId The bare v4 PoolId (a mock slug in mock mode).
 */
export function usePanelPool(chainId: V2ChainId, poolId: string): UsePanelPoolResult {
  const key = `${chainId}:${poolId}`;
  const [state, setState] = useState<ReadState>(() => loadingState(key));
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only restarts the schedule (retry); `key` is derived from chainId and poolId.
  useEffect(() => {
    let cancelled = false;
    let latest = 0;
    // A new pool starts from nothing. The same pool (a retry) keeps its last good read, and an error
    // goes back to loading while the retry is in flight.
    setState((previous) =>
      previous.key !== key
        ? loadingState(key)
        : previous.status === "error"
          ? { ...previous, status: "loading" }
          : previous,
    );

    const read = async () => {
      latest += 1;
      const issued = latest;
      const result = await readPanelPool(chainId, poolId);
      // Dropped when the panel moved on (another pool, unmount, a retry) or a newer read was issued.
      if (cancelled || issued !== latest) return;
      if (result.ok) {
        setState({
          key,
          pool: result.pool,
          error: null,
          refreshedAt: Date.now(),
          status: "ready",
        });
        return;
      }
      setState((previous) => ({
        key,
        pool: previous.key === key ? previous.pool : null,
        error: result.error,
        refreshedAt: previous.key === key ? previous.refreshedAt : null,
        status: "error",
      }));
    };

    void read();
    const timer = setInterval(read, LIVE_POOL_PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chainId, poolId, key, attempt]);

  // The render for a new pool never shows the previous pool, even before the effect resets the state.
  const view = state.key === key ? state : loadingState(key);
  return {
    pool: view.pool,
    status: view.status,
    error: view.error,
    retry,
    refreshedAt: view.refreshedAt,
  };
}
