/**
 * @id PP-CORE-LIB-046
 * @name useWalletFinancials
 * @implements-rules-version v1
 *
 * Real-mode client hook for the connected wallet's C1 ledger financials (POO-932 /financials), read via
 * getWalletFinancialsAction once the SIWE session is up.
 *
 * PP-CORE-LIB-048 (POO-990, legacy excision): the `financialsV2` FLAG gate was removed — the C1
 * `/financials` payload is now the SOLE money source in real mode, read UNCONDITIONALLY (there is no
 * legacy `/metrics` path left to fall back to). Returns the parsed {@link WalletFinancials}, or null
 * while loading / not signed in / mock mode / a read that is unavailable. A null return means
 * "financials unavailable → render the money KPIs as unavailable" (NEVER a legacy number); a non-null
 * payload with a NULL field means "financials present, this field is honest-absent → render unavailable"
 * ([R5], resolved by the view models). Mock-safe: mock mode never reads (the view models use the mock
 * tables). No retry/last-good machinery — a later session change re-runs the effect.
 *
 * PP-INTEGRATION-POINT: investor financials ← analytics `/wallets/:addr/financials` (POO-932).
 */
"use client";

import { useEffect, useState } from "react";
import { getWalletFinancialsAction } from "@/features/home/actions";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import type { WalletFinancials } from "./financialsSchema";

/**
 * The signed-in wallet's financials, or null while loading / not signed in / mock mode / an unavailable
 * read. Hooks run unconditionally (the mock gate lives inside the effect and the return, not as an early
 * return) so the hook order is stable every render.
 */
export function useWalletFinancials(): WalletFinancials | null {
  const { isSignedIn, status } = useSiweSession();
  const [financials, setFinancials] = useState<WalletFinancials | null>(null);

  useEffect(() => {
    // Mock mode: never read — the view models use the mock tables (design harness).
    if (isMockMode) {
      setFinancials(null);
      return;
    }
    // Not (yet / ever) signed in, or a failed SIWE handshake: no wallet to read → stay null.
    if (status === "error" || !isSignedIn) {
      setFinancials(null);
      return;
    }
    let active = true;
    getWalletFinancialsAction()
      .then((next) => {
        if (active) setFinancials(next);
      })
      .catch(() => {
        // The action coalesces upstream failures to null; a thrown invocation (network blip) is still
        // non-fatal — the consumers render the money KPIs as unavailable (never a legacy figure).
        if (active) setFinancials(null);
      });
    return () => {
      active = false;
    };
  }, [isSignedIn, status]);

  return isMockMode ? null : financials;
}
