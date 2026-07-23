/**
 * @id PP-STR (POO-536)
 * @name resolveDetailStrategy
 * @implements-rules-version v1
 *
 * Resolve the Strategy for the detail route (`/strategies/[id]`). Prefers the discovery catalog
 * (`/pools`, wallet-independent). In real mode, when the catalog misses, falls back to the signed-in
 * wallet's held positions (closed=all) and their synth-from-position `fallbackStrategy` (POO-526).
 *
 * Why the fallback: the backend serves `/pools` WITHOUT closed/wound-down pools (POO-373), so a
 * closed strategy the wallet still holds/held has no catalog match and `getStrategyById` returns
 * null — the detail page then 404'd (POO-536). Resolving it from the position's own pool descriptor
 * lets the closed (withdraw-only, POO-457) detail render instead. A genuinely unknown id — no
 * catalog match and not held — still returns null so the page 404s.
 */
import "server-only";

import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { fetchPositions } from "@/lib/portfolio/fetchPositions";
import type { Strategy } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { getStrategyById } from "./strategyCatalog";

/** Resolve the detail-route Strategy, with the POO-526 synth fallback for held/closed strategies. */
export async function resolveDetailStrategy(id: string): Promise<Strategy | null> {
  const catalogStrategy = await getStrategyById(id);
  // A catalog hit wins; mock mode has no real portfolio to fall back to (its catalog is authoritative).
  if (catalogStrategy || isMockMode) return catalogStrategy;

  // Real mode, catalog miss: resolve from the wallet's holdings (closed=all) via the synthesized
  // fallback strategy the position carries. Not signed in → nothing to resolve.
  const wallet = await getSessionWallet();
  if (!wallet) return null;

  const positions = await fetchPositions(wallet, await getAuthHeader(), "all");
  return positions.find((position) => position.strategyId === id)?.fallbackStrategy ?? null;
}
