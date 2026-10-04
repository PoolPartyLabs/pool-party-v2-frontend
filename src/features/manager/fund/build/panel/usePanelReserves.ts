/**
 * @id PP-MGR-HOK-013
 * @name usePanelReserves
 * @implements-rules-version v1 (POO-2185 rules v1, slice PC of POO-2171)
 * @analytics-events none (data hooks): a selector. The Supply panel owns its own events.
 *
 * The Aave v3 Supply panel's asset list (handoff v1.2, "Pick an asset"): the catalog's reserves,
 * which `useV2MandateCatalog` already loads once, joined to the draft tokens of the panel's network
 * (`selectPanelReserves`, PP-MGR-LIB-031). Nothing is fetched here.
 *
 * - **Mandate only (P1).** A reserve whose token the mandate does not hold is not a row.
 * - **A reserve Aave cannot take is still a row**, `usable: false` with its reason (not available,
 *   inactive, frozen, paused or supply cap reached, the checks the mandate step makes), so the panel
 *   lists it disabled instead of hiding it.
 * - **Loading and error are the catalog hook's**, and so is `retry`. In mock mode the catalog hook has
 *   none, so the list is ready at once.
 * - **No fixture fallback in real mode** (P13): a failed or empty catalog is an empty list with the
 *   catalog's own error, never the MCK-005 reserves.
 * - **The hub only.** The catalog serves Aave on Arbitrum alone, so a spoke has no rows.
 *
 * PP-INTEGRATION-POINT: the reserve list is the catalog's, read once by `useV2MandateCatalog` through
 * `getCatalogReservesAction` (GET /api/v2/catalog/aave-v3/reserves, POO-2133), so the supply APY is as
 * old as that load. Re-reading it while a panel is open is an open decision (the pool's price is
 * polled; a reserve's rate is not), and would be a second call here.
 *
 * Takes the draft rather than reading it: the panel already holds it, and a hook that went to
 * storage for it would show the saved draft, not the one on screen.
 */
"use client";

import { useMemo } from "react";
import type { V2ChainId } from "@/lib/api/v2/schemas";
import { isMockMode } from "@/lib/services";
import { panelReserveFixtures } from "@/mocks/data/buildPanelFixtures";
import type { MandateDraft } from "../../mandateDraft";
import { useV2MandateCatalog } from "../../useV2MandateCatalog";
import { type PanelReserveRow, selectPanelReserves } from "./panelCatalogView";

/** What {@link usePanelReserves} returns. */
export interface UsePanelReservesResult {
  /** One row per reserve of the mandate's tokens on this chain, usable or not, in the catalog's order. */
  reserves: PanelReserveRow[];
  /** The catalog is still loading. Never true in mock mode. */
  loading: boolean;
  /** The catalog failed to load; `reserves` is empty. Never true in mock mode. */
  error: boolean;
  /** Load the catalog again, from an error. Does nothing in mock mode. */
  retry: () => void;
}

function noRetry(): void {}

/**
 * The Supply panel's asset rows for one chain.
 *
 * @param chainId The block's chain (42161 hub; 4663 has no Aave).
 * @param draft The mandate draft the panel holds; only its tokens are read.
 */
export function usePanelReserves(
  chainId: V2ChainId,
  draft: Pick<MandateDraft, "tokens">,
): UsePanelReservesResult {
  const catalog = useV2MandateCatalog();
  const { reserves: served, loading, error, retry } = catalog;
  const tokens = draft.tokens;
  const reserves = useMemo(
    // PP-MOCK: the MCK-005 reserves in mock mode, where the catalog hook serves none.
    () =>
      selectPanelReserves(isMockMode ? panelReserveFixtures() : (served ?? []), tokens, chainId),
    [served, tokens, chainId],
  );
  return { reserves, loading: loading ?? false, error: error ?? false, retry: retry ?? noRetry };
}
