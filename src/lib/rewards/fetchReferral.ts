/**
 * @id PP-REW-LIB-004 (POO-661)
 * @name fetchReferral
 * @implements-rules-version v1
 *
 * Server-side read of the referral program from pool-party-api, mapped to the FE `ReferralProgram`.
 * Reads the DEPLOYED `GET /api/v1/referral/:wallet` (POO-584): the wallet's referrer record (code +
 * referees) or `null` when it has no record. A null read maps to the empty program (mirrors the mock
 * empty state) rather than throwing. With no address (no connected wallet) it returns the empty program
 * without any network call, mirroring `fetchRubberRush`.
 *
 * A genuine upstream error (5xx / parse / network) PROPAGATES here; the profile-composition path wraps
 * this in `readReferralOrNull` so a referral outage never takes identity down (mirrors readRewardsOrNull).
 *
 * Caching mirrors fetchInvestorProfile: a short per-wallet data-cache window collapses a navigation
 * burst into one upstream hit (the backend throttles per API key, shared across all SSR). The pp-api
 * endpoint itself also caches for 30s (CacheTTL).
 *
 * PP-INTEGRATION-POINT: referral program <- pool-party-api `GET /referral/:wallet` (POO-584).
 * PP-INTEGRATION-POINT (POO-652): the referral WRITE (create code) is not wired here yet — pp-api
 * `POST /referral` lands under a follow-up (parent POO-579); the mock still owns createReferralCode.
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import type { ReferralProgram } from "@/lib/schemas";
import { mapReferralProgram } from "./mapReferralProgram";
import { apiReferralSchema } from "./referralApiSchema";

/**
 * Short per-wallet data-cache window (seconds) for the referral read. Long enough to collapse a
 * navigation burst into one upstream hit; short enough that a create/join reflects quickly.
 */
const REFERRAL_REVALIDATE_SECONDS = 30;

/**
 * Per-wallet cache tag for the referral read. Lowercased so any future writer's session wallet and the
 * reader's address resolve to the same tag (a create-code write can bust exactly this tag later).
 */
export function referralTag(address: string): string {
  return `referral:${address.toLowerCase()}`;
}

/**
 * Fetch and map the referral program for a wallet. Pass `undefined` (no connected wallet) to get the
 * empty program without touching the network. The endpoint returns `null` for a wallet with no referral
 * record, which also maps to the empty program.
 */
export async function fetchReferral(address?: string): Promise<ReferralProgram> {
  if (!address) return mapReferralProgram(null);

  const api = await apiFetch(`referral/${address}`, {
    // The endpoint returns `null` for a wallet with no record, so allow null through the schema.
    schema: apiReferralSchema.nullable(),
    revalidate: REFERRAL_REVALIDATE_SECONDS,
    tags: [referralTag(address)],
  });
  return mapReferralProgram(api ?? null);
}
