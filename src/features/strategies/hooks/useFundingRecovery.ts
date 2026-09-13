/**
 * @id PP-STR-HOK-021 (POO-1055)
 * @name useFundingRecovery
 * @implements-rules-version v2 (POO-1507 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Mounts the READING half of the funding recovery journal (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md`
 * §3). POO-1038 wrote {@link findResumableJournal} and {@link reconcileJournal}; POO-1043 made sure
 * records get written. Until this hook, neither reader had a non-test caller, so a user whose tab
 * died mid-bridge had a correct, durable record of exactly what happened and nothing that ever
 * looked at it. That is the difference between designing for recovery and recovering.
 *
 * ## What it does, and pointedly what it does not
 *
 * On session entry it finds the in-flight route for the CONNECTED wallet, reconciles it against the
 * chain, and persists the corrections. It is a read, from beginning to end: {@link ChainReader} has
 * three read methods and no way to send anything, so "an ambiguous state is never resolved by
 * broadcasting" (§3.5 rule 1) is enforced by the type rather than by discipline.
 *
 * **Nothing auto-broadcasts on load** (§3.5 rule 3). The hook produces a surfaced state and the user
 * presses something. The only forward path it can offer is re-derivation from fresh balances, which
 * is correct however an ambiguity resolves: a plan is a pure function of current holdings (§3.1), so
 * a leg that already executed is simply not in the re-derived plan.
 *
 * **A journal for another account is never touched** (§3.5 rule 2): that filter lives in
 * {@link findResumableJournal} and account switching mid-bridge is ordinary user behaviour.
 *
 * ## Lifecycle
 *
 * Retirement is the store's own rule, not a second one here: a journal whose legs are all terminal
 * is pruned on the next read, so a route that turns out to have completed while the tab was closed
 * disappears by being reconciled, with nothing extra to keep in sync. Records past
 * {@link JOURNAL_MAX_AGE_MS} go the same way. {@link FundingRecovery.abandon} is the user's explicit
 * exit (§3.7) for a route that is resolved but not resumable.
 *
 * Mock-safe like every other real-seam hook in this folder: in mock mode there is no wallet, no RPC
 * and no journal, and this stays inert.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { reportClientError } from "@/lib/observability/reportClientError";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
import { isMockMode } from "@/lib/services";
// PP-INTEGRATION-POINT: the per-chain RPC reads behind the §3.5 decision table. Each takes its own
// `chainId` because a funding route spans chains and the wallet provider only answers for the one it
// is currently on.
import {
  readErc20Balance,
  readNativeBalance,
  readTransactionCount,
  readTransactionReceiptStatus,
} from "@/lib/tokens/readErc20";
import type { FundingJournal } from "../lib/fundingJournal";
import { findResumableJournal, retireJournal } from "../lib/fundingJournal";
import type { ChainReader, JournalReconciliation } from "../lib/reconcileFundingJournal";
import { applyReconciliation, reconcileJournal } from "../lib/reconcileFundingJournal";

/** What the recovery surface renders from. */
export interface FundingRecovery {
  /** The in-flight route for the connected wallet, or null when there is nothing to recover. */
  journal: FundingJournal | null;
  /** The §3.5 verdicts, or null while the chain reads are still running. */
  reconciliation: JournalReconciliation | null;
  /** True while those reads are in flight. */
  isChecking: boolean;
  /** Re-run the reads. A bridge lands minutes after the page did, so this is a real affordance. */
  recheck: () => void;
  /** The user abandons the route: the record is deleted and the surface goes away (§3.7). */
  abandon: () => void;
}

/** Nothing to recover. Also the whole of mock mode. */
const NOTHING = { journal: null, reconciliation: null } as const;

/**
 * POO-1507 [D5]: `Stop anyway` on the funding panel's mid-run confirmation closes that surface and
 * wants the app-wide banner to reflect the interruption immediately, rather than waiting for the
 * next load. `useFundingRecovery` is a single instance mounted once in `AppShell`, with no ref the
 * panel — far away in the tree, and sometimes a different bundle chunk entirely — could hold, so the
 * signal travels as a window event: the same decoupling `pp:consent` already uses in
 * `src/lib/analytics/consent.ts` for an identical shape, one writer far from its one reader.
 */
const RECOVERY_RECHECK_EVENT = "pp:funding-recovery-recheck";

