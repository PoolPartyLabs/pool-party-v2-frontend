/**
 * @id PP-CORE-LIB-034 (POO-580, POO-233, POO-707)
 * @name mintUploadUrlAction
 * @implements-rules-version v1
 *
 * The `"use server"` bridge for the media mint. {@link mintUploadUrlAction} forwards the mint request to
 * the guarded `POST /api/v1/media/upload-url` (POO-580) — data access is server-only, so the browser
 * cannot call `apiFetch` directly; this thin action is the seam.
 *
 * POO-707 [R2]: the mint is authorized by the SIWE SESSION (the `pp_access_token` JWT), NOT a per-upload
 * wallet signature. It forwards the session Bearer the SAME way the session-guarded owner read
 * (`GET /users/me`, {@link fetchInvestorProfile}) does — via {@link getAuthHeader}, which reads the
 * httpOnly cookie server-side — so an upload needs ZERO wallet signature. The wallet is the session
 * wallet (the JWT `address` claim, the request key pp-api's SessionTokenGuard sets) and the S3 key
 * namespace is scoped to it. Unauthenticated (no cookie) → no Bearer → pp-api returns 401.
 *
 * It never persists the returned URL: the browser uploads the bytes straight to S3, then the caller's
 * existing profile / strategy write (`PATCH /users/me` avatarUrl, ...) persists the trusted `publicUrl`.
 * An upstream error propagates (a 503 MEDIA_NOT_CONFIGURED stays a typed ApiError) so the caller keeps
 * the local crop preview and surfaces the failure rather than silently dropping it.
 *
 * PP-INTEGRATION-POINT (POO-580): media mint -> pool-party-api `POST /api/v1/media/upload-url`.
 */
"use server";

import { apiFetch } from "@/lib/api/client";
import { getAuthHeader } from "@/lib/auth/session";
import {
  type MintUploadUrlBody,
  type MintUploadUrlResponse,
  mintUploadUrlResponseSchema,
} from "./mediaUploadSchema";

/**
 * Mint a presigned S3 POST for `body` against the guarded `POST /api/v1/media/upload-url`, authorized by
 * the SIWE session Bearer (POO-707 [R2]). Returns the validated presigned-POST response (`uploadUrl` +
 * `fields` + trusted `publicUrl`). Throws when the mint returns no body (no presigned POST to upload
 * against) or on an upstream error (e.g. 401 unauthenticated, 503 MEDIA_NOT_CONFIGURED), which the caller
 * surfaces.
 */
export async function mintUploadUrlAction(body: MintUploadUrlBody): Promise<MintUploadUrlResponse> {
  // Forward the SIWE session token as a Bearer exactly as the session-guarded GET /users/me read does
  // (getAuthHeader reads the httpOnly pp_access_token cookie server-side). No wallet signature involved.
  const authHeader = await getAuthHeader();
  const response = await apiFetch("media/upload-url", {
    method: "POST",
    body,
    headers: authHeader,
    schema: mintUploadUrlResponseSchema,
  });
  if (!response) throw new Error("mintUploadUrlAction: empty response from POST /media/upload-url");
  return response;
}
