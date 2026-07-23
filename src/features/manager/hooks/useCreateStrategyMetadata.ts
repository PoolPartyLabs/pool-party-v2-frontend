/**
 * @id PP-MGR-HOK-001 (POO-308 · POO-868)
 * @name useCreateStrategyMetadata
 * @implements-rules-version v1 (POO-308) · signature drop: POO-868 v2
 *
 * Client owner of the create-pool METADATA write lifecycle (POO-308, ADR POO-585), the counterpart of
 * the on-chain build-tx flow (`useCreatePool`). Mock-safe like the other operation hooks: mock mode is
 * a no-op (the mock launch still persists via managerService). POO-868 rules-v2: NEITHER write asks
 * the wallet for a signature — the create rides the SIWE session Bearer (attached server-side by the
 * action; the manager proved wallet ownership at sign-in) and the confirm's identity is derived from
 * the mint receipt by the API.
 *
 * - [R1]/[R4] `create(input)`: POSTs the metadata via `createStrategyMetadataAction`
 *   (POST /api/v2/strategies, pre-tx, session-authenticated). Returns the pending `strategyId`, or
 *   null when the session is missing/expired or the API errors, so the caller aborts the launch
 *   (nothing is on-chain yet) and offers an inline retry.
 * - [R3]/[R6] `confirm({ strategyId, txHash, blockNumber, network })`: fire-and-forget. Sets
 *   `confirmStatus: "pending"` (the badge), POSTs the txHash (`confirmStrategyOnchainAction` — the
 *   manager already signed the mint tx and the API derives the identity from the receipt), then
 *   observes POO-638 convergence — the indexed v2 `onchain.blockNumber` catching up to the mined
 *   receipt block ({@link nextConvergenceStep}) — to clear the badge to `"live"`. No receipt block ->
 *   clear on confirm ([R2] fallback).
 * - [R5] A confirm POST failure leaves the on-chain pool intact and sets `confirmStatus: "error"`;
 *   `retryConfirm()` re-runs the same confirm (never re-mints).
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isMockMode } from "@/lib/services";
import {
  confirmStrategyOnchainAction,
  createStrategyMetadataAction,
  readStrategyOnchainBlocksAction,
} from "@/lib/strategies/v2/strategiesV2Actions";
import type { StrategyMetadataInput } from "@/lib/strategies/v2/strategyMetadataSchema";
import { convergenceBackoffMs, nextConvergenceStep } from "@/lib/tx/blockConvergence";

/** The post-mine confirm/convergence state, driving the success view's pending -> live badge. */
export type ConfirmStatus = "idle" | "pending" | "live" | "error";

/** Args for {@link StrategyMetadataWriter.confirm}. */
export interface ConfirmStrategyArgs {
  /** The pending strategy id returned by {@link StrategyMetadataWriter.create}. */
  strategyId: string;
  /** The mined create-pool transaction hash. */
  txHash: string;
  /** The mined receipt block for deterministic convergence; omit to clear the badge on confirm. */
  blockNumber?: number;
  /** The pool's API network slug (the strategy's chain) — DTO-required on the confirm body. */
  network: string;
}

/** The create-pool metadata writer the Review step drives. */
export interface StrategyMetadataWriter {
  /** POST the pre-tx metadata (session-authenticated, POO-868); resolves the pending strategyId or null on failure. */
  create(input: StrategyMetadataInput): Promise<string | null>;
  /** POST the post-mine confirm (unsigned, POO-868), then converge the pending badge to live. */
  confirm(args: ConfirmStrategyArgs): void;
  /** The confirm/convergence status (idle before confirm; pending -> live; error on POST failure). */
  confirmStatus: ConfirmStatus;
  /** Re-run the last confirm after an error (non-blocking; never re-mints). */
  retryConfirm(): void;
}

/** No-op writer for mock mode (the mock launch persists via managerService, POO-599 R5). */
const MOCK_WRITER: StrategyMetadataWriter = {
  create: async () => null,
  confirm: () => {},
  confirmStatus: "idle",
  retryConfirm: () => {},
};