/**
 * Ask the mounted recovery surface to re-read the journal right now. A no-op with nothing listening
 * (no wallet connected, or the banner not yet mounted) — the next mount picks the record up anyway,
 * this only removes the wait for one.
 */
export function requestFundingRecoveryRecheck(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(RECOVERY_RECHECK_EVENT));
}

/**
 * The chain, as three reads.
 *
 * Module-level because it closes over nothing: every call carries its own chain id and address, so
 * there is no per-render state to rebuild. A bridge always delivers an ERC-20 (USDC is the Across
 * asset, §1.2) but a `swap-gas` leg's output is the native coin, addressed as `0x0…0` by the planner
 * and the Trading API alike, so the balance read routes on that rather than issuing an ERC-20 call
 * that would revert.
 */
const chainReader: ChainReader = {
  getTransactionReceipt: ({ chainId, txHash }) =>
    readTransactionReceiptStatus(txHash as `0x${string}`, chainId),
  getTransactionCount: ({ chainId, address }) =>
    readTransactionCount(address as `0x${string}`, chainId),
  getTokenBalance: async ({ chainId, token, owner }) => {
    const holder = owner as `0x${string}`;
    const raw =
      token.toLowerCase() === NATIVE_TOKEN_ADDRESS
        ? await readNativeBalance(holder, chainId)
        : await readErc20Balance(token as `0x${string}`, holder, chainId);
    return raw.toString();
  },
};

/** The mounted recovery surface's data source. Inert in mock mode and while signed out. */
export function useFundingRecovery(): FundingRecovery {
  const { address } = useAuth();
  const [state, setState] = useState<{
    journal: FundingJournal | null;
    reconciliation: JournalReconciliation | null;
  }>(NOTHING);
  const [isChecking, setIsChecking] = useState(false);
  // Bumped by `recheck`. A counter rather than a boolean so consecutive re-checks each re-run.
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an intentional re-check trigger — bumping it re-runs the reads though the body doesn't read it.
  useEffect(() => {
    if (isMockMode || !address) {
      setState(NOTHING);
      setIsChecking(false);
      return;
    }
    const found = findResumableJournal(address);
    if (!found) {
      setState(NOTHING);
      setIsChecking(false);
      return;
    }

    // Show the route immediately and the verdicts when they land. A user returning to an in-flight
    // bridge should not stare at an empty page while three RPC round-trips complete.
    setState({ journal: found, reconciliation: null });
    setIsChecking(true);

    let cancelled = false;
    void (async () => {
      let reconciliation: JournalReconciliation | null = null;
      try {
        reconciliation = await reconcileJournal(found, chainReader);
        applyReconciliation(reconciliation);
      } catch (error) {
        // Every individual read is already guarded inside the reconciler, so reaching here means
        // something structural. Leaving the record untouched and surfaced is the safe failure: the
        // in-flight fact that stops a double broadcast is exactly what must not be lost.
        // POO-243: "something structural" on the path that stops a double broadcast is exactly the
        // failure that must not be invisible. No journal contents are sent, only the failure class.
        reportClientError("funding.journal_reconcile_failed", error);
      }
      if (cancelled) return;
      // Re-read rather than reuse `found`: the apply may have retired the route entirely (every leg
      // settled means the store prunes it), and a stale in-memory copy would keep rendering a route
      // that is finished.
      const after = findResumableJournal(address);
      setState({ journal: after, reconciliation: after ? reconciliation : null });
      setIsChecking(false);
    })();

    // The wallet can change (or disconnect) while the reads are in flight, and a late response must
    // never land on another account's surface.
    return () => {
      cancelled = true;
    };
  }, [address, attempt]);

  const recheck = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  // POO-1507 [D5]: the same re-read `recheck` triggers, fired from outside this hook's own tree.
  useEffect(() => {
    window.addEventListener(RECOVERY_RECHECK_EVENT, recheck);
    return () => window.removeEventListener(RECOVERY_RECHECK_EVENT, recheck);
  }, [recheck]);

  const journalId = state.journal?.journalId ?? null;
  const abandon = useCallback(() => {
    if (journalId === null) return;
    retireJournal(journalId);
    setState(NOTHING);
  }, [journalId]);

  return { ...state, isChecking, recheck, abandon };
}
