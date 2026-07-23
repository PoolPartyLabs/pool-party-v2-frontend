/**
 * @id PP-MGR-LIB-009 (POO-579 · POO-576 · POO-582 · POO-637)
 * @name managerProfileActions
 * @implements-rules-version v1
 *
 * The `"use server"` bridge for the manager-profile registry writes/checks (client-invokable; the
 * server-only `apiFetch` is never pulled into the client bundle). Mirrors the investor-profile
 * (`updateMyProfileAction`) and v2-strategy (`strategiesV2Actions`) precedents:
 *
 * - {@link checkManagerHandleAction}: the cheap availability check the profile form polls as-you-type
 *   and on submit (`GET /api/v1/managers/handle/check`, open read). Returns just the boolean.
 * - {@link updateManagerProfileAction}: forwards the CLIENT-signed envelope to the guarded
 *   `PATCH /api/v1/managers/me` (POO-637 `@SignedWrite('manager.update')`). The client signs the
 *   canonical message (`signWrite`); this action only forwards the five signed-write headers + the
 *   exact body — it never signs (no wallet server-side) and never trusts a wallet field in the body
 *   (the API recovers the wallet from the signature). It busts the per-key profile cache (by wallet
 *   AND by the returned handle) and returns the fresh, mapped identity.
 *
 * PP-INTEGRATION-POINT (POO-579): manager-profile registry check + write ←
 * pool-party-api `GET /api/v1/managers/handle/check` + `PATCH /api/v1/managers/me`.
 */
"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { SIGNED_WRITE_HEADERS } from "@/lib/auth/signedWrite";
import { logMediaSaveError, logMediaSaveRequest } from "@/lib/media/mediaSaveLog";
import type { ManagerProfile } from "@/lib/schemas";
import { managerProfileTag } from "./fetchManagerProfile";
import {
  apiManagerProfileSchema,
  type ManagerProfileWriteBody,
  mapManagerProfile,
} from "./managerProfileSchema";

/** Response for `GET /managers/handle/check` (pp-api `HandleAvailabilityResponseDto`). */
const handleAvailabilitySchema = z.object({
  handle: z.string(),
  available: z.boolean(),
  reason: z.enum(["invalid", "reserved", "taken"]).optional(),
});

/** The client-signed envelope forwarded to the guarded `PATCH /managers/me`. */
export interface SignedManagerProfileWrite {
  /** The exact payload whose sha256 was signed (its bytes must not change in transit). */
  body: ManagerProfileWriteBody;
  /** The five `x-pp-*` signed-write headers produced by `signWrite`. */
  headers: Record<string, string>;
}

/**
 * Keep exactly the five signed-write transport headers — never forward arbitrary client headers to
 * the API (they are appended after `x-api-key` in `apiFetch`, so an unfiltered forward could clobber
 * it). Mirrors `strategiesV2Actions` / the investor profile write.
 */
function whitelistSignedWriteHeaders(headers: Record<string, string>): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const name of Object.values(SIGNED_WRITE_HEADERS)) {
    const value = headers[name];
    if (value !== undefined) forwarded[name] = value;
  }
  return forwarded;
}

/**
 * Whether `handle` is free to claim (open read). `self` (the caller's own current handle) is excluded
 * so re-checking your own handle never reports a false collision. An invalid / reserved / taken handle
 * resolves to `false`; a transport failure propagates to the caller.
 */
export async function checkManagerHandleAction(handle: string, self?: string): Promise<boolean> {
  const query = new URLSearchParams({ handle });
  if (self) query.set("self", self);
  const result = await apiFetch(`managers/handle/check?${query.toString()}`, {
    schema: handleAvailabilitySchema,
  });
  return result?.available ?? false;
}

/**
 * Forward the client-signed envelope to the guarded `PATCH /managers/me` (POO-637). Only the five
 * signed-write headers are forwarded. Busts the per-key profile cache by the signing wallet AND the
 * returned handle so the next read reflects the edit immediately. Returns the fresh, mapped identity
 * (stats default to zeros — the console tab that consumes it does not render stats).
 */
export async function updateManagerProfileAction(
  write: SignedManagerProfileWrite,
): Promise<ManagerProfile> {
  // POO-702 Secondary #1: log the PATCH body SHAPE (keys + avatarUrl/bannerUrl presence/https, no PII) so
  // the next real save reveals whether the uploaded https URLs reach the PATCH, then log a failure with
  // its status/failure-class so a silent 4xx is diagnosable. Prints to the interface-v2 container stdout.
  logMediaSaveRequest("manager", write.body);
  const api = await apiFetch("managers/me", {
    method: "PATCH",
    body: write.body,
    headers: whitelistSignedWriteHeaders(write.headers),
    schema: apiManagerProfileSchema,
  }).catch((error: unknown) => {
    // Rethrow so the client still surfaces the save-failed error (PP-PROFILE-SAVE) — never hide a failure.
    logMediaSaveError("manager", error);
    throw error;
  });
  if (!api) throw new Error("updateManagerProfileAction: empty response from PATCH /managers/me");

  // Bust both keys the read caches under (wallet + handle) so a fresh read never serves the stale edit.
  const wallet = write.headers[SIGNED_WRITE_HEADERS.WALLET];
  if (wallet) revalidateTag(managerProfileTag(wallet));
  if (api.handle) revalidateTag(managerProfileTag(api.handle));

  return mapManagerProfile(api);
}
