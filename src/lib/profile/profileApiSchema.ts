/**
 * @id PP-PROF-LIB-003 (POO-232, POO-233, POO-426)
 * @name Profile API response schema
 * @implements-rules-version v1
 *
 * Zod for the deployed pool-party-api profiles surface (POO-232). The OPEN read
 * `GET /api/v1/users/:address` returns the PUBLIC projection (no email) — fetch-or-create, keyed by
 * address, with `displayName` defaulting to the masked wallet (`0x1A2b...5678`) server-side. The
 * owner-only reads/writes `GET /api/v1/users/me` (POO-674, session-Bearer guarded) and
 * `PATCH /api/v1/users/me` (POO-637 signed-write guarded) return the FULL owner projection: they add
 * the PII `email` plus the identity `country`/`phone` fields (POO-675) and the PRIVATE comms-only `name`
 * (POO-693) that the public read omits, because the caller proved wallet ownership. `display_name` STAYS
 * the PUBLIC "Display name" on both projections (POO-693); the private `name` is owner-only.
 *
 * PP-INTEGRATION-POINT: response contract for the pool-party-api profiles endpoints (POO-232). Only
 * the fields the FE consumes are pinned; the API may carry more (createdAt/updatedAt kept for the
 * mapper's freshness/debug use).
 */
import { z } from "zod";

/** The PUBLIC projection returned by `GET /users/:address` (no `email`). */
export const apiPublicProfileSchema = z.object({
  /** The profile's wallet address (primary key). */
  walletAddress: z.string(),
  /** Display name; defaults to the masked wallet address server-side when unset (POO-232 R2). */
  displayName: z.string(),
  /** Avatar image URL, or null when unset. */
  avatarUrl: z.string().nullable(),
  /** Whether the wallet manages strategies (drives the conditional Manager row). */
  isManager: z.boolean(),
  /** ISO timestamps (present on both projections). */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApiPublicProfile = z.infer<typeof apiPublicProfileSchema>;

/**
 * A neutral empty PUBLIC profile for `address`, for the edge reads that resolve to no record: the
 * `GET /users/:address` null/empty fallback (`fetchInvestorProfile`) and the no-session-wallet guard
 * (`loadInvestorProfile`). Kept as the single source of the blank shape so the two callers can never
 * drift, and so the final `ProfileUser` blank comes from one place (`mapInvestorProfile`), never a
 * second hand-built literal.
 */
export function emptyApiProfile(address: string): ApiPublicProfile {
  return {
    walletAddress: address,
    displayName: "",
    avatarUrl: null,
    isManager: false,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * The FULL owner projection returned by `GET /users/me` (POO-674) and `PATCH /users/me` (POO-232 +
 * POO-675). Adds the PII `email` the public read omits, plus the `country`/`phone` identity fields
 * (POO-675 columns). All three are `string | null` (null when unset); returned only to the proven owner.
 */
export const apiOwnerProfileSchema = apiPublicProfileSchema.extend({
  /**
   * Private comms-only name (POO-693), or null when unset. Returned ONLY to the proven owner — never on
   * the PUBLIC `GET /users/:address` read. `.optional()` so an older API response (pre-`name` column)
   * still parses; the mapper degrades an absent/null value to "".
   */
  name: z.string().nullable().optional(),
  /** The owner's email, or null when unset. Only returned to the proven owner. */
  email: z.string().nullable(),
  /** Country (ISO-3166 common name, matches `COUNTRIES`), or null when unset (POO-675). */
  country: z.string().nullable(),
  /** Phone number (free text), or null when unset (POO-675). */
  phone: z.string().nullable(),
});
export type ApiOwnerProfile = z.infer<typeof apiOwnerProfileSchema>;
