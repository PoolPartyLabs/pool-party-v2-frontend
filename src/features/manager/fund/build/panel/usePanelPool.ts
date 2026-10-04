/**
 * @id PP-MGR-HOK-012
 * @name usePanelPool
 * @implements-rules-version v1 (POO-2185 rules v1, slice PC of POO-2171)
 * @analytics-events none (data hooks): a read. The panel's own events (the pool pick, the read that
 *   failed, the leave that was blocked) belong to the panel slices, which own the screen.
 *
 * The live read of ONE Uniswap v4 pool for the Build configuration panel (handoff v1.2, P13): it reads
 * on mount and again {@link LIVE_POOL_PRICE_REFRESH_MS} (15 s) after each read settles, while the panel
 * is open, and maps each answer to the panel's view (`toPanelPoolView`, PP-MGR-LIB-031). The pool LIST
 * needs no fetch (it is the mandate's own pools, `panelPoolsFor`); this is the one read nobody else
 * provides: `mapV2Pool` drops the tick, the sqrt price and the decimals, and `useLivePoolPrice` is
 * keyed by a v3 fee tier and cannot read a v4 pool.
 *
 * - **`applicable` is the gate.** Use and Apply stay disabled unless `applicable` is true: the LAST read
 *   succeeded, it is for THIS pool, and the pool is eligible with active liquidity (P13: "Apply stays
 *   disabled while a value it depends on is missing"). `pool` alone is not that gate: it is the last
 *   good read of this pool, kept for DISPLAY while a refresh fails or a retry is in flight, and so may be
 *   stale or ineligible. `status` and `error` explain why `applicable` is false.
 * - **Reads never overlap.** The next read is armed only after the previous one settles (a `setTimeout`
 *   chain, not an interval), so a read slower than the interval still lands: the server's own timeout is
 *   15 s, and an answer that arrived just after the next poll was issued used to be dropped, for ever.
 *   A read that never settles ends as a `PANEL_READ_TIMEOUT` error after {@link PANEL_READ_TIMEOUT_MS},
 *   so a panel is never left loading with no retry.
 * - **One pool at a time.** The state is keyed by chain and pool. An answer is applied only if the
 *   effect that asked for it is still current, so a slow answer for the pool the manager just left (or
 *   for a retry that has since restarted) never overwrites what is on screen, and a new pool never
 *   shows a render of the old one.
 * - **Idle with no pool.** A null `poolId` (an empty block still picking) reads nothing and arms no
 *   timer; hooks cannot be called conditionally, so this is how a panel mounts it before a pool exists.
 * - **Stops with the panel.** The pending timer and any in-flight answer end on unmount.
 * - **Errors surface, with a retry; real mode never falls back to a fixture** (P13, hard rule: no mock
 *   in real mode). A failed REFRESH keeps the last good view but the status is "error" and
 *   `refreshedAt` stays at that read; the next successful read clears it by itself. A retry clears the
 *   error at once and reads again.
 * - **The answer is checked against the request.** In real mode a pool answered for another PoolId or
 *   chain than the one asked for is an invalid response, never shown under the requested key.
 * - **Only a bare PoolId reaches the API.** `config.poolId` holds the bare bytes32 PoolId (decision
 *   A1), and the action accepts nothing else. A composite row id (`<chainId>:<poolId>`) or a mock slug
 *   in real mode is answered with `INVALID_POOL_ID` right here, naming the mistake instead of paying
 *   a round trip for a 502.
 *
 * Mock mode serves the PP-MGR-MCK-005 fixtures with no network, after a plausible round trip and with
 * the usual rare failure, so the panel has a skeleton and an error state to show in design review.
 * Every hookless pool a mock mandate can hold has a fixture; an id with none is a not-found, and the
 * mock never invents a pool.
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

/**
 * How long one read may take before it is given up as a timeout: twice the poll interval. The v2
 * client aborts at 15 s on its own; the rest is for server actions queued behind others (Next runs
 * them one at a time) and the trip back.
 */
export const PANEL_READ_TIMEOUT_MS = 2 * LIVE_POOL_PRICE_REFRESH_MS;

/** Why a read failed: the HTTP-like status and the machine code the action (or this hook) answered. */
export interface PanelReadError {
  status: number;
  code: string;
}

/**
 * Idle: no pool to read. Loading: no read has landed for this pool yet, or a retry is in flight.
 * Ready: the latest read succeeded. Error: the latest read failed (see `error`).
 */
export type PanelPoolStatus = "idle" | "loading" | "ready" | "error";

