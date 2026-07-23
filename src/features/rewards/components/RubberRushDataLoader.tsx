/**
 * @id PP-REW-SCR-001 (POO-209)
 * @name Rubber Rush data loader
 * @implements-rules-version v1
 *
 * Real-mode client boundary for the Rubber Rush dashboard. Reads the connected
 * wallet address (Privy, client-side), calls the getRubberRushAction Server
 * Action (which runs the analytics reads server-side), and renders the screen.
 * Used only when isMockMode is false; in mock mode the route SSRs the mock
 * directly. Shows the shared skeleton until data resolves; a real failure
 * (network / parse / 5xx) bubbles to the route error boundary.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import type { RubberRush } from "@/lib/schemas";
import { getRubberRushAction } from "../actions";
import { RubberRushScreen } from "../RubberRushScreen";
import { RubberRushSkeleton } from "./RubberRushSkeleton";

/** Fetches the Rubber Rush dashboard for the signed-in wallet and renders it. */
export function RubberRushDataLoader() {
  const { isSignedIn, status } = useSiweSession();
  const [data, setData] = useState<RubberRush | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (status === "error") {
      setError(new Error("Could not establish a wallet session"));
      return;
    }
    if (!isSignedIn) {
      setData(null);
      setError(null);
      return;
    }

    let active = true;
    setData(null);
    setError(null);
    getRubberRushAction()
      .then((next) => {
        if (active) setData(next);
      })
      .catch((err) => {
        if (active) setError(err);
      });
    return () => {
      active = false;
    };
  }, [isSignedIn, status]);

  // POO-546 R1: refetch in place (never blank back to the skeleton) after a Say Quack check-in, so
  // the Quacks balance + quackedToday reflect the backend credit without a manual reload. A refresh
  // failure is swallowed on purpose: the award already succeeded, so keep the current data on screen
  // rather than throwing the whole page to the error boundary over a transient post-write read.
  const refresh = useCallback(() => {
    if (!isSignedIn) return;
    getRubberRushAction()
      .then(setData)
      .catch(() => {});
  }, [isSignedIn]);

  // Surface real failures to the nearest error boundary (404s already degrade
  // to a zero-state inside fetchRubberRush, so they never reach here).
  if (error) throw error;
  if (!data) return <RubberRushSkeleton />;
  return <RubberRushScreen data={data} onRefresh={refresh} />;
}
