/**
 * @id PP-REW-LIB-005 (POO-661)
 * @name referral program resolver
 * @implements-rules-version v1
 *
 * Server-side seam for the referral program: the real pool-party-api referral read in real mode, the
 * existing mock `rewardsService.getReferral()` in mock mode. Server Components (the Referral route) and
 * the `getReferralAction` Server Action import THIS instead of touching `apiFetch` directly, so the
 * server-only client + the SIWE session never reach a client bundle — mirroring `loadInvestorProfile`.
 *
 * This is the concrete real implementation for the referral half of the mock `rewardsService`: the
 * factory export in `src/lib/services/index.ts` stays mock:mock (it is client-imported, and `apiFetch`
 * is server-only), and the real referral read lives here (mirrors the POO-426 profileService cutover).
 *
 * The wallet is derived from the SIWE session, never client-supplied. With no session wallet (should
 * not happen behind the AuthGuard) real mode returns the empty program rather than leaking the mock.
 */
import "server-only";

import { getSessionWallet } from "@/lib/auth/session";
import type { ReferralProgram } from "@/lib/schemas";
import { isMockMode, rewardsService } from "@/lib/services";
import { fetchReferral } from "./fetchReferral";

/**
 * Resolve the connected investor's referral program (real pp-api data in real mode, the mock program
 * otherwise). Real mode derives the wallet from the SIWE session; no wallet -> the empty program.
 */
export async function loadReferralProgram(): Promise<ReferralProgram> {
  if (isMockMode) return rewardsService.getReferral();
  return fetchReferral((await getSessionWallet()) ?? undefined);
}