/** Returns the create-pool metadata writer (real signed v2 writes in real mode; no-op in mock mode). */
export function useCreateStrategyMetadata(): StrategyMetadataWriter {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
    return useMemo(() => MOCK_WRITER, []);
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>("idle");
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const lastConfirmRef = useRef<ConfirmStrategyArgs | null>(null);
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Bumped per confirm run + on unmount so a superseded / unmounted convergence tick bails.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const runIdRef = useRef(0);

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  useEffect(
    () => () => {
      runIdRef.current++;
      clearTimers();
    },
    [clearTimers],
  );

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const create = useCallback(async (input: StrategyMetadataInput): Promise<string | null> => {
    try {
      // POO-868 [R6]: no wallet interaction — the action attaches the SIWE session Bearer
      // server-side and the API takes the manager wallet from the verified JWT claim.
      return await createStrategyMetadataAction(input);
    } catch {
      // [R5] Nothing is on-chain yet — the caller aborts + offers a non-blocking inline retry.
      return null;
    }
  }, []);

  // [R6] Observe POO-638 convergence: poll the indexed v2 block for the strategy with bounded backoff
  // until it reaches the mined receipt block (or the shared cap), then clear the badge to live.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const startConvergence = useCallback((strategyId: string, blockNumber: number, runId: number) => {
    const startedAt = Date.now();
    let attempt = 0;
    const tick = async () => {
      if (runIdRef.current !== runId) return; // superseded / unmounted
      let read: number | null = null;
      try {
        const blocks = await readStrategyOnchainBlocksAction([strategyId]);
        read = blocks[strategyId] ?? null;
      } catch {
        read = null; // observe-only: no progress this tick; the cap still bounds us
      }
      if (runIdRef.current !== runId) return;
      attempt += 1;
      const step = nextConvergenceStep({
        pending: [strategyId],
        reads: { [strategyId]: read },
        targetBlock: blockNumber,
        attempt,
        elapsedMs: Date.now() - startedAt,
      });
      if (step.done) {
        setConfirmStatus("live"); // converged or capped — the backend already flipped it live
        return;
      }
      timersRef.current.push(setTimeout(tick, step.nextDelayMs));
    };
    timersRef.current.push(setTimeout(tick, convergenceBackoffMs(0)));
  }, []);

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const runConfirm = useCallback(
    async (args: ConfirmStrategyArgs) => {
      const runId = ++runIdRef.current;
      clearTimers();
      setConfirmStatus("pending");
      // POO-868 [R3]: no wallet interaction — the mint tx was already signed on-chain; the API
      // derives the manager from the receipt. network is REQUIRED by ConfirmStrategyDto.
      try {
        await confirmStrategyOnchainAction(args.strategyId, {
          txHash: args.txHash,
          network: args.network,
        });
      } catch {
        // [R5] The on-chain pool exists; surface a non-blocking retry instead of failing the launch.
        if (runIdRef.current === runId) setConfirmStatus("error");
        return;
      }
      if (runIdRef.current !== runId) return;
      if (args.blockNumber == null) {
        setConfirmStatus("live"); // [R2] no deterministic block — clear the badge on confirm
        return;
      }
      startConvergence(args.strategyId, args.blockNumber, runId);
    },
    [clearTimers, startConvergence],
  );

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const confirm = useCallback(
    (args: ConfirmStrategyArgs) => {
      lastConfirmRef.current = args;
      void runConfirm(args);
    },
    [runConfirm],
  );

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  const retryConfirm = useCallback(() => {
    if (lastConfirmRef.current) void runConfirm(lastConfirmRef.current);
  }, [runConfirm]);

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant.
  return useMemo(
    () => ({ create, confirm, confirmStatus, retryConfirm }),
    [create, confirm, confirmStatus, retryConfirm],
  );
}