/** What {@link usePanelPool} returns. */
export interface UsePanelPoolResult {
  /**
   * The last good read of THIS pool, or null before the first one. Never another pool's. For
   * DISPLAY: it may be stale (a refresh failed or a retry is in flight) or ineligible. Gate Use and
   * Apply on `applicable`, never on `pool !== null`.
   */
  pool: PanelPoolView | null;
  status: PanelPoolStatus;
  /** The latest read's failure; null unless `status` is "error". */
  error: PanelReadError | null;
  /** Read again now, from an error or any time. Clears the error at once and resets the schedule. */
  retry: () => void;
  /** When the last successful read landed, as `Date.now()` milliseconds; null before the first. */
  refreshedAt: number | null;
  /**
   * True only when the latest read succeeded, is for this pool, and the pool is eligible with active
   * liquidity. Use and Apply require it (P13).
   */
  applicable: boolean;
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
      const fixture = findPanelPoolFixture(chainId, poolId);
      if (!fixture) return failure(404, "V2_NOT_FOUND");
      catalogPool = fixture;
    } catch {
      return failure(503, "MOCK_UNAVAILABLE");
    }
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
    const view = toPanelPoolView(catalogPool);
    // The answer must be for what was asked: a mock slug has no PoolId to compare, but the chain holds.
    if (view.chainId !== chainId || (!isMockMode && view.poolId !== poolId.toLowerCase())) {
      return failure(502, "V2_INVALID_RESPONSE");
    }
    return { ok: true, pool: view };
  } catch {
    return failure(502, "V2_INVALID_RESPONSE");
  }
}

/** {@link readPanelPool} with a watchdog: a read that never settles becomes a timeout error. */
async function readWithin(chainId: V2ChainId, poolId: string): Promise<PoolRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PoolRead>((resolve) => {
    timer = setTimeout(() => resolve(failure(504, "PANEL_READ_TIMEOUT")), PANEL_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readPanelPool(chainId, poolId), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface ReadState {
  /** `chainId:poolId`: what the rest of the state is about. Null when there is no pool to read. */
  key: string | null;
  pool: PanelPoolView | null;
  error: PanelReadError | null;
  refreshedAt: number | null;
  status: PanelPoolStatus;
}

const IDLE_STATE: ReadState = {
  key: null,
  pool: null,
  error: null,
  refreshedAt: null,
  status: "idle",
};

function loadingState(key: string): ReadState {
  return { key, pool: null, error: null, refreshedAt: null, status: "loading" };
}

/**
 * Keeps one Uniswap v4 pool's live view fresh while the calling panel is mounted.
 *
 * @param chainId The pool's chain (42161 hub, 4663 Robinhood Chain).
 * @param poolId The bare v4 PoolId (a mock slug in mock mode), or null while no pool is picked.
 */
export function usePanelPool(chainId: V2ChainId, poolId: string | null): UsePanelPoolResult {
  const key = poolId === null ? null : `${chainId}:${poolId}`;
  const [state, setState] = useState<ReadState>(() =>
    key === null ? IDLE_STATE : loadingState(key),
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only restarts the schedule (retry); `key` is derived from chainId and poolId.
  useEffect(() => {
    if (poolId === null || key === null) {
      // Nothing to read, and nothing of an earlier pool is kept: coming back starts from nothing.
      setState(IDLE_STATE);
      return;
    }
    const id = poolId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A new pool starts from nothing. The same pool (a retry) keeps its last good read for display,
    // and an error goes back to loading with the error cleared while the retry is in flight.
    setState((previous) =>
      previous.key !== key
        ? loadingState(key)
        : previous.status === "error"
          ? { ...previous, status: "loading", error: null }
          : previous,
    );

    const read = async () => {
      const result = await readWithin(chainId, id);
      // Dropped when the panel moved on: another pool, unmount, or a retry that restarted the effect.
      if (cancelled) return;
      if (result.ok) {
        setState({
          key,
          pool: result.pool,
          error: null,
          refreshedAt: Date.now(),
          status: "ready",
        });
      } else {
        setState((previous) => ({
          key,
          pool: previous.key === key ? previous.pool : null,
          error: result.error,
          refreshedAt: previous.key === key ? previous.refreshedAt : null,
          status: "error",
        }));
      }
      // The next read starts only now that this one has settled, so reads never overlap.
      timer = setTimeout(read, LIVE_POOL_PRICE_REFRESH_MS);
    };

    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [chainId, poolId, key, attempt]);

  // The render for a new pool never shows the previous pool, even before the effect resets the state.
  const view = state.key === key ? state : key === null ? IDLE_STATE : loadingState(key);
  return {
    pool: view.pool,
    status: view.status,
    error: view.error,
    retry,
    refreshedAt: view.refreshedAt,
    applicable:
      view.status === "ready" &&
      view.pool !== null &&
      view.pool.eligible &&
      view.pool.hasActiveLiquidity,
  };
}
