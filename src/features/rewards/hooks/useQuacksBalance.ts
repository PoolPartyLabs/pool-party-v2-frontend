/**
 * @id PP-CORE-HOK-014 (POO-209)
 * @name useQuacksBalance
 * @implements-rules-version v1
 *
 * Client hook feeding the header Quacks pill (RewardsPill). Returns the user's real Quacks balance
 * via the getQuacksBalanceAction Server Action, replacing the old hardcoded value. Mock mode loads
 * immediately (matches the Rubber Rush screen's mock); real mode waits for the SIWE session, since
 * the wallet is derived server-side. Returns null while loading, 0 on failure or no wallet.
 */
"use client";

import { useEffect, useState } from "react";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import { getQuacksBalanceAction } from "../actions";

/** The user's current Quacks balance, or null while it loads. */
export function useQuacksBalance(): number | null {
  const { isSignedIn, status } = useSiweSession();
  const [quacks, setQuacks] = useState<number | null>(null);

  useEffect(() => {
    // Real mode needs the signed-in wallet (derived server-side); mock mode has no such gate.
    if (!isMockMode) {
      if (status === "error") {
        setQuacks(0);
        return;
      }
      if (!isSignedIn) {
        setQuacks(null);
        return;
      }
    }
    let active = true;
    getQuacksBalanceAction()
      .then((next) => {
        if (active) setQuacks(next);
      })
      .catch(() => {
        if (active) setQuacks(0);
      });
    return () => {
      active = false;
    };
  }, [isSignedIn, status]);

  return quacks;
}
