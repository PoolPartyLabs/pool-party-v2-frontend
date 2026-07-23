/**
 * @id PP-REW-LIB-008 (POO-853)
 * @name createReferralCode
 * @implements-rules-version v1
 *
 * Server-only WRITE seam for the referral one-time code (POO-853 [R1]) — the create twin of the
 * `loadReferralProgram` read cutover, and the fix for the primary counting break (RC1: the mock
 * create-code never reached the backend in real mode, so every apply hit "Referrer not found").
 * Mock mode keeps the session-local mock create; real mode POSTs to pool-party-api and re-reads the
 * backend-confirmed program. Keeping `apiFetch` + the SIWE session server-side means the `x-api-key`
 * never reaches the browser and the referrer wallet is derived from the session, never client-supplied.
 *
 * PP-INTEGRATION-POINT (POO-853): create ← pool-party-api `POST /api/v1/referral` body `{ wallet, code }`
 * (deployed; ReferralService creates the `referrers` row, code rule `^[A-Za-z0-9]{3,10}$`). Rather than
 * trust an unspecified POST response body, on success we bust `referral:<wallet>` and re-read
 * `GET /referral/:wallet` (same seam as `fetchReferral`) so the published program is exactly what the
 * backend holds — proving the code survives a reload (acceptance). Any non-2xx (code taken / rejected)
 * is a soft failure the form surfaces while staying usable; the client validates the shape first, so a
 * real failure here is almost always a taken code.
 */
import "server-only";

import { revalidateTag } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { getSessionWallet } from "@/lib/auth/session";
import type { ReferralProgram } from "@/lib/schemas";
import { isMockMode, rewardsService } from "@/lib/services";
import { fetchReferral, referralTag } from "./fetchReferral";

/** Outcome of a create attempt. `unavailable` = the backend rejected the code (taken / invalid / no session). */
export type CreateReferralOutcome =
  | { status: "created"; program: ReferralProgram }
  | { status: "unavailable" };

/**
 * Create the connected investor's one-time referral code. Real mode derives the referrer wallet from
 * the SIWE session; see the module doc for the seam and the re-read-after-write model.
 */
export async function createReferralCode(code: string): Promise<CreateReferralOutcome> {
  // [R1] Mock mode keeps the session-local behavior byte-unchanged: the mock enforces immutability +
  // shape and returns the program with the canonical `?ref=` link. A throw (already set / invalid shape)
  // maps to `unavailable`, matching the real soft-fail.
  if (isMockMode) {
    try {
      return { status: "created", program: await rewardsService.createReferralCode(code) };
    } catch {
      return { status: "unavailable" };
    }
  }

  // [R1] The referrer wallet comes from the SIWE session, never client-supplied. No session → nothing to
  // create against (should not happen behind the AuthGuard).
  const wallet = await getSessionWallet();
  if (!wallet) return { status: "unavailable" };

  try {
    // PP-INTEGRATION-POINT (POO-853): create the `referrers` row for this wallet.
    await apiFetch("referral", { method: "POST", body: { wallet, code } });
  } catch {
    // Non-2xx (code taken / rejected). Soft failure: the form surfaces it and stays usable.
    return { status: "unavailable" };
  }

  // [R1] Publish the backend-confirmed program: bust the per-wallet read, then re-read so the created
  // code (and every referral surface) reflects exactly what the backend holds and survives a reload.
  revalidateTag(referralTag(wallet));
  const program = await fetchReferral(wallet);
  return { status: "created", program };
}
