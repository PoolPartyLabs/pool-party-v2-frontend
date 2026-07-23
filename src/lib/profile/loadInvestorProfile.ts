/**
 * @id PP-PROF-LIB-005 (POO-222 R7, POO-233, POO-426)
 * @name investor profile resolver
 * @implements-rules-version v1
 *
 * Server-side seam for the investor profile: the real pool-party-api identity read in real mode, the
 * existing mock `profileService` in mock mode. Server Components import THIS instead of `profileService`
 * so `apiFetch` (server-only) + the SIWE session never reach a client bundle — mirroring
 * `strategyCatalog.listStrategies`. This is the concrete real implementation the POO-222/POO-426
 * `PP-INTEGRATION-POINT: investor identity/profile` seam pointed at.
 *
 * The wallet is derived from the SIWE session, never client-supplied (POO-233 R1: fetch after auth).
 * With no session wallet (should not happen behind the AuthGuard), real mode returns a blank identity
 * rather than leaking the mock fixture.
 */
import "server-only";

import { getSessionWallet } from "@/lib/auth/session";
import type { ProfileUser } from "@/lib/schemas";
import { isMockMode, profileService } from "@/lib/services";
import { fetchInvestorProfile } from "./fetchInvestorProfile";
import { mapInvestorProfile } from "./mapInvestorProfile";
import { emptyApiProfile } from "./profileApiSchema";

/**
 * A neutral empty identity for the (guarded-against) no-session case in real mode. Routed through the
 * mapper (from the shared empty PUBLIC profile) so the `ProfileUser` blank shape has ONE source and
 * can never drift from the mapper's field decisions.
 */
function blankProfile(): ProfileUser {
  return mapInvestorProfile(emptyApiProfile(""), null, null);
}

/**
 * Resolve the authenticated investor's profile (real identity in real mode, the mock session profile
 * otherwise). POO-233 R1: real mode derives the wallet from the SIWE session and reads after auth.
 */
export async function loadInvestorProfile(): Promise<ProfileUser> {
  if (isMockMode) return profileService.get();
  const wallet = await getSessionWallet();
  if (!wallet) return blankProfile();
  return fetchInvestorProfile(wallet);
}

/**
 * POO-704: just the owner's PUBLIC `displayName` for the greeting, resolved server-side. A HARD
 * identity-read outage (pp-api unreachable, so both `/users/me` and the public fallback throw) degrades
 * to `undefined` — the greeting then falls back to the masked wallet — rather than taking the page down.
 * This restores the pre-POO-704 resilience of the Manager console, whose real branch had NO server-side
 * dependency before (its console data loads client-side with its own skeleton/retry). Mirrors the
 * silent-degrade precedent of `readRewardsOrNull`/`readReferralOrNull` in fetchInvestorProfile.
 */
export async function loadOwnerDisplayName(): Promise<string | undefined> {
  try {
    return (await loadInvestorProfile()).displayName;
  } catch {
    return undefined;
  }
}
