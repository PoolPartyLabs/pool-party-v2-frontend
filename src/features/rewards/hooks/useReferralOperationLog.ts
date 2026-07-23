/**
 * @id PP-REW (POO-853)
 * @name useReferralOperationLog
 * @implements-rules-version v1
 *
 * Logs a referred wallet's confirmed protocol tx to the referral operation feed (POO-853 [R6]) — the
 * client twin of {@link useGrantDuckShootTry}. Returns a fire-and-forget `log(input)` callback:
 *   - real-mode only (the referral operation endpoint has no mock counterpart; mock mode no-ops);
 *   - dedups logged tx hashes in localStorage (capped) so an effect re-render never double-posts the
 *     same operation (the backend also dedups on txHash, so this is best-effort);
 *   - never blocks or fails the tx UX — the server action swallows its own errors, and the RPC
 *     transport rejection is caught here.
 * The referee wallet + the referrer code are derived server-side from the SIWE session inside
 * `logReferralOperationAction` (so this hook stays Privy-free and can be called from any operation
 * modal's success effect); a non-referred wallet no-ops server-side.
 */
"use client";

import { useCallback } from "react";
import type { LogReferralOperationInput } from "@/lib/rewards/logReferralOperation";
import { isMockMode } from "@/lib/services";
import { logReferralOperationAction } from "../actions";

/** localStorage key for the client-side dedup of already-logged operation tx hashes. */
const LOGGED_OPS_KEY = "pp.referral.loggedOps";
/** Cap the dedup list so localStorage can't grow unbounded. */
const DEDUP_CAP = 200;

function readLogged(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOGGED_OPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function persistLogged(txHash: string): void {
  if (typeof window === "undefined") return;
  const existing = readLogged();
  if (existing.includes(txHash)) return;
  const next = [...existing, txHash].slice(-DEDUP_CAP);
  try {
    window.localStorage.setItem(LOGGED_OPS_KEY, JSON.stringify(next));
  } catch {
    // localStorage full / unavailable — dedup degrades to the backend's txHash dedup.
  }
}

/** Returns a `log(input)` callback that records a referred wallet's confirmed operation. */
export function useReferralOperationLog(): (input: LogReferralOperationInput) => void {
  return useCallback((input) => {
    // Real mode only; needs a hash; skip an operation already logged this session/device.
    if (isMockMode || !input.txHash) return;
    if (readLogged().includes(input.txHash)) return;
    // Optimistic dedup: mark before firing so an effect re-render can't double-post. Best-effort — a
    // transport failure simply skips this audit log (a later tx logs its own; the count is unaffected).
    persistLogged(input.txHash);
    void logReferralOperationAction(input).catch(() => {
      // Fire-and-forget: a thrown action (network / no session) never becomes an unhandled rejection.
    });
  }, []);
}
