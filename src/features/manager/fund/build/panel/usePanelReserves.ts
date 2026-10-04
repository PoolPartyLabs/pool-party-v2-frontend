/**
 * @id PP-MGR-HOK-013
 * @name usePanelReserves
 * @implements-rules-version v1 (POO-2185 rules v1, slice PC of POO-2171)
 * @analytics-events none (data hooks): a selector. The Supply panel owns its own events.
 *
 * The Aave v3 Supply panel's asset list (handoff v1.2, "Pick an asset"): the reserves of the catalog
 * the shell already holds (`useV2MandateCatalog`, passed in as `catalog`, the `catalog` prop of the
 * Build screen), joined to the draft tokens of the panel's network (`selectPanelReserves`,
 * PP-MGR-LIB-031). It FETCHES NOTHING and starts no catalog load of its own: a second instance of the
 * catalog hook would run three server actions on every panel mount and show the skeleton again, and a
 * failed token read unrelated to Aave would empty the list a second time.
 *
 * - **Mandate only (P1).** A reserve whose token the mandate does not hold is not a row. When the
 *   draft names its Aave reserves (`aaveV3Reserves`, the list the fund's mandate carries), only those
 *   are rows: the launch refuses any other after the fund exists.
 * - **A reserve Aave cannot take is still a row**, `usable: false` with its reason (not available,
 *   inactive, frozen, paused or supply cap reached, the checks the mandate step makes), so the panel
 *   lists it disabled instead of hiding it.
 * - **Loading, error and retry are the catalog's.** In mock mode the catalog has none, so the list is
 *   ready at once and `retry` does nothing.
 * - **No fixture fallback in real mode** (P13): a failed or empty catalog is an empty list with the
 *   catalog's own error, never the MCK-005 reserves.
 * - **The hub only.** The catalog serves Aave on Arbitrum alone, so a spoke has no rows.
 *
 * PP-INTEGRATION-POINT: the reserve list is the catalog's, read once by the shell's
 * `useV2MandateCatalog` through `getCatalogReservesAction` (GET /api/v2/catalog/aave-v3/reserves,
 * POO-2133), so the supply APY is as old as that load. Re-reading it while a panel is open is an open
 * decision (the pool's price is polled; a reserve's rate is not), and would be a second call here.
 *
 * Takes the draft rather than reading it: the panel already holds it, and a hook that went to storage
 * for it would show the saved draft, not the one on screen.
 */
"use client";

import { useMemo } from "react";
import type { V2ChainId } from "@/lib/api/v2/schemas";
import { isMockMode } from "@/lib/services";
import { panelReserveFixtures } from "@/mocks/data/buildPanelFixtures";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft } from "../../mandateDraft";
import { type PanelReserveRow, selectPanelReserves } from "./panelCatalogView";

/** What {@link usePanelReserves} returns. */
export interface UsePanelReservesResult {
  /** One row per reserve of the mandate's tokens on this chain, usable or not, in the catalog's order. */
  reserves: PanelReserveRow[];
  /** The catalog is still loading. Never true in mock mode. */
  loading: boolean;
  /** The catalog failed to load; `reserves` is empty. Never true in mock mode. */
  error: boolean;
  /** The catalog's own retry. Does nothing when the catalog offers none (mock mode). */
  retry: () => void;
}

function noRetry(): void {}

/**
 * The Supply panel's asset rows for one chain.
 *
 * @param chainId The block's chain (42161 hub; 4663 has no Aave).
 * @param draft The mandate draft the panel holds; only its tokens and its Aave reserve selection are read.
 * @param catalog The shell's catalog (`useV2MandateCatalog()`); only its reserves, loading, error and retry are read.
 */
export function usePanelReserves(
  chainId: V2ChainId,
  draft: Pick<MandateDraft, "tokens" | "aaveV3Reserves">,
  catalog: Pick<MandateCatalog, "reserves" | "loading" | "error" | "retry">,
): UsePanelReservesResult {
  const { reserves: served, loading, error, retry } = catalog;
  const { tokens, aaveV3Reserves } = draft;
  const reserves = useMemo(
    () =>
      selectPanelReserves(
        // PP-MOCK: the MCK-005 reserves in mock mode, where the catalog serves none.
        isMockMode ? panelReserveFixtures() : (served ?? []),
        tokens,
        chainId,
        aaveV3Reserves,
      ),
    [served, tokens, aaveV3Reserves, chainId],
  );
  return { reserves, loading: loading ?? false, error: error ?? false, retry: retry ?? noRetry };
}
