/**
 * @id PP-MGR-LIB-013
 * @name managerVerificationActions
 * @implements-rules-version v1
 *
 * POO-745: the `"use server"` bridge for the manager account-verification REQUEST (POO-744). Mirrors
 * {@link updateManagerProfileAction}: the client signs the canonical `manager.request-verification`
 * message (`signWrite`) and this action forwards ONLY the five whitelisted signed-write headers +
 * an empty body to the guarded `POST /api/v1/managers/me/verification/request`. It never signs (no
 * wallet server-side) and never trusts a wallet in the body — the API recovers the wallet from the
 * signature (`@SignedWriteWallet()`). It busts the per-key profile cache (by wallet) so the next read
 * reflects the new `pending` status, and returns the parsed response including the one-time code.
 *
 * The code is a SECRET returned ONLY here (owner-proven); it is never on any public read. The response
 * is idempotent on `pending` (the API returns the same code), which backs the FE re-show ([R6]).
 *
 * PP-INTEGRATION-POINT (POO-744): manager verification request ←
 * pool-party-api `POST /api/v1/managers/me/verification/request` (`@SignedWrite('manager.request-verification')`).
 */
"use server";

import { revalidateTag } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { SIGNED_WRITE_HEADERS } from "@/lib/auth/signedWrite";
import { managerProfileTag } from "@/lib/manager/profile/fetchManagerProfile";
import {
  managerVerificationRequestResponseSchema,
  type VerificationRequestResult,
} from "./managerVerificationSchema";

/** The client-signed envelope forwarded to the guarded request-verification endpoint (body is empty). */
export interface SignedVerificationRequest {
  /** The five `x-pp-*` signed-write headers produced by `signWrite`. */
  headers: Record<string, string>;
}

/**
 * Keep exactly the five signed-write transport headers — never forward arbitrary client headers to the
 * API (they are appended after `x-api-key` in `apiFetch`, so an unfiltered forward could clobber it).
 * Mirrors `managerProfileActions` / `strategiesV2Actions`.
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
 * Forward the client-signed envelope to `POST /managers/me/verification/request` (POO-744). The body is
 * empty (`{}`) — the wallet is bound by the signature, not the body. Busts the per-key profile cache by
 * the signing wallet so the next read reflects `pending`, and returns the parsed `{ status, code,
 * message }` (the code is surfaced only to the owner that signed this call).
 */
export async function requestManagerVerificationAction(
  write: SignedVerificationRequest,
): Promise<VerificationRequestResult> {
  const api = await apiFetch("managers/me/verification/request", {
    method: "POST",
    body: {},
    headers: whitelistSignedWriteHeaders(write.headers),
    schema: managerVerificationRequestResponseSchema,
  });
  if (!api) {
    throw new Error(
      "requestManagerVerificationAction: empty response from POST /verification/request",
    );
  }
  // Bust the profile cache under the signing wallet so a subsequent read shows the pending status.
  const wallet = write.headers[SIGNED_WRITE_HEADERS.WALLET];
  if (wallet) revalidateTag(managerProfileTag(wallet));

  return api;
}
