/**
 * @id PP-PROF-LIB-004 (POO-233, POO-426, POO-661)
 * @name fetchInvestorProfile
 * @implements-rules-version v1
 *
 * Server-side read of the authenticated investor's profile from pool-party-api, mapped to the FE
 * `ProfileUser`. When the request carries a SIWE session (a Bearer from the httpOnly cookie), it reads
 * the OWNER projection `GET /api/v1/users/me` (POO-674) so the owner's `email` + `country`/`phone`
 * (POO-675) are visible after reload — the public read deliberately omits them. Signed-out (or if the
 * owner read is unavailable during rollout), it falls back to the OPEN `GET /api/v1/users/:address`,
 * which is fetch-or-create (POO-232) and never 404s for a valid address. Both are keyed by the
 * SIWE-session wallet passed by the resolver — never a client-supplied address.
 *
 * Referral code/joined + Quacks are NOT on the profile record; each is composed from its authoritative
 * source: Quacks from the analytics rewards read (`fetchRubberRush`, POO-426), referral code/joined from
 * the pp-api referral read (`fetchReferral`, POO-661). An outage on either must not fail identity, so
 * each read degrades to null (Quacks/referral fields fall back to zero/empty) here.
 *
 * Caching mirrors fetchPositions: a short per-wallet data-cache window collapses a navigation burst
 * into one upstream hit (the backend throttles per API key, shared across all SSR), and a profile
 * write busts it via `revalidateProfileAction` (per-wallet tag).
 *
 * PP-INTEGRATION-POINT: investor identity ← pool-party-api `GET /api/v1/users/me` (owner, POO-674) with
 * a fallback to `GET /api/v1/users/:address` (public, POO-232), Quacks ← the rewards/points backend via
 * fetchRubberRush (POO-426), referral ← pool-party-api `GET /api/v1/referral/:wallet` via fetchReferral
 * (POO-661).
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { getAuthHeader } from "@/lib/auth/session";
import { fetchReferral } from "@/lib/rewards/fetchReferral";
import { fetchRubberRush } from "@/lib/rewards/fetchRubberRush";
import type { ProfileUser, ReferralProgram, RubberRush } from "@/lib/schemas";
import { mapInvestorProfile } from "./mapInvestorProfile";
import {
  type ApiOwnerProfile,
  type ApiPublicProfile,
  apiOwnerProfileSchema,
  apiPublicProfileSchema,
  emptyApiProfile,
} from "./profileApiSchema";

/**
 * Short per-wallet data-cache window (seconds) for the identity read. Long enough to collapse a
 * back-and-forth navigation burst into one upstream hit; short enough that an edit never looks stale
 * for long — and a write invalidates it immediately via {@link profileTag}.
 */
const PROFILE_REVALIDATE_SECONDS = 30;

/**
 * Per-wallet cache tag for the profile read. Lowercased so the writer's session wallet and the
 * reader's address resolve to the same tag; `revalidateProfileAction` busts exactly this tag.
 */
export function profileTag(address: string): string {
  return `profile:${address.toLowerCase()}`;
}

/** Read the rewards dashboard, degrading any failure to null so identity never fails on a rewards outage. */
export async function readRewardsOrNull(address: string): Promise<RubberRush | null> {
  try {
    return await fetchRubberRush(address);
  } catch {
    // A rewards/analytics outage must not take down identity — Quacks degrade to zero.
    return null;
  }
}

/** Read the referral program, degrading any failure to null so identity never fails on a referral outage. */
export async function readReferralOrNull(address: string): Promise<ReferralProgram | null> {
  try {
    return await fetchReferral(address);
  } catch {
    // A pp-api referral outage must not take down identity — referral code/joined degrade to empty/zero.
    return null;
  }
}

/**
 * Read the OWNER projection `GET /users/me` (POO-674): the only source of the owner's email + the new
 * country/phone identity fields (POO-675). The Bearer is the SIWE session token, forwarded server-side
 * from the httpOnly cookie (`getAuthHeader`) — never a client-supplied header. On any failure (the
 * endpoint is not yet deployed during rollout, or a rejected/expired token) it degrades to the PUBLIC
 * read so identity still renders (minus the owner-only fields) rather than failing the whole page.
 *
 * PP-SECURITY: `/users/me` has no address in its URL, so it cannot be per-wallet keyed by path. Next
 * treats a fetch carrying an `authorization` header as uncacheable on a dynamic (cookie-reading) page,
 * so this read is never shared across users; when it is cached, the Authorization header is part of the
 * cache key. The per-wallet `profileTag` stays so a write's `revalidateTag` still busts it.
 */
async function readOwnerProfile(
  address: string,
  authHeader: Record<string, string>,
): Promise<ApiOwnerProfile | ApiPublicProfile | null> {
  try {
    return await apiFetch("users/me", {
      schema: apiOwnerProfileSchema,
      headers: authHeader,
      revalidate: PROFILE_REVALIDATE_SECONDS,
      tags: [profileTag(address)],
    });
  } catch {
    return readPublicProfile(address);
  }
}

/**
 * Read the PUBLIC projection `GET /users/:address` (POO-232): fetch-or-create, no email/country/phone.
 * Used signed-out and as the owner-read rollout fallback. The address is in the URL, so its Next cache
 * entry is naturally per-wallet.
 */
function readPublicProfile(address: string): Promise<ApiPublicProfile | null> {
  return apiFetch(`users/${address}`, {
    schema: apiPublicProfileSchema,
    revalidate: PROFILE_REVALIDATE_SECONDS,
    tags: [profileTag(address)],
  });
}

/**
 * Fetch and map the authenticated wallet's profile. Signed in, it reads the owner projection
 * (`/users/me`) so email/country/phone survive a reload; signed out, the public read. A valid address
 * always resolves (fetch-or-create); a null response degrades to a blank identity rather than throwing.
 * Quacks are composed from the analytics rewards read and referral code/joined from the pp-api referral
 * read; each degrades independently so a single-backend outage never takes identity down.
 */
export async function fetchInvestorProfile(address: string): Promise<ProfileUser> {
  const authHeader = await getAuthHeader();
  const signedIn = "Authorization" in authHeader;
  const [profile, rewards, referral] = await Promise.all([
    signedIn ? readOwnerProfile(address, authHeader) : readPublicProfile(address),
    readRewardsOrNull(address),
    readReferralOrNull(address),
  ]);
  // fetch-or-create means a valid address always resolves; a null (204/empty) response degrades to a
  // blank identity (name/initial empty) rather than throwing, so the page never crashes on an edge read.
  return mapInvestorProfile(profile ?? emptyApiProfile(address), rewards, referral);
}
