/**
 * @id PP-REW (POO-764)
 * @name useGrantDuckShootTry
 * @implements-rules-version v1
 *
 * Grants a Duck Shoot try for a confirmed protocol transaction (deposit / withdraw / collect /
 * move-range / …). In the reference every protocol tx earns a try; our tries were never granted, so
 * the game was unplayable. Returns a fire-and-forget `grant(txHash)` callback:
 *   - real-mode only (the analytics grant endpoint has no mock counterpart);
 *   - dedups granted tx hashes in localStorage (capped) so the same tx never grants twice;
 *   - retries `TX_NOT_FOUND_FOR_WALLET` a few times (the indexer usually just hasn't ingested the tx
 *     yet), and settles on granted / already-used / weekly-cap without re-granting.
 * The wallet is derived server-side from the SIWE session inside `grantDuckShootTryAction` (so this
 * hook stays Privy-free and mock-safe — it can be wired into `useWalletSignFlow` without pulling auth
 * hooks into every wallet flow); the backend decides eligibility, so the caller may pass any mined
 * hash. Wired centrally into `useWalletSignFlow` so every protocol tx grants a try. [R1][R2]
 */
"use client";

import { useCallback } from "react";
import { isMockMode } from "@/lib/services";
import { grantDuckShootTryAction } from "../actions";

/** localStorage key for the client-side dedup of already-granted tx hashes. */
const GRANTED_TXS_KEY = "pp.duckShoot.grantedTxs";
/** Delay between retries when the indexer has not yet ingested the tx. */
const RETRY_MS = 12_000;
/** Total attempts on `TX_NOT_FOUND_FOR_WALLET` (indexer lag) before giving up. */
const MAX_ATTEMPTS = 3;
/** Cap the dedup list so localStorage can't grow unbounded. */
const DEDUP_CAP = 200;

function readGranted(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GRANTED_TXS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function persistGranted(txHash: string): void {
  if (typeof window === "undefined") return;
  const existing = readGranted();
  if (existing.includes(txHash)) return;
  const next = [...existing, txHash].slice(-DEDUP_CAP);
  try {
    window.localStorage.setItem(GRANTED_TXS_KEY, JSON.stringify(next));
  } catch {
    // localStorage full / unavailable — dedup degrades to the backend's TX_ALREADY_USED guard.
  }
}

/** Returns a `grant(txHash)` callback that grants a Duck Shoot try for a confirmed protocol tx. */
export function useGrantDuckShootTry(): (txHash: string | undefined) => void {
  return useCallback((txHash) => {
    // Real mode only; needs a hash; skip a tx already granted this session/device.
    if (isMockMode || !txHash) return;
    if (readGranted().includes(txHash)) return;

    const attempt = async (n: number): Promise<void> => {
      let outcome: Awaited<ReturnType<typeof grantDuckShootTryAction>>;
      try {
        outcome = await grantDuckShootTryAction(txHash);
      } catch {
        // Fire-and-forget: a thrown action (network / no session) never becomes an unhandled
        // rejection. Don't persist, so a later tx or reload can retry naturally.
        return;
      }
      if (
        outcome.status === "granted" ||
        outcome.status === "tx_already_used" ||
        outcome.status === "weekly_cap_reached"
      ) {
        // Settled — never re-grant this tx.
        persistGranted(txHash);
        return;
      }
      if (outcome.status === "tx_not_found" && n < MAX_ATTEMPTS) {
        // The indexer likely hasn't ingested the tx yet — retry a few times before giving up.
        window.setTimeout(() => {
          void attempt(n + 1);
        }, RETRY_MS);
        return;
      }
      // error / exhausted retries: do NOT persist, so a later load or tx can retry naturally.
    };

    void attempt(1);
  }, []);
}
