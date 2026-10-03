/**
 * @id PP-MGR-HOK-007 (POO-2133)
 * @name useV2MandateCatalog
 * @implements-rules-version v1
 * Real-mode catalog loading with cancellation and explicit retry, never mock fallback.
 */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCatalogReservesAction, getCatalogTokensAction } from "@/lib/api/v2/actions";
import type { CatalogReserve, CatalogToken } from "@/lib/api/v2/schemas";
import { isMockMode } from "@/lib/services";
import { buildMandateCatalog } from "./mandateCatalog";
import { buildRealCatalog } from "./v2Mandate";

export function useV2MandateCatalog() {
  const [state, setState] = useState<{
    tokens: CatalogToken[];
    reserves: CatalogReserve[];
    loading: boolean;
    error: boolean;
  }>({ tokens: [], reserves: [], loading: !isMockMode, error: false });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (isMockMode || attempt < 0) return;
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: false }));
    Promise.all([
      getCatalogTokensAction(42161),
      getCatalogTokensAction(4663),
      getCatalogReservesAction(),
    ])
      .then(([hub, spoke, aave]) => {
        if (cancelled) return;
        if (!hub.ok || !spoke.ok || !aave.ok) {
          setState({ tokens: [], reserves: [], loading: false, error: true });
          return;
        }
        setState({
          tokens: [...hub.data.tokens, ...spoke.data.tokens],
          reserves: aave.data.reserves,
          loading: false,
          error: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ tokens: [], reserves: [], loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return useMemo(() => {
    if (isMockMode) return buildMandateCatalog();
    const catalog = buildRealCatalog(state.tokens, state.reserves);
    return {
      ...catalog,
      loading: state.loading,
      error: state.error,
      retry,
      validateDraft: (draft: import("./mandateDraft").MandateDraft) =>
        !state.loading && !state.error && (catalog.validateDraft?.(draft) ?? false),
    };
  }, [state, retry]);
}
