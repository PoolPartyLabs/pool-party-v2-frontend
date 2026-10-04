/**
 * @id PP-MGR-LIB-054
 * @name useManagePosition
 * @implements-rules-version v1 (POO-2227)
 * @analytics-events none (the panel reports read errors)
 */
"use client";
import { useCallback, useEffect, useState } from "react";
import { loadManagePositionAction } from "@/lib/api/v2/manageActions";
import type { ManagePosition } from "@/lib/api/v2/manageSchemas";
export const MANAGE_READ_TIMEOUT_MS = 30_000;
export function useManagePosition(
  core: string,
  chainId: number,
  positionKey: string,
  active: boolean,
) {
  const identity = `${core.toLowerCase()}:${chainId}:${positionKey.toLowerCase()}`;
  const [revision, setRevision] = useState(0);
  const requestIdentity = `${identity}:${revision}`;
  const [state, setState] = useState<{
    identity: string;
    request: string;
    status: "loading" | "ready" | "error";
    position: ManagePosition | null;
    error: string | null;
  }>({ identity, request: requestIdentity, status: "loading", position: null, error: null });
  useEffect(() => {
    if (!active) return;
    let live = true;
    const fail = (error: string) => {
      if (!live) return;
      setState((previous) => ({
        identity,
        request: requestIdentity,
        status: "error",
        position: previous.identity === identity ? previous.position : null,
        error,
      }));
    };
    const timer = setTimeout(() => {
      fail("MANAGE_READ_TIMEOUT");
      live = false;
    }, MANAGE_READ_TIMEOUT_MS);
    setState((previous) => ({
      identity,
      request: requestIdentity,
      status: "loading",
      position: previous.identity === identity ? previous.position : null,
      error: null,
    }));
    // PP-INTEGRATION-POINT: ownership-checked V2 detail; retain same-position display on failed refresh, never enable stale actions.
    void loadManagePositionAction(core, chainId, positionKey)
      .then((result) => {
        if (!live) return;
        clearTimeout(timer);
        if (result.ok)
          setState({
            identity,
            request: requestIdentity,
            status: "ready",
            position: result.data.position,
            error: null,
          });
        else fail(result.error.code);
      })
      .catch(() => {
        clearTimeout(timer);
        fail("SYSTEM_UNAVAILABLE");
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [core, chainId, positionKey, identity, requestIdentity, active]);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const view =
    state.identity === identity
      ? state
      : {
          identity,
          request: requestIdentity,
          status: "loading" as const,
          position: null,
          error: null,
        };
  return {
    ...view,
    status: state.request === requestIdentity ? view.status : ("loading" as const),
    retry,
  };
}
