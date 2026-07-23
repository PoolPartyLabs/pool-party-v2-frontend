/**
 * @id PP-MGR-LIB-005 (POO-579 · POO-576)
 * @name fetchManagerProfile
 * @implements-rules-version v1
 *
 * Server-side read of a manager's public profile from the deployed pool-party-api registry
 * (`GET /api/v1/managers/:handleOrAddress`, POO-576). Unlike the investor `GET /users/:address`
 * (fetch-or-create, never 404s), the manager registry is NOT auto-created: a wallet/handle with no
 * saved manager profile 404s. That 404 is a normal "no profile yet" outcome, so it maps to `null`
 * (the caller synthesizes an empty, editable profile) rather than throwing into the page. Every other
 * upstream failure propagates.
 *
 * `stats` (AUM / investors / strategies / avgApy) are NOT owned by the registry (the
 * strategies-aggregation is a separate POO-579 wave); the mapper defaults them to zeros and a caller
 * with the manager's strategies overrides them ({@link computeManagerStats}).
 *
 * PP-INTEGRATION-POINT (POO-579): manager profile ← pool-party-api `GET /api/v1/managers/:handleOrAddress`.
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { ManagerProfile } from "@/lib/schemas";
import {
  apiManagerProfileSchema,
  type ManagerStats,
  mapManagerProfile,
} from "./managerProfileSchema";

/** Per-key cache tag for a manager-profile read; a write busts it so an edit shows immediately. */
export function managerProfileTag(handleOrAddress: string): string {
  return `manager-profile:${handleOrAddress.toLowerCase()}`;
}

/**
 * Short per-key data-cache window (seconds). Collapses a navigation burst into one upstream hit
 * (the backend throttles per API key, shared across all SSR); short enough that an edit never looks
 * stale for long, and a write invalidates the key's tag immediately.
 */
const MANAGER_PROFILE_REVALIDATE_SECONDS = 30;

/**
 * Fetch and map a manager's profile by handle OR wallet address (POO-618). Returns `null` when the
 * registry has no record (HTTP 404) — the caller decides whether to synthesize an empty profile.
 * `stats` default to zeros unless the caller supplies composed stats.
 */
export async function fetchManagerProfile(
  handleOrAddress: string,
  stats?: ManagerStats,
): Promise<ManagerProfile | null> {
  try {
    const api = await apiFetch(`managers/${encodeURIComponent(handleOrAddress)}`, {
      schema: apiManagerProfileSchema,
      revalidate: MANAGER_PROFILE_REVALIDATE_SECONDS,
      tags: [managerProfileTag(handleOrAddress)],
    });
    // A 204/empty body (no manager) degrades to null, same as a 404.
    return api ? mapManagerProfile(api, stats) : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
