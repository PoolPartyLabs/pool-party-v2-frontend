/**
 * @id PP-PROF-ACT-001 (POO-356 R4 · POO-222 R3/R5 · POO-233 R4 · POO-426 · POO-637)
 * @name profile actions
 * @implements-rules-version v1
 *
 * Server actions that persist the investor's profile edits.
 *
 * - Mock mode: {@link updateProfileAction} writes through the `profileService` seam (POO-222 [R5]:
 *   identity is read/written ONLY via the service).
 * - Real mode: {@link updateMyProfileAction} forwards a CLIENT-SIGNED envelope to the pool-party-api
 *   `PATCH /api/v1/users/me`, which is behind the POO-637 signed-write guard. The client signs the
 *   canonical message (`signWrite`); this action only forwards the signature headers + body — it never
 *   signs (no wallet server-side) and never trusts a wallet field in the body (the API recovers the
 *   wallet from the signature). It then busts the per-wallet profile cache so the next read reflects
 *   the edit, and returns the fresh identity (the owner projection is the only source of the saved
 *   email; the public read omits it).
 *
 * PP-INTEGRATION-POINT (POO-232 / POO-233): real avatar upload to media storage stays a follow-up.
 */
"use server";

import { revalidateTag } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { getSessionWallet } from "@/lib/auth/session";
import { SIGNED_WRITE_HEADERS } from "@/lib/auth/signedWrite";
import { logMediaSaveError, logMediaSaveRequest } from "@/lib/media/mediaSaveLog";
import type { ProfileWriteBody } from "@/lib/profile/buildProfileWriteBody";
import {
  profileTag,
  readReferralOrNull,
  readRewardsOrNull,
} from "@/lib/profile/fetchInvestorProfile";
import { mapInvestorProfile } from "@/lib/profile/mapInvestorProfile";
import { apiOwnerProfileSchema } from "@/lib/profile/profileApiSchema";
import type { ProfileUser } from "@/lib/schemas";
import { type ProfilePatch, profileService } from "@/lib/services";

/** The client-signed envelope forwarded to the guarded write. */
export interface SignedProfileWrite {
  /** The exact payload whose sha256 was signed (its bytes must not change in transit). */
  body: ProfileWriteBody;
  /** The five `x-pp-*` signed-write headers produced by `signWrite`. */
  headers: Record<string, string>;
}

/**
 * Mock-mode persist: the Name/Email/Country edits for the session via the service. Kept as the
 * default `onSave` for the presentational screen and for tests.
 */
export async function updateProfileAction(patch: ProfilePatch): Promise<ProfileUser> {
  return profileService.update(patch);
}

/**
 * Real-mode persist: forward the client-signed envelope to the guarded `PATCH /users/me`. Only the
 * five known signed-write headers are forwarded (never arbitrary client headers, so a client can
 * never override the injected `x-api-key`). Returns the fresh, re-composed identity.
 */
export async function updateMyProfileAction(write: SignedProfileWrite): Promise<ProfileUser> {
  // Whitelist exactly the signed-write transport headers — never pass arbitrary client headers to the
  // API (they are appended after x-api-key in apiFetch, so an unfiltered forward could clobber it).
  const headers: Record<string, string> = {};
  for (const name of Object.values(SIGNED_WRITE_HEADERS)) {
    const value = write.headers[name];
    if (value !== undefined) headers[name] = value;
  }

  // POO-702 Secondary #1: log the PATCH body SHAPE (keys + avatarUrl presence/https, no PII) so the next
  // real save reveals whether the uploaded https URL actually rides the persisting PATCH — the exact
  // question three static reading passes could not answer. Prints to the interface-v2 container stdout.
  logMediaSaveRequest("investor", write.body);
  const owner = await apiFetch("users/me", {
    method: "PATCH",
    body: write.body,
    headers,
    schema: apiOwnerProfileSchema,
  }).catch((error: unknown) => {
    // Log the failure (status/failure-class/message) so a silent 4xx is diagnosable, then rethrow so the
    // client still surfaces the save-failed error (PP-PROFILE-SAVE) — observability never hides a failure.
    logMediaSaveError("investor", error);
    throw error;
  });
  if (!owner) throw new Error("updateMyProfileAction: empty response from PATCH /users/me");

  // Bust the per-wallet profile cache so the next server read reflects the edit immediately.
  const wallet = await getSessionWallet();
  if (wallet) revalidateTag(profileTag(wallet));

  // Compose the fresh identity: the owner projection carries the just-saved email + country/phone (the
  // public read omits them), all mapped by `mapInvestorProfile` (POO-674/POO-675). Quacks come from the
  // analytics rewards read and referral code/joined from the pp-api referral read (POO-661), each
  // degrading independently so an outage never fails the write result.
  const [rewards, referral] = wallet
    ? await Promise.all([readRewardsOrNull(wallet), readReferralOrNull(wallet)])
    : [null, null];
  return mapInvestorProfile(owner, rewards, referral);
}
